using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed record CallParty(Guid DriverId,Guid DriverActor,Guid CustomerId,string DriverName,string CustomerName,bool IsDriver);
public sealed record RideCallState(Guid Id,Guid RideId,Guid DriverId,Guid DriverActor,Guid CustomerId,Guid CallerActor,bool CallerIsDriver,Guid CallerDevice,Guid? AnswerActor,Guid? AnswerDevice,string State,DateTimeOffset CreatedAt,DateTimeOffset? AnsweredAt,DateTimeOffset ExpiresAt,long Revision,DateTimeOffset? CallerSeen=null,DateTimeOffset? AnswerSeen=null);
public sealed record RideCallSignal(Guid Id,Guid Device,string Kind,string Data,DateTimeOffset At);

// SDP/ICE are transient transport data, never audit logs or recorded audio.
// The existing single API process owns signaling; epoch changes force ICE resync.
public sealed class RideCallSignals(TimeProvider clock)
{
    private readonly object gate=new();
    private readonly Dictionary<(Guid Tenant,Guid Call),List<RideCallSignal>> messages=new();
    public string Epoch { get; }=Guid.NewGuid().ToString("N");
    public void Add(Guid tenant,Guid call,RideCallSignal item){lock(gate){Sweep();if(!messages.TryGetValue((tenant,call),out var list))messages[(tenant,call)]=list=new();if(list.Any(m=>m.Id==item.Id))return;if(list.Count>=256)throw new InvalidOperationException("Signal limit");list.Add(item);}}
    public RideCallSignal[] Read(Guid tenant,Guid call,Guid device){lock(gate){Sweep();return messages.GetValueOrDefault((tenant,call))?.Where(m=>m.Device!=device).ToArray()??[];}}
    public void End(Guid tenant,Guid call){lock(gate)messages.Remove((tenant,call));}
    private void Sweep(){var cutoff=clock.GetUtcNow().AddSeconds(-90);foreach(var key in messages.Keys.ToArray()){messages[key].RemoveAll(m=>m.At<cutoff);if(messages[key].Count==0)messages.Remove(key);}}
}

