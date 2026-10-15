using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Endpoints;
public static class DriverPushEndpoints
{
 public static void MapDriverPush(this WebApplication app){
  app.MapPost("/api/v1/driver/push-device",async(CustomerPushRegistration input,TaxiDb db,TenantContext tenant,IDataProtectionProvider protection,ICustomerPushSender sender,HttpContext http)=>{
   if(!await db.Set<Driver>().AnyAsync(d=>d.UserId==tenant.ActorId&&d.Active&&d.Status!=DriverStatus.Suspended))return Results.Forbid();
   if(input.InstallationId==Guid.Empty||input.Token is null||input.Token.Length is <20 or >4096||input.Token.Any(char.IsWhiteSpace))return Results.BadRequest();
   await using var tx=await db.Database.BeginTransactionAsync();await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId+":customer-push"},0))");
   Guid? sessionId=Guid.TryParse(http.User.FindFirst("office_session")?.Value,out var session)?session:null;
   if(!await CustomerPushStore.Register(db,tenant,protection,input,"driver.push.device",sessionId))return Results.StatusCode(429);
   await tx.CommitAsync();return Results.Ok(new{recipient=tenant.ActorId});
  }).RequireAuthorization("rides.drive");
  app.MapPost("/api/v1/driver/push-device/remove",async(CustomerPushRegistration input,TaxiDb db,TenantContext tenant)=>{
   if(!await db.Set<Driver>().AnyAsync(d=>d.UserId==tenant.ActorId&&d.Active&&d.Status!=DriverStatus.Suspended))return Results.Forbid();
   if(input.InstallationId==Guid.Empty)return Results.BadRequest();
   await using var tx=await db.Database.BeginTransactionAsync();await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId+":customer-push"},0))");
   var id=CustomerPushStore.RegistrationId(tenant.TenantId,tenant.ActorId,input.InstallationId);
   if(await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==id&&a.ActorId==tenant.ActorId&&a.Action=="driver.push.device"))db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="driver.push.device",Detail=""});
   await db.SaveChangesAsync();await tx.CommitAsync();return Results.NoContent();
  }).RequireAuthorization("rides.drive");
 }
}
