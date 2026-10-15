using DispatchPro.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed record DriverJobInput(string Type, Guid RideId, long Version, Guid? DriverId = null, int? Position = null, bool ShareCustomerPhone = true);

public sealed partial class ReceptionService
{
    public async Task<bool> ShareCustomerPhone(Guid requestId)
    {
        var order = await db.Set<ReceptionOrder>().AsNoTracking().SingleOrDefaultAsync(o => o.RideRequestId == requestId);
        return order is null || Parse(order)["shareCustomerPhone"]?.GetValue<bool>() != false;
    }
    public async Task<object> Jobs(Guid? driverId = null) => await (
        from job in db.Set<DriverJob>().AsNoTracking()
        join ride in db.Set<Ride>() on job.RideId equals ride.Id
        join request in db.Set<RideRequest>() on ride.RideRequestId equals request.Id
        where driverId == null || job.DriverId == driverId
        orderby job.DriverId, job.Position, job.Id
        select new { job.Id, job.RideId, job.DriverId, job.Position, job.Version, job.CreatedAt, request.Pickup, request.Destination }
    ).ToListAsync();

    public Task<bool> IsQueued(Guid rideId) => db.Set<DriverJob>().AnyAsync(j => j.RideId == rideId);

    private async Task RemoveJob(Guid rideId)
    {
        var job = await db.Set<DriverJob>().SingleOrDefaultAsync(j => j.RideId == rideId);
        if (job is null) return;
        db.Remove(job);
        var remaining = await db.Set<DriverJob>().Where(j => j.DriverId == job.DriverId && j.RideId != rideId).OrderBy(j => j.Position).ThenBy(j => j.Id).ToListAsync();
        for (var i = 0; i < remaining.Count; i++) if (remaining[i].Position != i + 1) { remaining[i].Position = i + 1; remaining[i].Version++; }
    }

    public async Task ChangeJob(DriverJobInput input)
    {
        if (input.Type is not ("send" or "add" or "move" or "remove" or "withdraw")) throw new ArgumentException("Invalid job action");
        await using var tx = await db.Database.BeginTransactionAsync(); await Lock();
        var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == input.RideId) ?? throw new ArgumentException("Unknown ride");
        var job = await db.Set<DriverJob>().SingleOrDefaultAsync(j => j.RideId == ride.Id);
        Guid? oldDriver = job?.DriverId;
        if (input.Type == "withdraw")
        {
            if (ride.Version != input.Version || ride.Status is not (RideStatus.Pending or RideStatus.Assigned)) throw new ReceptionConflictException("لا يمكن إلغاء الإرسال بعد قبول الرحلة");
            var previousDriver = ride.DriverId;
            await RemoveJob(ride.Id);
            var dispatch = new AutoDispatch(db, this, Microsoft.Extensions.Logging.Abstractions.NullLogger<AutoDispatch>.Instance);
            await dispatch.CloseOffer(ride, "OFFICE_WITHDRAWN");
            ride.DriverId = null; ride.Status = RideStatus.Pending; ride.DispatchMode = "MANUAL"; ride.OfferExpiresAt = null;
            db.Entry(ride).Property(r => r.Version).IsModified = true;
            await SyncRide(ride); Audit("reception.send-withdrawn", ride.Id, previousDriver?.ToString() ?? oldDriver?.ToString() ?? "");
            await db.SaveChangesAsync(); await tx.CommitAsync(); return;
        }
        // An identical send is idempotent; different destinations still conflict.
        if (input.Type == "send" && ((job is not null && job.DriverId == input.DriverId) ||
            (input.DriverId.HasValue && ride.DriverId == input.DriverId && ride.Status is RideStatus.Assigned or RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress)))
        { await tx.CommitAsync(); return; }
        if (input.Type is "add" or "send")
        {
            if (job is not null || ride.Version != input.Version || ride.Status is not (RideStatus.Pending or RideStatus.Rejected or RideStatus.NoDriverAvailable))
                throw new ReceptionConflictException("تغيّرت حالة الطلب؛ راجع حالته الحالية قبل إعادة الإرسال");
            var order = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(o => o.RideRequestId == ride.RideRequestId);
            var officeRequest = await db.Set<RideRequest>().AnyAsync(r => r.Id == ride.RideRequestId &&
                (r.Source == "MANUAL" || r.Source == "WHATSAPP" || r.Source == "LANDLINE" || r.Source == "LANDLINE_ICALL"));
            if (order is null || (!officeRequest && (Parse(order)["receptionPending"]?.GetValue<bool>() == true || string.IsNullOrWhiteSpace(Parse(order)["pickup"]?["name"]?.ToString()))))
                throw new ReceptionConflictException("أكمل عنوان الطلب قبل إضافته للطابور");
            var payload = Parse(order); payload["shareCustomerPhone"] = input.ShareCustomerPhone;
            order.Payload = payload.ToJsonString(); order.Version++;
            job = new DriverJob { RideId = ride.Id };
            db.Add(job);
            ride.DriverId = null; ride.Status = RideStatus.Pending; ride.DispatchMode = "MANUAL"; ride.OfferExpiresAt = null;
            // Reserving even an already-manual pending ride invalidates earlier office edits.
            db.Entry(ride).Property(r => r.Version).IsModified = true;
        }
        else if (job is null || job.Version != input.Version) throw new ReceptionConflictException("تغيّر ترتيب الطابور؛ حدّث البيانات");