// Call metadata reuses append-only protected AuditLog. No new ride/chat system or migration.
public sealed class RideCalls(TaxiDb db,TenantContext tenant,IDataProtectionProvider protection,TimeProvider clock,QaOfficeConversation? office=null)
{
    public const string Action="ride.call.state";
    public static bool NotifyTransition(RideCallState state)=>state.State switch {"ringing"=>state.Revision==1,"active"=>state.Revision==2,"ended" or "rejected" or "expired"=>true,_=>false};
    private IDataProtector Protector=>protection.CreateProtector("DispatchPro.RideCalls.v1",tenant.TenantId.ToString());
    public RideCallState Read(AuditLog row)=>JsonSerializer.Deserialize<RideCallState>(Protector.Unprotect(row.Detail))!;
    public void Save(RideCallState state){db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=state.Id,Action=Action,Detail=Protector.Protect(JsonSerializer.Serialize(state)),CreatedAt=clock.GetUtcNow()});}
    public static bool AllowedStatus(RideStatus status)=>status is RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress;
    public static bool Live(RideCallState state,DateTimeOffset now)=>state.State is "ringing" or "active" && state.ExpiresAt>now;
    public static RideCallState Transition(RideCallState state,string action,bool caller,Guid actor,Guid device,DateTimeOffset now)
    {
        if(!Live(state,now))return state.State is "ringing" or "active"?state with{State="expired",ExpiresAt=now,Revision=state.Revision+1}:state;
        if(action=="answer"){
            if(caller||state.State!="ringing")throw new InvalidOperationException("Answer unavailable");
            return state with{State="active",AnswerActor=actor,AnswerDevice=device,AnsweredAt=now,CallerSeen=now,AnswerSeen=now,ExpiresAt=now.AddSeconds(65),Revision=state.Revision+1};
        }
        if(action=="reject"){
            if(caller||state.State!="ringing")throw new InvalidOperationException("Reject unavailable");
            return state with{State="rejected",ExpiresAt=now,Revision=state.Revision+1};
        }
        if(action=="end")return state with{State="ended",ExpiresAt=now,Revision=state.Revision+1};
        if(action=="heartbeat"&&state.State=="active"){
            var left=caller?now:state.CallerSeen??state.AnsweredAt!.Value;var right=caller?state.AnswerSeen??state.AnsweredAt!.Value:now;
            return state with{CallerSeen=left,AnswerSeen=right,ExpiresAt=(left<right?left:right).AddSeconds(65),Revision=state.Revision+1};
        }
        throw new InvalidOperationException("Invalid transition");
    }
    public static bool OwnsDevice(RideCallState s,bool caller,Guid actor,Guid device)=>caller?s.CallerActor==actor&&s.CallerDevice==device:s.AnswerActor==actor&&s.AnswerDevice==device;
    public async Task<CallParty?> Access(Guid rideId,CancellationToken ct)
    {
        if(await OfficeAccess(rideId,ct) is {} internalParty)return internalParty;
        var ride=await db.Set<Ride>().AsNoTracking().SingleOrDefaultAsync(r=>r.Id==rideId,ct);
        if(ride?.DriverId is not {} driverId||!AllowedStatus(ride.Status))return null;
        var driver=await db.Set<Driver>().AsNoTracking().SingleOrDefaultAsync(d=>d.Id==driverId&&d.Active&&d.Status!=DriverStatus.Suspended,ct);
        if(driver is null||!await db.Set<User>().AnyAsync(u=>u.Id==driver.UserId&&u.Active&&db.Set<Permission>().Any(p=>p.RoleId==u.RoleId&&p.Code=="rides.drive"),ct))return null;
        var customerId=await db.Set<RideRequest>().Where(q=>q.Id==ride.RideRequestId).Select(q=>q.CustomerId).SingleAsync(ct);
        if(customerId is not {} id)return null;
        var customerName=await db.Set<Customer>().Where(c=>c.Id==id).Select(c=>c.FullName).SingleOrDefaultAsync(ct);if(customerName is null)return null;
        var isDriver=tenant.ActorId==driver.UserId;
        if(!isDriver&&(await CustomerAppEndpoints.Own(db,tenant))?.Id!=id)return null;
        return new(driver.Id,driver.UserId,id,driver.FullName,customerName,isDriver);
    }
    public Task<CallParty?> OfficeAccess(Guid id,CancellationToken ct)=>office?.Access(id,ct)??Task.FromResult<CallParty?>(null);
    public Task<Guid[]> OfficeChannels(CancellationToken ct)=>office?.Channels(ct)??Task.FromResult(Array.Empty<Guid>());
    public async Task<RideCallState?> Find(Guid id,CancellationToken ct){var rows=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.Action==Action&&a.EntityId==id).OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Take(4).ToListAsync(ct);return rows.Select(Read).OrderByDescending(s=>s.Revision).FirstOrDefault();}
    public async Task<RideCallState?> FindRequest(Guid request,CancellationToken ct){var value=await db.Set<AuditLog>().Where(a=>a.Action=="ride.call.request"&&a.ActorId==tenant.ActorId&&a.EntityId==request).Select(a=>a.Detail).FirstOrDefaultAsync(ct);return Guid.TryParse(value,out var id)?await Find(id,ct):null;}
    public async Task<RideCallState[]> Recent(CancellationToken ct){var cutoff=clock.GetUtcNow().AddMinutes(-5);var rows=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.Action==Action&&a.CreatedAt>=cutoff).OrderByDescending(a=>a.CreatedAt).Take(2000).ToListAsync(ct);return rows.Select(Read).GroupBy(s=>s.Id).Select(g=>g.MaxBy(s=>s.Revision)!).ToArray();}
    public async Task Lock(CancellationToken ct)=>await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId+":ride-calls"},0))",ct);
    public object View(RideCallState s,CallParty p,Guid device)=>new{s.Id,s.RideId,s.State,s.Revision,s.CreatedAt,s.AnsweredAt,s.ExpiresAt,caller=s.CallerIsDriver==p.IsDriver,peerName=p.IsDriver?p.CustomerName:p.DriverName,owned=OwnsDevice(s,s.CallerIsDriver==p.IsDriver,tenant.ActorId,device)};
    public static object[] Ice(IConfiguration config,Guid actor,DateTimeOffset now)
    {
        var configured=config.GetSection("RideCalls:IceServers").Get<VoiceIceServer[]>()??[new VoiceIceServer{Urls=["stun:stun.l.google.com:19302"]}];
        var servers=configured.Select(s=>(object)new{urls=s.Urls,username=s.Username,credential=s.Credential}).ToList();
        var secret=config["RideCalls:TurnSecret"];var urls=config.GetSection("RideCalls:TurnUrls").Get<string[]>()??[];
        if(!string.IsNullOrWhiteSpace(secret)&&urls.Length>0){var user=$"{now.AddHours(1).ToUnixTimeSeconds()}:{actor:N}";servers.Add(new{urls,username=user,credential=Convert.ToBase64String(HMACSHA1.HashData(Encoding.UTF8.GetBytes(secret),Encoding.UTF8.GetBytes(user)))});}
        return servers.ToArray();
    }
}
