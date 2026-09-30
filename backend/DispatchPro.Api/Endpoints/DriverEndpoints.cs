using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record AvailabilityInput(DriverStatus Status);
public sealed record RejectInput(long Version);

public static class DriverEndpoints
{
    public static string OperatingStatus(DriverStatus status) => status switch { DriverStatus.Available => "ONLINE_AVAILABLE", DriverStatus.Busy => "BUSY", _ => "OFFLINE" };
    public static Task<Driver?> CurrentDriver(TaxiDb db, TenantContext context) => db.Set<Driver>().AsNoTracking().SingleOrDefaultAsync(d => d.UserId == context.ActorId && d.Active && d.Status != DriverStatus.Suspended);
    private static async Task<object> Profile(TaxiDb db, Driver driver)
    {
        var location = await db.Set<DriverLocation>().AsNoTracking().SingleOrDefaultAsync(l => l.DriverId == driver.Id);
        var maxAge = await db.Set<DispatchPolicy>().Select(p => (int?)p.LocationMaxAgeSeconds).SingleOrDefaultAsync() ?? 120;
        return new { driver.Id, driver.FullName, driver.Status, operatingStatus = OperatingStatus(driver.Status), driver.CurrentVehicleId,
            locationStatus = AutoDispatch.LocationReason(location, DateTimeOffset.UtcNow.AddSeconds(-maxAge)), locationUpdatedAt = location?.UpdatedAt };
    }

