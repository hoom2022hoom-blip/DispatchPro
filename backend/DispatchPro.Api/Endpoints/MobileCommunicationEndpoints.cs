using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Endpoints;
public sealed record ChatReadInput(Guid RideId,Guid MessageId);
public static class MobileCommunicationEndpoints
{
    private static async Task<object> Snapshot(Guid deviceId,TaxiDb db,TenantContext tenant,RideCalls calls,RideCallSignals signals,IDataProtectionProvider protection,TimeProvider clock,CancellationToken ct)
    {
        var driver=await db.Set<Driver>().AsNoTracking().SingleOrDefaultAsync(d=>d.UserId==tenant.ActorId&&d.Active&&d.Status!=DriverStatus.Suspended,ct);
        var own=driver is null?await CustomerAppEndpoints.Own(db,tenant):null;
        var rides=await db.Set<Ride>().AsNoTracking().Where(r=>r.DriverId!=null&&(r.Status==RideStatus.Accepted||r.Status==RideStatus.DriverArriving||r.Status==RideStatus.Arrived||r.Status==RideStatus.InProgress)&&(driver!=null?r.DriverId==driver.Id:own!=null&&db.Set<RideRequest>().Any(q=>q.Id==r.RideRequestId&&q.CustomerId==own.Id))).Select(r=>r.Id).Take(20).ToArrayAsync(ct);
        var cutoff=clock.GetUtcNow().AddDays(-2);
        rides=rides.Concat(await calls.OfficeChannels(ct)).Distinct().ToArray();
        var messages=await db.Set<AuditLog>().AsNoTracking().Where(a=>rides.Contains(a.EntityId)&&a.Action.StartsWith("ride.chat.message:")&&a.CreatedAt>=cutoff).OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Take(100).ToListAsync(ct);
        var receipts=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.ActorId==tenant.ActorId&&a.Action=="ride.chat.read"&&rides.Contains(a.EntityId)).OrderByDescending(a=>a.CreatedAt).Take(100).ToListAsync(ct);
        var chat=new List<object>();var unread=new Dictionary<Guid,int>();
        foreach(var rideId in rides){var p=await calls.Access(rideId,ct);if(p is null)continue;
            var read=receipts.Where(r=>r.EntityId==rideId).Select(r=>DateTimeOffset.TryParse(r.Detail,out var at)?at:DateTimeOffset.MinValue).DefaultIfEmpty(DateTimeOffset.MinValue).Max();
            var action="ride.chat.message:"+p.DriverId;
            var incoming=messages.Where(m=>m.EntityId==rideId&&(p.IsDriver?m.ActorId!=p.DriverActor:m.ActorId==p.DriverActor)&&m.Action==action).ToArray();
            unread[rideId]=await db.Set<AuditLog>().CountAsync(m=>m.EntityId==rideId&&m.Action==action&&m.CreatedAt>read&&(p.IsDriver?m.ActorId!=p.DriverActor:m.ActorId==p.DriverActor),ct);
            foreach(var m in incoming.Where(m=>m.CreatedAt>read&&m.CreatedAt>=clock.GetUtcNow().AddMinutes(-2)).Reverse()){var content=RideChatEndpoints.Read(protection,tenant.TenantId,m.Detail);chat.Add(new{id=m.Id,rideId,text=content.Text[..Math.Min(content.Text.Length,120)],senderName=p.IsDriver?p.CustomerName:p.DriverName,createdAt=m.CreatedAt});}
        }
        var views=new List<object>();var signaling=new List<object>();
        foreach(var s in (await calls.Recent(ct)).OrderByDescending(s=>s.CreatedAt)){
            if(!rides.Contains(s.RideId))continue;var p=await calls.Access(s.RideId,ct);if(p is null||p.DriverId!=s.DriverId||p.CustomerId!=s.CustomerId)continue;
            var state=RideCalls.Live(s,clock.GetUtcNow())?s:s with{State=s.State is "ringing" or "active"?"expired":s.State};views.Add(calls.View(state,p,deviceId));
            if(state.State=="active"&&RideCalls.OwnsDevice(s,s.CallerIsDriver==p.IsDriver,tenant.ActorId,deviceId))signaling.AddRange(signals.Read(tenant.TenantId,s.Id,deviceId).Select(m=>(object)new{callId=s.Id,m.Id,m.Kind,m.Data}));
        }
        var rideEvents=new List<object>();
        if(own is not null){
            var recent=clock.GetUtcNow().AddMinutes(-2);
            var events=await (from a in db.Set<AuditLog>().AsNoTracking()
                join r in db.Set<Ride>().AsNoTracking() on a.EntityId equals r.Id
                join q in db.Set<RideRequest>().AsNoTracking() on r.RideRequestId equals q.Id
                where q.CustomerId==own.Id&&(a.CreatedAt>=recent||r.Status==RideStatus.Arrived&&a.Action=="ride.notification.Arrived")&&(a.Action=="ride.state"||a.Action=="ride.notification.Arrived")
                orderby a.CreatedAt descending
                select new{a.Id,rideId=r.Id,status=r.Status,a.Action,a.Detail,a.CreatedAt,driverName=db.Set<Driver>().Where(d=>d.Id==r.DriverId).Select(d=>d.FullName).FirstOrDefault()}).Take(30).ToListAsync(ct);
            var acknowledged=await db.Set<AuditLog>().Where(a=>a.Action=="customer.arrival.ack"&&a.EntityId==own.Id).Select(a=>a.Detail).ToListAsync(ct);
            foreach(var e in events){
                if(e.Id!=events.First(x=>x.rideId==e.rideId&&x.Action==e.Action).Id)continue;
                var valid=e.status==RideStatus.Arrived&&e.Action=="ride.notification.Arrived";
                if(e.status!=RideStatus.Arrived&&e.Action=="ride.state"){using var detail=JsonDocument.Parse(e.Detail);valid=detail.RootElement.GetProperty("status").GetString()==RideWorkflow.CustomerState(e.status);}
                if(valid&&e.status is not (RideStatus.Pending or RideStatus.Rejected))rideEvents.Add(new{id=e.Id,e.rideId,status=e.status.ToString(),e.driverName,arrivalAcknowledged=acknowledged.Contains(e.Id.ToString()),createdAt=e.CreatedAt});
            }
        }
        return new{chat,unread,calls=views,signals=signaling,epoch=signals.Epoch,rideEvents};
    }
    public static void MapMobileCommunication(this WebApplication app)
    {
        foreach(var prefix in (DriverQaSafety.Enabled(app.Environment)?new[]{"/api/v1/driver","/api/v1/customer-app","/api/v1/office-qa"}:new[]{"/api/v1/driver","/api/v1/customer-app"})){
            app.MapGet(prefix+"/mobile/updates",async(Guid deviceId,string? cursor,TaxiDb db,TenantContext tenant,RideCalls calls,RideCallSignals signals,NotificationSignal wake,IDataProtectionProvider protection,TimeProvider clock,CancellationToken ct)=>{
                if(deviceId==Guid.Empty||cursor?.Length>64)return Results.BadRequest();
                var isDriver=await db.Set<User>().AnyAsync(u=>u.Id==tenant.ActorId&&db.Set<Driver>().Any(d=>d.UserId==u.Id&&d.Active)&&db.Set<Permission>().Any(p=>p.RoleId==u.RoleId&&p.Code=="rides.drive"),ct);
                if(prefix.EndsWith("/office-qa",StringComparison.Ordinal)?isDriver||(await calls.OfficeChannels(ct)).Length==0:prefix.EndsWith("/driver",StringComparison.Ordinal)?!isDriver:isDriver||await CustomerAppEndpoints.Own(db,tenant) is null)return Results.Forbid();
                using var subscription=wake.Subscribe(tenant.TenantId);
                var data=await Snapshot(deviceId,db,tenant,calls,signals,protection,clock,ct);string Hash(object value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));var next=Hash(data);
                if(cursor==next){try{await subscription.Changed.WaitAsync(TimeSpan.FromSeconds(25),ct);}catch(TimeoutException){}data=await Snapshot(deviceId,db,tenant,calls,signals,protection,clock,ct);next=Hash(data);}
                return Results.Ok(new{cursor=next,data,serverTime=clock.GetUtcNow()});
            }).RequireAuthorization();
            app.MapPost(prefix+"/mobile/chat-read",async(ChatReadInput input,TaxiDb db,TenantContext tenant,RideCalls calls,CancellationToken ct)=>{
                var internalParty=await calls.OfficeAccess(input.RideId,ct);if(prefix.EndsWith("/office-qa")?internalParty is null||internalParty.IsDriver:internalParty is not null&&(!prefix.EndsWith("/driver")||!internalParty.IsDriver))return Results.Forbid();
                var p=await calls.Access(input.RideId,ct);if(p is null||p.IsDriver!=prefix.EndsWith("/driver",StringComparison.Ordinal))return Results.Forbid();var message=await db.Set<AuditLog>().SingleOrDefaultAsync(a=>a.Id==input.MessageId&&a.EntityId==input.RideId&&a.Action=="ride.chat.message:"+p.DriverId,ct);if(message is null)return Results.BadRequest();
                var detail=message.CreatedAt.ToString("O");if(!await db.Set<AuditLog>().AnyAsync(a=>a.ActorId==tenant.ActorId&&a.EntityId==input.RideId&&a.Action=="ride.chat.read"&&a.Detail==detail,ct)){db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=input.RideId,Action="ride.chat.read",Detail=detail});await db.SaveChangesAsync(ct);}return Results.Ok();
            }).RequireAuthorization();
        }
    }
}
