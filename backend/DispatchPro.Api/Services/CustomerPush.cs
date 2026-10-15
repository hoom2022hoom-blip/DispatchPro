using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Google.Apis.Auth.OAuth2;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed record CustomerPushRegistration(Guid InstallationId, string Token);
public sealed record ProtectedCustomerPush(Guid InstallationId, string Token, Guid? SessionId = null);
public enum CustomerPushResult { Sent, InvalidToken, Retry }
public sealed record VisiblePush(string PeerName, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, long Revision = 1);
public interface ICustomerPushSender
{
    bool Enabled { get; }
    Task<CustomerPushResult> Send(string token, Guid installation, Guid actorId, Guid eventId, CancellationToken cancellation);
    Task<CustomerPushResult> SendEvent(string token, Guid installation, Guid actorId, Guid eventId, string type, CancellationToken cancellation, Guid? rideId = null)
        => type == "ARRIVED" ? Send(token,installation,actorId,eventId,cancellation) : Task.FromResult(CustomerPushResult.Retry);
    Task<CustomerPushResult> SendVisibleEvent(string token, Guid installation, Guid actorId, Guid eventId, string type, Guid rideId, VisiblePush visible, CancellationToken cancellation)
        => SendEvent(token, installation, actorId, eventId, type, cancellation, rideId);
}