    public static void MapDriverEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/driver").RequireAuthorization("rides.drive");
        api.MapGet("/me", async (TaxiDb db, TenantContext context) => await CurrentDriver(db, context) is { } driver ? Results.Ok(await Profile(db, driver)) : Results.Forbid());
        api.MapPut("/availability", async (AvailabilityInput input, TaxiDb db, TenantContext context, ReceptionService reception, AutoDispatch dispatch) =>
        {
            if (input.Status is not (DriverStatus.Available or DriverStatus.Offline)) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var driver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.UserId == context.ActorId && d.Active && d.Status != DriverStatus.Suspended);
            if (driver is null) return Results.Forbid();
            var offer = input.Status == DriverStatus.Offline ? await db.Set<Ride>().SingleOrDefaultAsync(r => r.DriverId == driver.Id && r.Status == RideStatus.Assigned && r.DispatchMode != "MANUAL") : null;
            if (await reception.HasActiveOrder(driver.Id, exceptRequest: offer?.RideRequestId)) return Results.Conflict(new { error = "أكمل الطلب الحالي قبل تغيير التوفر" });
            driver.Status = input.Status;
            if (offer is not null) await dispatch.Advance(offer, "UNAVAILABLE");
            if (input.Status == DriverStatus.Offline) db.RemoveRange(await db.Set<ReceptionQueue>().Where(q => q.DriverId == driver.Id).ToListAsync());
            db.Add(new AuditLog { ActorId = context.ActorId, EntityId = driver.Id, Action = "driver.availability." + input.Status });
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { driver.Status });
        });
        api.MapPut("/rides/{id:guid}/reject", async (Guid id, RejectInput input, TaxiDb db, TenantContext context, ReceptionService reception, AutoDispatch dispatch) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var driver = await CurrentDriver(db, context); if (driver is null) return Results.Forbid();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id && r.DriverId == driver.Id);
            if (ride is null) return Results.NotFound();
            if (ride.Status != RideStatus.Assigned || ride.Version != input.Version) return Results.Conflict();
            await dispatch.CloseOffer(ride, "REJECTED");
            ride.Status = ride.DispatchMode == "MANUAL" ? RideStatus.Rejected : RideStatus.Pending; ride.DriverId = null;
            var tracked = await db.Set<Driver>().SingleAsync(d => d.Id == driver.Id); tracked.Status = DriverStatus.Available;
            db.Add(new AuditLog { ActorId = context.ActorId, EntityId = ride.Id, Action = "ride.notification.Rejected", Detail = driver.Id.ToString() });
            await reception.SyncRide(ride); await db.SaveChangesAsync(); await dispatch.Next(ride); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { ride.Id, ride.Status, ride.Version });
        });
        api.MapGet("/history", async (int? page, TaxiDb db, TenantContext context) =>
        {
            var driver = await CurrentDriver(db, context); if (driver is null) return Results.Forbid();
            var number = Math.Clamp(page ?? 1, 1, 10000);
            var query = from ride in db.Set<Ride>().AsNoTracking() join request in db.Set<RideRequest>() on ride.RideRequestId equals request.Id
                        where ride.DriverId == driver.Id && (ride.Status == RideStatus.Completed || ride.Status == RideStatus.Cancelled)
                        orderby request.CreatedAt descending, ride.Id descending
                        select new { ride.Id, ride.Status, request.Pickup, request.Destination, request.CreatedAt };
            return Results.Ok(new { page = number, total = await query.CountAsync(), items = await query.Skip((number - 1) * 20).Take(20).ToListAsync() });
        });
        api.MapGet("/updates", async (string? cursor, TaxiDb db, TenantContext context, NotificationSignal signal, HttpContext http) =>
        {
            return await WaitForUpdate(cursor, signal, http, async () =>
            {
                var driver = await CurrentDriver(db, context);
                if (driver is null) return null;
                var rides = await (from ride in db.Set<Ride>().AsNoTracking() join request in db.Set<RideRequest>() on ride.RideRequestId equals request.Id
                    where ride.DriverId == driver.Id && (ride.Status >= RideStatus.Assigned && ride.Status <= RideStatus.InProgress || ride.Status == RideStatus.DriverArriving)
                    select new { ride.Id, ride.Status, ride.Version, request.Pickup, request.Destination, request.Latitude, request.Longitude, request.DestinationLatitude, request.DestinationLongitude, ride.OfferExpiresAt, offerDistanceMeters = db.Set<RideOffer>().Where(o => o.RideId == ride.Id && o.DriverId == driver.Id && o.Outcome == "OFFERED").Select(o => (double?)o.DistanceMeters).FirstOrDefault() }).ToListAsync();
                var notices = await db.Set<AuditLog>().AsNoTracking().Where(a => a.Action.StartsWith("ride.notification.") && a.Detail == driver.Id.ToString())
                    .OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Take(50).Select(a => new { a.Id, a.Action, a.EntityId, a.CreatedAt }).ToListAsync();
                return new { driver = await Profile(db, driver), rides, notices };
            });
        });
        app.MapGet("/api/v1/notifications/updates", async (string? cursor, TaxiDb db, NotificationSignal signal, HttpContext http) =>
            await WaitForUpdate(cursor, signal, http, async () => await db.Set<AuditLog>().AsNoTracking()
                .Where(a => a.Action.StartsWith("ride.notification.") || a.Action.StartsWith("driver.availability."))
                .OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Take(50)
                .Select(a => new { a.Id, a.Action, a.EntityId, a.CreatedAt }).ToListAsync())).RequireAuthorization("rides.read");
    }

    // One outstanding request, woken after commit. Timeout also catches another API process's writes.
    private static async Task<IResult> WaitForUpdate(string? cursor, NotificationSignal signal, HttpContext http, Func<Task<object?>> read)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
        while (true)
        {
            var changed = signal.Changed;
            var data = await read(); if (data is null) return Results.Forbid();
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(data))));
            // Timestamp the response, outside the cursor hash and after any long poll.
            if (cursor != hash || DateTimeOffset.UtcNow >= deadline) return Results.Ok(new { cursor = hash, data, serverTime = DateTimeOffset.UtcNow });
            try { await changed.WaitAsync(deadline - DateTimeOffset.UtcNow > TimeSpan.Zero ? deadline - DateTimeOffset.UtcNow : TimeSpan.FromMilliseconds(1), http.RequestAborted); }
            catch (TimeoutException) { }
        }
    }
}