        if (input.Type == "remove") db.Remove(job!);
        else
        {
            var driver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == input.DriverId && d.Active && (d.Status == DriverStatus.Available || d.Status == DriverStatus.Busy))
                ?? throw new ReceptionConflictException("اختر سائقًا متصلًا وغير موقوف");
            var list = await db.Set<DriverJob>().Where(j => j.DriverId == driver.Id && j.Id != job!.Id).OrderBy(j => j.Position).ThenBy(j => j.Id).ToListAsync();
            var position = input.Position ?? list.Count + 1;
            if (position < 1 || position > list.Count + 1) throw new ArgumentException("Invalid queue position");
            job!.DriverId = driver.Id; list.Insert(position - 1, job);
            for (var i = 0; i < list.Count; i++) { list[i].Position = i + 1; list[i].Version++; }
        }
        Audit("driver.jobs." + input.Type, ride.Id, $"{oldDriver} -> {input.DriverId}");
        if (input.Type is "add" or "send") await SyncRide(ride);
        await db.SaveChangesAsync();
        if (oldDriver.HasValue) await CompactJobs(oldDriver.Value);
        if (input.Type != "remove") await PromoteJob(job!.DriverId);
        await db.SaveChangesAsync(); await tx.CommitAsync();
    }

    private async Task CompactJobs(Guid driverId)
    {
        var list = await db.Set<DriverJob>().Where(j => j.DriverId == driverId).OrderBy(j => j.Position).ThenBy(j => j.Id).ToListAsync();
        for (var i = 0; i < list.Count; i++) if (list[i].Position != i + 1) { list[i].Position = i + 1; list[i].Version++; }
    }

    // Caller holds the reception transaction lock and has persisted the released ride.
    public async Task PromoteJob(Guid driverId)
    {
        var driver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == driverId);
        if (driver is null || !driver.Active || driver.Status != DriverStatus.Available || await IsBusy(driverId)) return;
        var job = await db.Set<DriverJob>().Where(j => j.DriverId == driverId).OrderBy(j => j.Position).ThenBy(j => j.Id).FirstOrDefaultAsync();
        if (job is null) return;
        var ride = await db.Set<Ride>().SingleAsync(r => r.Id == job.RideId);
        if (await db.Set<RideRequest>().AnyAsync(r => r.Id == ride.RideRequestId && r.ScheduledAt > DateTimeOffset.UtcNow)) return;
        if (ride.Status != RideStatus.Pending || ride.DispatchMode != "MANUAL") throw new ReceptionConflictException("Queued ride is no longer pending");
        db.Remove(job);
        ride.DriverId = driverId; ride.Status = RideStatus.Assigned; ride.OfferExpiresAt = null;
        await SyncRide(ride);
        Audit("driver.jobs.promoted", ride.Id, driverId.ToString());
        await db.SaveChangesAsync(); await CompactJobs(driverId); await db.SaveChangesAsync();
    }
}