public sealed class FirebaseCustomerPushSender(IConfiguration config, ILogger<FirebaseCustomerPushSender> logger) : ICustomerPushSender
{
    public FirebaseCustomerPushSender(IConfiguration config) : this(config, Microsoft.Extensions.Logging.Abstractions.NullLogger<FirebaseCustomerPushSender>.Instance) {}
    private FirebaseApp? app;
    private readonly SemaphoreSlim initialization = new(1,1);
    public bool Enabled => config.GetValue<bool>("CustomerPush:Enabled") && !string.IsNullOrWhiteSpace(config["CustomerPush:ProjectId"]);
    public bool Initialized => app is not null;
    public string? ProjectId => config["CustomerPush:ProjectId"];
    public async Task Initialize(CancellationToken cancellation)
    {
        if(!Enabled)return;
        await initialization.WaitAsync(cancellation);
        try{
            if(app is not null)return;
            var credential=await GoogleCredential.GetApplicationDefaultAsync(cancellation);
            app=FirebaseApp.GetInstance("customer-arrival")??FirebaseApp.Create(new AppOptions{ProjectId=ProjectId,Credential=credential},"customer-arrival");
        }
        catch(OperationCanceledException)when(cancellation.IsCancellationRequested){throw;}
        catch{throw new InvalidOperationException("Firebase Admin initialization failed; verify server credential access and project configuration.");}
        finally{initialization.Release();}
    }
    public static Message ArrivalMessage(string token, Guid installation, Guid actorId, Guid eventId) => new()
    {
        Token = token,
        // Data-only: foreground and background use the SAME persistent event dedupe.
        // No address, phone, customer identity, JWT or server credentials in payload.
        Data = new Dictionary<string,string> { ["type"] = "ARRIVED", ["eventId"] = eventId.ToString(), ["installationId"] = installation.ToString(), ["recipient"] = actorId.ToString() },
        Android = new AndroidConfig { Priority = Priority.High, TimeToLive = TimeSpan.FromMinutes(2) }
    };
    public async Task<CustomerPushResult> Send(string token, Guid installation, Guid actorId, Guid eventId, CancellationToken cancellation)
        => await SendEvent(token,installation,actorId,eventId,"ARRIVED",cancellation);
    public static Message EventMessage(string token,Guid installation,Guid actorId,Guid eventId,string type,Guid? rideId=null,VisiblePush? visible=null){
        if(type is not ("ARRIVED" or "ARRIVAL_ACK" or "DRIVER_REQUEST" or "CHAT" or "CALL" or "CALL_END" or "RIDE_STATUS"))throw new ArgumentOutOfRangeException(nameof(type));
        var message=ArrivalMessage(token,installation,actorId,eventId);
        message.Data=new Dictionary<string,string>{{"type",type},{"eventId",eventId.ToString()},{"installationId",installation.ToString()},{"recipient",actorId.ToString()}};
        if(type is "ARRIVAL_ACK" or "CALL_END")message.Android.Priority=Priority.Normal;
        if(type=="CALL")message.Android.TimeToLive=TimeSpan.FromSeconds(40);
        if(rideId is {} ride)message.Data=new Dictionary<string,string>(message.Data){{"rideId",ride.ToString()}};
        if (visible is not null) {
            message.Data = new Dictionary<string,string>(message.Data) {
                ["displayVersion"] = "1", ["peerName"] = visible.PeerName.Length > 80 ? visible.PeerName[..80] : visible.PeerName,
                ["createdAt"] = visible.CreatedAt.ToUnixTimeMilliseconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["expiresAt"] = visible.ExpiresAt.ToUnixTimeMilliseconds().ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["revision"] = visible.Revision.ToString(System.Globalization.CultureInfo.InvariantCulture)
            };
            var remaining = visible.ExpiresAt - DateTimeOffset.UtcNow;
            if (remaining > TimeSpan.Zero && remaining < message.Android.TimeToLive) message.Android.TimeToLive = remaining;
        }
        return message;
    }
    public Task<CustomerPushResult> SendVisibleEvent(string token, Guid installation, Guid actorId, Guid eventId, string type, Guid rideId, VisiblePush visible, CancellationToken cancellation)
        => SendCore(token, installation, actorId, eventId, type, cancellation, rideId, visible);
    public async Task<CustomerPushResult> SendEvent(string token, Guid installation, Guid actorId, Guid eventId, string type, CancellationToken cancellation, Guid? rideId = null)
        => await SendCore(token, installation, actorId, eventId, type, cancellation, rideId, null);
    private async Task<CustomerPushResult> SendCore(string token, Guid installation, Guid actorId, Guid eventId, string type, CancellationToken cancellation, Guid? rideId, VisiblePush? visible)
    {
        if (!Enabled) return CustomerPushResult.Retry;
        var started = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            // ADC belongs only on the server. No credentials in source or Android.
            await Initialize(cancellation);
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation);timeout.CancelAfter(TimeSpan.FromSeconds(8));
            var message=EventMessage(token,installation,actorId,eventId,type,rideId,visible);
            await FirebaseMessaging.GetMessaging(app!).SendAsync(message, timeout.Token);
            logger.LogInformation("FCM {Type} {EventId} accepted in {ElapsedMs} ms", type, eventId, started.ElapsedMilliseconds);
            return CustomerPushResult.Sent;
        }
        catch (FirebaseMessagingException e) when (e.MessagingErrorCode is MessagingErrorCode.Unregistered or MessagingErrorCode.SenderIdMismatch) { logger.LogWarning("FCM {Type} {EventId} invalid installation token: {Code}", type, eventId, e.MessagingErrorCode); return CustomerPushResult.InvalidToken; }
        catch (FirebaseMessagingException e) { logger.LogWarning("FCM {Type} {EventId} deferred: {Code}", type, eventId, e.MessagingErrorCode); return CustomerPushResult.Retry; }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch { logger.LogWarning("FCM {Type} {EventId} deferred after {ElapsedMs} ms", type, eventId, started.ElapsedMilliseconds); return CustomerPushResult.Retry; } // No SDK bodies, names, credentials or tokens.
    }
}

// Initialize before outbox workers start. Logs expose only the public project ID.
public sealed class FirebasePushStartup(FirebaseCustomerPushSender sender,ILogger<FirebasePushStartup> logger):IHostedService
{
    public async Task StartAsync(CancellationToken ct){await sender.Initialize(ct);if(sender.Initialized)logger.LogInformation("Firebase Admin initialized for project {ProjectId}; FCM sending enabled.",sender.ProjectId);}
    public Task StopAsync(CancellationToken ct)=>Task.CompletedTask;
}

