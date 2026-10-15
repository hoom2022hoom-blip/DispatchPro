using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Services;

public sealed record DriverQueueInput(string Type, Guid DriverId, Guid? QueueLocationId, Guid? VehicleId = null, Guid? BeforeDriverId = null, bool ConfirmTransfer = false, Guid? FromLocationId = null);
public sealed class DriverOperations(TaxiDb db, TenantContext tenant, ReceptionService reception)
{
    // Called inside the caller's tenant lock/transaction so profile + history commit together.
    public async Task Assign(Driver driver, Guid? vehicleId, string notes)
    {
        if (driver.CurrentVehicleId == vehicleId) return;
        if (await db.Set<ReceptionShift>().AnyAsync(s => s.DriverId == driver.Id && s.Active)) throw new ReceptionConflictException("أنه وردية السائق قبل تغيير السيارة");
        Vehicle? vehicle = null;
        if (vehicleId.HasValue) {
            vehicle = await db.Set<Vehicle>().SingleOrDefaultAsync(v => v.Id == vehicleId) ?? throw new ArgumentException("السيارة غير موجودة في المكتب");
            if (await db.Set<Driver>().AnyAsync(d => d.Id != driver.Id && d.CurrentVehicleId == vehicleId) || await db.Set<ReceptionShift>().AnyAsync(s => s.VehicleId == vehicleId && s.Active)) throw new ReceptionConflictException("السيارة مرتبطة بسائق آخر؛ أنه ارتباطها أولًا");
        }
        var now = DateTimeOffset.UtcNow;
        foreach (var old in await db.Set<DriverVehicleAssignment>().Where(a => a.DriverId == driver.Id && a.EndedAt == null).ToListAsync()) old.EndedAt = now;
        await db.SaveChangesAsync(); // Close the unique current assignment before inserting its successor.
        driver.CurrentVehicleId = vehicleId;
        if (vehicle is not null) {
            vehicle.DriverId = driver.Id;
            db.Add(new DriverVehicleAssignment { DriverId = driver.Id, VehicleId = vehicle.Id, StartedAt = now, ChangedBy = tenant.ActorId, Notes = notes });
        }
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = driver.Id, Action = "driver.vehicle-changed" });
    }

    public async Task Queue(DriverQueueInput input, bool legacy = false, Guid? legacyShift = null)
    {
        if (input.Type is not ("add" or "transfer" or "remove" or "up" or "down" or "move")) throw new ArgumentException("إجراء دور غير صالح");
        await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
        var driver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == input.DriverId) ?? throw new ArgumentException("السائق غير موجود في المكتب");
        if (!legacy && input.Type is "add" or "transfer" && !input.QueueLocationId.HasValue) throw new ArgumentException("اختر موقع الدور أولًا");
        var location = input.QueueLocationId.HasValue ? await db.Set<QueueLocation>().SingleOrDefaultAsync(l => l.Id == input.QueueLocationId) : null;
        if (input.QueueLocationId.HasValue && location is null) throw new ArgumentException("موقع الدور غير موجود في المكتب");
        if (input.Type is "add" or "transfer" && location is { IsActive: false }) throw new ReceptionConflictException("موقع الدور معطل");
        var all = await db.Set<ReceptionQueue>().OrderBy(q => q.Position).ThenBy(q => q.Id).ToListAsync();
        var entry = all.SingleOrDefault(q => q.DriverId == driver.Id);
        var target = all.ToList();
        if (input.Type is "add" or "transfer") {
            if (input.Type == "add" && (!driver.Active || !driver.DriverAppEnabled || driver.Status is DriverStatus.Busy or DriverStatus.Suspended || await reception.IsBusy(driver.Id))) throw new ReceptionConflictException("السائق غير متاح للدور");
            if (input.Type == "transfer" && entry is null) throw new ArgumentException("السائق غير موجود في الدور");
            if (entry is not null && entry.QueueLocationId == input.QueueLocationId) { await tx.CommitAsync(); return; }
            if (entry is not null && (!input.ConfirmTransfer || input.FromLocationId != entry.QueueLocationId)) throw new ReceptionConflictException("السائق موجود في موقع آخر. أكد نقله إلى الموقع المختار");
            if (entry is null) {
                entry = new ReceptionQueue { DriverId = driver.Id, ShiftId = legacy ? legacyShift : null, QueueLocationId = input.QueueLocationId };
                db.Add(entry); target.Add(entry);
            } else { entry.QueueLocationId = input.QueueLocationId; }
            entry.Status = "WAITING";

        } else {
            if (entry is null) { await tx.CommitAsync(); return; }
            if (input.QueueLocationId.HasValue && entry.QueueLocationId != input.QueueLocationId) throw new ReceptionConflictException("تغير موقع السائق؛ حدّث القائمة");
            var index = target.IndexOf(entry);
            if (input.Type == "remove") { target.Remove(entry); db.Remove(entry); }
            else if (input.Type is "up" or "down") { var next = index + (input.Type == "up" ? -1 : 1); if (next >= 0 && next < target.Count) (target[index], target[next]) = (target[next], target[index]); }
            else if (input.Type == "move" && input.BeforeDriverId != driver.Id) {
                target.Remove(entry);
                var next = input.BeforeDriverId.HasValue ? target.FindIndex(q => q.DriverId == input.BeforeDriverId) : target.Count;
                if (next < 0) throw new ReceptionConflictException("السائق الهدف ليس في الموقع نفسه");
                target.Insert(next, entry);
            }
        }
        Renumber(target);
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = driver.Id, Action = "driver.queue-" + input.Type });
        await db.SaveChangesAsync(); await tx.CommitAsync();
    }
    public static void Renumber(IReadOnlyList<ReceptionQueue> rows) { for (var i = 0; i < rows.Count; i++) rows[i].Position = i + 1; }
}
