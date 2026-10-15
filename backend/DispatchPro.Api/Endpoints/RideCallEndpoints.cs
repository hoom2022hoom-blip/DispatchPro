using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Endpoints;
public sealed record CallCreate(Guid RideId,Guid DeviceId,Guid RequestId);
public sealed record CallAction(Guid DeviceId);
public sealed record CallSignalInput(Guid DeviceId,Guid Id,string Kind,string Data);
public static class RideCallEndpoints
{
    public static void MapRideCalls(this WebApplication app)
    {
        foreach(var prefix in (DriverQaSafety.Enabled(app.Environment)?new[]{"/api/v1/driver","/api/v1/customer-app","/api/v1/office-qa"}:new[]{"/api/v1/driver","/api/v1/customer-app"})){
            var api=app.MapGroup(prefix+"/calls").RequireAuthorization();
            api.AddEndpointFilter(async(context,next)=>{var http=context.HttpContext;var db=http.RequestServices.GetRequiredService<TaxiDb>();var tenant=http.RequestServices.GetRequiredService<TenantContext>();var qa=http.RequestServices.GetService<QaOfficeConversation>();var allowed=prefix.EndsWith("/office-qa",StringComparison.Ordinal)?qa is not null&&await qa.IsOffice(http.RequestAborted):prefix.EndsWith("/driver",StringComparison.Ordinal)?http.User.HasClaim("permission","rides.drive")&&await DriverEndpoints.CurrentDriver(db,tenant) is not null:await CustomerAppEndpoints.Own(db,tenant) is not null;return allowed?await next(context):Results.Forbid();});
            api.MapPost("",async(CallCreate input,RideCalls calls,TaxiDb db,TenantContext tenant,TimeProvider clock,CancellationToken ct)=>{
                if(input.DeviceId==Guid.Empty||input.RequestId==Guid.Empty)return Results.BadRequest();
                await using var tx=await db.Database.BeginTransactionAsync(ct);await calls.Lock(ct);
                var p=await calls.Access(input.RideId,ct);if(p is null)return Results.Forbid();
                var existing=await calls.FindRequest(input.RequestId,ct);
                if(existing is not null)return existing.CallerActor==tenant.ActorId&&existing.RideId==input.RideId&&existing.CallerDevice==input.DeviceId?Results.Ok(calls.View(existing,p,input.DeviceId)):Results.Conflict();
                var now=clock.GetUtcNow();if((await calls.Recent(ct)).Any(s=>RideCalls.Live(s,now)&&(s.DriverActor==p.DriverActor||s.CustomerId==p.CustomerId)))return Results.Conflict();
                var since=now.AddMinutes(-1);if(await db.Set<AuditLog>().CountAsync(a=>a.Action==RideCalls.Action&&a.ActorId==tenant.ActorId&&a.CreatedAt>since,ct)>30)return Results.StatusCode(429);
                var s=new RideCallState(Guid.NewGuid(),input.RideId,p.DriverId,p.DriverActor,p.CustomerId,tenant.ActorId,p.IsDriver,input.DeviceId,null,null,"ringing",now,null,now.AddSeconds(40),1);
                db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=input.RequestId,Action="ride.call.request",Detail=s.Id.ToString()});calls.Save(s);await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);return Results.Ok(calls.View(s,p,input.DeviceId));
            });
            api.MapGet("/{id:guid}",async(Guid id,Guid deviceId,RideCalls calls,IConfiguration config,TimeProvider clock,CancellationToken ct)=>{
                var s=await calls.Find(id,ct);if(s is null)return Results.NotFound();var p=await calls.Access(s.RideId,ct);if(p is null||p.DriverId!=s.DriverId||p.CustomerId!=s.CustomerId)return Results.Forbid();
                if(!RideCalls.Live(s,clock.GetUtcNow())&&s.State is "ringing" or "active")s=s with{State="expired"};
                return Results.Ok(new{call=calls.View(s,p,deviceId),iceServers=RideCalls.Ice(config,s.CallerActor,clock.GetUtcNow())});
            });
            foreach(var action in new[]{"answer","reject","end","heartbeat"})api.MapPost("/{id:guid}/"+action,async(Guid id,CallAction input,RideCalls calls,TaxiDb db,TenantContext tenant,TimeProvider clock,RideCallSignals signals,CancellationToken ct)=>{
                if(input.DeviceId==Guid.Empty)return Results.BadRequest();await using var tx=await db.Database.BeginTransactionAsync(ct);await calls.Lock(ct);
                var s=await calls.Find(id,ct);if(s is null)return Results.NotFound();var p=await calls.Access(s.RideId,ct);if(p is null||p.DriverId!=s.DriverId||p.CustomerId!=s.CustomerId)return Results.Forbid();var caller=s.CallerIsDriver==p.IsDriver;
                if(action is "end" or "heartbeat"&&!RideCalls.OwnsDevice(s,caller,tenant.ActorId,input.DeviceId))return Results.Conflict();
                if(action=="answer"&&s.State=="active")return RideCalls.OwnsDevice(s,false,tenant.ActorId,input.DeviceId)?Results.Ok(calls.View(s,p,input.DeviceId)):Results.Conflict();
                RideCallState next;try{next=RideCalls.Transition(s,action,caller,tenant.ActorId,input.DeviceId,clock.GetUtcNow());}catch(InvalidOperationException){return Results.Conflict();}
                if(next!=s){calls.Save(next);await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);}if(!RideCalls.Live(next,clock.GetUtcNow()))signals.End(tenant.TenantId,id);return Results.Ok(calls.View(next,p,input.DeviceId));
            });
            api.MapPost("/{id:guid}/signal",async(Guid id,CallSignalInput input,RideCalls calls,TenantContext tenant,RideCallSignals signals,NotificationSignal wake,TimeProvider clock,CancellationToken ct)=>{
                if(input.Id==Guid.Empty||input.Data is null||input.Data.Length>16000||input.Kind is not ("offer" or "answer" or "ice"))return Results.BadRequest();
                try{using var json=System.Text.Json.JsonDocument.Parse(input.Data);if(json.RootElement.ValueKind!=System.Text.Json.JsonValueKind.Object)return Results.BadRequest();}catch(System.Text.Json.JsonException){return Results.BadRequest();}
                var s=await calls.Find(id,ct);if(s is null||s.State!="active"||!RideCalls.Live(s,clock.GetUtcNow()))return Results.Conflict();var p=await calls.Access(s.RideId,ct);if(p is null||p.DriverId!=s.DriverId||p.CustomerId!=s.CustomerId)return Results.Forbid();var caller=s.CallerIsDriver==p.IsDriver;
                if(!RideCalls.OwnsDevice(s,caller,tenant.ActorId,input.DeviceId)||input.Kind=="offer"&&!caller||input.Kind=="answer"&&caller)return Results.Conflict();
                try{signals.Add(tenant.TenantId,id,new(input.Id,input.DeviceId,input.Kind,input.Data,clock.GetUtcNow()));}catch(InvalidOperationException){return Results.StatusCode(429);}wake.Publish(tenant.TenantId);return Results.Ok();
            });
        }
    }
}
