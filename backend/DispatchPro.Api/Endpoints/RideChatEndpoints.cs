using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using DispatchPro.Api.Services;

namespace DispatchPro.Api.Endpoints;
public sealed record RideChatInput(Guid Id,string Text);
public sealed record RideChatContent(string Text,Guid Recipient);
// Append-only tenant-filtered storage reuses AuditLog; message IDs are client retry keys.
public static class RideChatEndpoints
{
    public static string Protect(IDataProtectionProvider protection,Guid tenant,RideChatContent value)=>protection.CreateProtector("DispatchPro.RideChat.v1",tenant.ToString()).Protect(JsonSerializer.Serialize(value));
    public static RideChatContent Read(IDataProtectionProvider protection,Guid tenant,string value)=>JsonSerializer.Deserialize<RideChatContent>(protection.CreateProtector("DispatchPro.RideChat.v1",tenant.ToString()).Unprotect(value))!;
    private static async Task<(bool Allowed,Guid Recipient,Guid Driver)> Access(Guid rideId,TaxiDb db,TenantContext context,RideCalls calls)
    {
        if(await calls.OfficeAccess(rideId,CancellationToken.None) is {} p)return (true,p.IsDriver?p.CustomerId:p.DriverActor,p.DriverId);
        var ride=await db.Set<Ride>().AsNoTracking().SingleOrDefaultAsync(r=>r.Id==rideId);
        if(ride is null||ride.DriverId is null||ride.Status is not (RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress))return (false,Guid.Empty,Guid.Empty);
        var customerId=await db.Set<RideRequest>().Where(r=>r.Id==ride.RideRequestId).Select(r=>r.CustomerId).SingleAsync();
        var driverUser=await db.Set<Driver>().Where(d=>d.Id==ride.DriverId&&d.Active&&d.Status!=DriverStatus.Suspended).Select(d=>d.UserId).SingleOrDefaultAsync();
        if(driverUser==Guid.Empty||customerId is null)return (false,Guid.Empty,Guid.Empty);
        if(context.ActorId==driverUser){
            // Message delivered to the customer's bound devices; no office authorization shortcut.
            var allowed=await db.Set<User>().AnyAsync(u=>u.Id==driverUser&&u.Active&&db.Set<Permission>().Any(p=>p.RoleId==u.RoleId&&p.Code=="rides.drive"));
            return (allowed,customerId.Value,ride.DriverId.Value);
        }
        var own=await CustomerAppEndpoints.Own(db,context);return own?.Id==customerId?(true,driverUser,ride.DriverId.Value):(false,Guid.Empty,Guid.Empty);
    }
    public static void MapRideChat(this WebApplication app)
    {
        // Both existing transports can use the same authorization implementation.
        foreach(var prefix in (DriverQaSafety.Enabled(app.Environment)?new[]{"/api/v1/customer-app","/api/v1/driver","/api/v1/office-qa"}:new[]{"/api/v1/customer-app","/api/v1/driver"})){
            app.MapGet(prefix+"/rides/{rideId:guid}/chat",async(Guid rideId,Guid? before,Guid? after,bool? wait,int? limit,TaxiDb db,TenantContext context,RideCalls calls,IDataProtectionProvider protection,NotificationSignal signal,CancellationToken ct)=>{
                var internalParty=await calls.OfficeAccess(rideId,ct);if(prefix.EndsWith("/office-qa")?internalParty is null||internalParty.IsDriver:internalParty is not null&&(!prefix.EndsWith("/driver")||!internalParty.IsDriver))return Results.Forbid();
                var permission=await Access(rideId,db,context,calls);if(!permission.Allowed)return Results.Forbid();var action="ride.chat.message:"+permission.Driver;
                if(wait==true&&before is null&&after is {} last){
                    var deadline=System.Diagnostics.Stopwatch.StartNew();
                    while(deadline.Elapsed<TimeSpan.FromSeconds(25)){
                        using var wake=signal.Subscribe(context.TenantId);
                        var latest=await db.Set<AuditLog>().Where(a=>a.EntityId==rideId&&a.Action==action).OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Select(a=>(Guid?)a.Id).FirstOrDefaultAsync(ct);
                        if((latest??Guid.Empty)!=last)break;
                        try{await wake.Changed.WaitAsync(TimeSpan.FromSeconds(25)-deadline.Elapsed,ct);}catch(TimeoutException){break;}
                        var current=await Access(rideId,db,context,calls);if(!current.Allowed)return Results.Forbid();
                        if(current.Driver!=permission.Driver){action="ride.chat.message:"+current.Driver;break;}
                    }
                }
                var query=db.Set<AuditLog>().AsNoTracking().Where(a=>a.EntityId==rideId&&a.Action==action);
                if(before is {} id){var cursor=await query.SingleOrDefaultAsync(a=>a.Id==id,ct);if(cursor is null)return Results.BadRequest();query=query.Where(a=>a.CreatedAt<cursor.CreatedAt||(a.CreatedAt==cursor.CreatedAt&&a.Id.CompareTo(id)<0));}
                var size=Math.Clamp(limit??30,1,50);var rows=await query.OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Take(size+1).ToListAsync(ct);
                var selected=rows.Take(size).ToArray();return Results.Ok(new{items=selected.Reverse().Select(a=>new{id=a.Id,text=Read(protection,context.TenantId,a.Detail).Text,createdAt=a.CreatedAt,mine=a.ActorId==context.ActorId}),nextBefore=rows.Count>size?selected.Last().Id:(Guid?)null});
            }).RequireAuthorization();
            app.MapPost(prefix+"/rides/{rideId:guid}/chat",async(Guid rideId,RideChatInput input,TaxiDb db,TenantContext context,RideCalls calls,IDataProtectionProvider protection,CancellationToken ct)=>{
                if(input.Id==Guid.Empty||string.IsNullOrWhiteSpace(input.Text)||input.Text.Trim().Length>1000||input.Text.Any(c=>char.IsControl(c)&&c!='\n'))return Results.BadRequest();
                await using var tx=await db.Database.BeginTransactionAsync(ct);
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({context.TenantId+":ride-chat:"+rideId},0))",ct);
                var internalParty=await calls.OfficeAccess(rideId,ct);if(prefix.EndsWith("/office-qa")?internalParty is null||internalParty.IsDriver:internalParty is not null&&(!prefix.EndsWith("/driver")||!internalParty.IsDriver))return Results.Forbid();
                var access=await Access(rideId,db,context,calls);if(!access.Allowed)return Results.Forbid();var action="ride.chat.message:"+access.Driver;
                var existing=await db.Set<AuditLog>().SingleOrDefaultAsync(a=>a.Id==input.Id,ct);
                if(existing is not null){if(existing.EntityId!=rideId||existing.ActorId!=context.ActorId||existing.Action!=action||Read(protection,context.TenantId,existing.Detail).Text!=input.Text.Trim())return Results.Conflict();return Results.Ok(new{id=existing.Id,text=input.Text.Trim(),createdAt=existing.CreatedAt,mine=true});}
                var since=DateTimeOffset.UtcNow.AddMinutes(-1);if(await db.Set<AuditLog>().CountAsync(a=>a.ActorId==context.ActorId&&a.EntityId==rideId&&a.Action==action&&a.CreatedAt>since,ct)>=20)return Results.StatusCode(429);
                var row=new AuditLog{Id=input.Id,ActorId=context.ActorId,EntityId=rideId,Action=action,Detail=Protect(protection,context.TenantId,new RideChatContent(input.Text.Trim(),access.Recipient))};db.Add(row);await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);
                return Results.Ok(new{id=row.Id,text=input.Text.Trim(),createdAt=row.CreatedAt,mine=true});
            }).RequireAuthorization();
        }
    }
}