public static class CustomerPushStore
{
    public const string Registration = "customer.push.device";
    public const string Delivered = "customer.push.arrival.sent";
    public static Guid RegistrationId(Guid tenant, Guid actor, Guid installation) => new(SHA256.HashData(Encoding.UTF8.GetBytes($"customer-push:{tenant}:{actor}:{installation}"))[..16]);
    private static IDataProtector Protector(IDataProtectionProvider protection, Guid tenant, Guid actor) => protection.CreateProtector("DispatchPro.CustomerPush.v1", tenant.ToString(), actor.ToString());
    public static string Protect(IDataProtectionProvider protection, Guid tenant, Guid actor, ProtectedCustomerPush value) => Protector(protection, tenant, actor).Protect(JsonSerializer.Serialize(value));
    public static ProtectedCustomerPush? Read(IDataProtectionProvider protection, AuditLog row)
    {
        try { return JsonSerializer.Deserialize<ProtectedCustomerPush>(Protector(protection,row.TenantId,row.ActorId).Unprotect(row.Detail)); } catch { return null; }
    }
    // Caller holds the tenant push advisory lock. One installation/token belongs
    // to one current account, while different installations remain independent.
    public static async Task<bool> Register(TaxiDb db,TenantContext tenant,IDataProtectionProvider protection,CustomerPushRegistration input,string action,Guid? sessionId=null)
    {
        var history=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.Action==action).GroupBy(a=>a.EntityId)
            .Select(g=>g.OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).First()).ToListAsync();
        var id=RegistrationId(tenant.TenantId,tenant.ActorId,input.InstallationId);
        var current=history.SingleOrDefault(a=>a.EntityId==id);
        if(current is null||current.Detail==""){
            if(history.Count(a=>a.ActorId==tenant.ActorId&&a.Detail!="")>=10)return false;
        }
        foreach(var old in history.Where(a=>a.EntityId!=id&&a.Detail!="")){
            var device=Read(protection,old);
            if(device is not null&&(device.InstallationId==input.InstallationId||device.Token==input.Token))
                db.Add(new AuditLog{ActorId=old.ActorId,EntityId=old.EntityId,Action=action,Detail=""});
        }
        if(current is null||Read(protection,current) is not {} existing||existing.Token!=input.Token||existing.SessionId!=sessionId)
            db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action=action,Detail=Protect(protection,tenant.TenantId,tenant.ActorId,new(input.InstallationId,input.Token,sessionId))});
        await db.SaveChangesAsync();return true;
    }
    public static async Task<bool> IsActive(TaxiDb db,AuditLog row,ProtectedCustomerPush device,CancellationToken ct){
        if(!await db.Set<User>().AnyAsync(u=>u.Id==row.ActorId&&u.Active,ct))return false;
        var audience=row.Action==Registration?"customer":"office";
        if(device.SessionId is not {} id)return audience=="office"&&!await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==row.ActorId&&a.Action=="office.session.created",ct);
        return await db.Set<AuditLog>().AnyAsync(a=>a.Id==id&&a.ActorId==row.ActorId&&a.Action==audience+".session.created",ct)
            &&!await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==id&&a.Action==audience+".session.revoked",ct);
    }
}

