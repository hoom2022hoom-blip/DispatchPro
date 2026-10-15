using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;
public sealed record NmAppAccessInput(bool DriverAppEnabled, bool RadioEnabled, bool GpsEnabled);
public static class NmAppAccessEndpoints
{
    public static void MapNmAppAccess(this WebApplication app) {
        app.MapPut("/api/v1/office/drivers/{id:guid}/app-access", async (Guid id, NmAppAccessInput input, TaxiDb db, TenantContext tenant, ReceptionService reception, VoiceRooms rooms, VoiceEvents signal) => {
            await using var tx=await db.Database.BeginTransactionAsync(); await reception.Lock();
            var driver=await db.Set<Driver>().SingleOrDefaultAsync(d=>d.Id==id);
            if(driver is null)return Results.NotFound();
            if(!input.DriverAppEnabled && driver.DriverAppEnabled && await reception.HasActiveOrder(id))
                return Results.Conflict(new {detail="أكمل أو أعد توزيع الطلب الحالي قبل إيقاف تطبيق السائق"});
            driver.DriverAppEnabled=input.DriverAppEnabled; driver.VoiceEnabled=input.RadioEnabled; driver.GpsEnabled=input.GpsEnabled;
            if(!input.DriverAppEnabled) {
                driver.Status=DriverStatus.Offline;
                db.RemoveRange(await db.Set<ReceptionQueue>().Where(q=>q.DriverId==id).ToListAsync());
            }
            db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="driver.app-access",Detail=System.Text.Json.JsonSerializer.Serialize(input)});
            await db.SaveChangesAsync();await tx.CommitAsync();
            rooms.Revoke(tenant.TenantId,id,VoiceEndpoints.Access(driver)); signal.Publish(tenant.TenantId);
            return Results.Ok(input);
        }).RequireAuthorization("users.write");
    }
}