// Existing durable arrival audit records are the outbox. No schema migration.
// Work runs AFTER commit; a rollback cannot send Push. No handset background poll.
public sealed class CustomerPushWorker(IServiceScopeFactory scopes, NotificationSignal signal, ICustomerPushSender sender, ILogger<CustomerPushWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var changed = signal.AnyChange;
            if (sender.Enabled)
            {
                try { await Scan(stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch { logger.LogWarning("Customer arrival delivery deferred; will retry."); }
            }
            try { await changed.WaitAsync(TimeSpan.FromSeconds(10), stoppingToken); }
            catch (TimeoutException) { }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
    public async Task Scan(CancellationToken cancellation)
    {
        using var inventory = scopes.CreateScope();
        var tenants = await inventory.ServiceProvider.GetRequiredService<TaxiDb>().Set<Tenant>().AsNoTracking().Select(t=>t.Id).ToListAsync(cancellation);
        foreach (var tenantId in tenants)
        {
            using var scope = scopes.CreateScope();
            var context = scope.ServiceProvider.GetRequiredService<TenantContext>(); context.TenantId=tenantId;
            var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
            var protection = scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>();
            await using var tx = await db.Database.BeginTransactionAsync(cancellation);
            // Serialize device registration and sender across backend instances.
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenantId.ToString()+":customer-push"},0))", cancellation);
            var cutoff = DateTimeOffset.UtcNow.AddMinutes(-10);
            var arrivals = await (from a in db.Set<AuditLog>().AsNoTracking()
                join r in db.Set<Ride>().AsNoTracking() on a.EntityId equals r.Id
                join q in db.Set<RideRequest>().AsNoTracking() on r.RideRequestId equals q.Id
                where a.Action=="ride.notification.Arrived" && a.CreatedAt>=cutoff && r.Status==RideStatus.Arrived && q.CustomerId!=null
                select new { Event=a, CustomerId=q.CustomerId!.Value, DriverName=db.Set<Driver>().Where(d=>d.Id==r.DriverId).Select(d=>d.FullName).FirstOrDefault() }).OrderBy(a=>a.Event.CreatedAt).ToListAsync(cancellation);
            var acks=await db.Set<AuditLog>().Where(a=>a.Action=="customer.arrival.ack"&&a.CreatedAt>=cutoff).Take(100).ToListAsync(cancellation);
            if(arrivals.Count==0&&acks.Count==0){await tx.CommitAsync(cancellation);continue;}
            var history = await db.Set<AuditLog>().AsNoTracking().Where(a=>a.Action==CustomerPushStore.Registration)
                .GroupBy(a=>a.EntityId).Select(g=>g.OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).First()).ToListAsync(cancellation);
            var registrations = history.Where(a=>a.Detail!="").ToArray();
            foreach (var arrival in arrivals)
            foreach (var registration in registrations)
            {
                var actor = registration.ActorId;
                context.ActorId=actor;
                var own = await DispatchPro.Api.Endpoints.CustomerAppEndpoints.Own(db,context);
                if (own?.Id!=arrival.CustomerId) continue;
                if(await db.Set<AuditLog>().AnyAsync(a=>a.Action=="customer.arrival.ack"&&a.EntityId==arrival.CustomerId&&a.Detail==arrival.Event.Id.ToString(),cancellation))continue;
                var receipt = registration.EntityId+":"+arrival.Event.Id;
                if (await db.Set<AuditLog>().AnyAsync(a=>a.Action==CustomerPushStore.Delivered&&a.EntityId==arrival.Event.Id&&a.Detail==receipt,cancellation)) continue;
                var target = CustomerPushStore.Read(protection,registration); if (target is null||!await CustomerPushStore.IsActive(db,registration,target,cancellation)) continue;
                var result = await sender.SendVisibleEvent(target.Token,target.InstallationId,actor,arrival.Event.Id,"ARRIVED",arrival.Event.EntityId,new(arrival.DriverName??"السائق",arrival.Event.CreatedAt,DateTimeOffset.UtcNow.AddMinutes(2)),cancellation);
                logger.LogInformation("Arrival push {EventId} result {Result}", arrival.Event.Id, result);
                if(result==CustomerPushResult.InvalidToken) db.Add(new AuditLog{ActorId=actor,EntityId=registration.EntityId,Action=CustomerPushStore.Registration,Detail=""});
                if(result==CustomerPushResult.Sent) db.Add(new AuditLog { ActorId=actor, EntityId=arrival.Event.Id, Action=CustomerPushStore.Delivered, Detail=receipt });
            }
            if(sender is FirebaseCustomerPushSender firebase)foreach(var ack in acks)foreach(var registration in registrations){context.ActorId=registration.ActorId;var own=await DispatchPro.Api.Endpoints.CustomerAppEndpoints.Own(db,context);if(own?.Id!=ack.EntityId||!Guid.TryParse(ack.Detail,out var eventId))continue;var receipt=registration.EntityId+":"+ack.Id;if(await db.Set<AuditLog>().AnyAsync(a=>a.Action=="customer.push.ack.sent"&&a.EntityId==ack.Id&&a.Detail==receipt,cancellation))continue;var target=CustomerPushStore.Read(protection,registration);if(target is null||!await CustomerPushStore.IsActive(db,registration,target,cancellation))continue;if(await firebase.SendEvent(target.Token,target.InstallationId,registration.ActorId,eventId,"ARRIVAL_ACK",cancellation)==CustomerPushResult.Sent)db.Add(new AuditLog{ActorId=registration.ActorId,EntityId=ack.Id,Action="customer.push.ack.sent",Detail=receipt});}
            await db.SaveChangesAsync(cancellation); await tx.CommitAsync(cancellation);
        }
    }
}

