using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public static class OfficeDriverMapEndpoints
{
    public static void MapOfficeDriverMap(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/office/driver-map").RequireAuthorization("rides.read");
        api.MapGet("", async (HttpContext http, bool? wait, TaxiDb db, AutoDispatch dispatch, NotificationSignal signal, TenantContext tenant, MobilePresence presence, VoiceRooms rooms, CancellationToken cancellationToken) => {
            using var subscription = signal.Subscribe(tenant.TenantId);
            var snapshot = await Snapshot(db, dispatch, presence, rooms, tenant, cancellationToken);
            var etag = Etag(snapshot);
            if (wait == true && http.Request.Headers.IfNoneMatch == etag) {
                await Task.WhenAny(subscription.Changed, Task.Delay(TimeSpan.FromSeconds(25), cancellationToken));
                cancellationToken.ThrowIfCancellationRequested();
                snapshot = await Snapshot(db, dispatch, presence, rooms, tenant, cancellationToken); etag = Etag(snapshot);
            }
            http.Response.Headers.ETag = etag;
            return http.Request.Headers.IfNoneMatch == etag ? Results.StatusCode(304) : Results.Ok(snapshot);
        });
        api.MapGet("/{driverId:guid}/route", async (Guid driverId, Guid? rideId, DateTimeOffset? from, DateTimeOffset? to, DateTimeOffset? after, Guid? afterId, TaxiDb db, CancellationToken cancellationToken) => {
            if (!await db.Set<Driver>().AnyAsync(d => d.Id == driverId, cancellationToken)) return Results.NotFound();
            if (rideId.HasValue && !await db.Set<Ride>().AnyAsync(r => r.Id == rideId && r.DriverId == driverId, cancellationToken)) return Results.NotFound();
            var end = to?.ToUniversalTime() ?? DateTimeOffset.UtcNow;
            var rideStart = rideId.HasValue && !from.HasValue ? await (from r in db.Set<Ride>() join q in db.Set<RideRequest>() on r.RideRequestId equals q.Id where r.Id == rideId select (DateTimeOffset?)q.CreatedAt).SingleOrDefaultAsync(cancellationToken) : null;
            var start = from?.ToUniversalTime() ?? rideStart ?? end.AddHours(-24);
            if (start >= end || end - start > TimeSpan.FromDays(7) || after.HasValue != afterId.HasValue || (after.HasValue && (after.Value < start || after.Value > end))) return Results.BadRequest(new { error = "Choose a period of up to 7 days" });
            var query = db.Set<DriverGpsPoint>().AsNoTracking().Where(p => p.DriverId == driverId && p.Timestamp >= start && p.Timestamp <= end);
            if (rideId.HasValue) query = query.Where(p => p.RideId == rideId);
            if (after.HasValue) query = query.Where(p => p.Timestamp > after || p.Timestamp == after && p.Id.CompareTo(afterId!.Value) > 0);
            var points = await query.OrderBy(p => p.Timestamp).ThenBy(p => p.Id).Take(1001).ToListAsync(cancellationToken);
            return Results.Ok(new { from = start, to = end, hasMore = points.Count > 1000, points = points.Take(1000).Select(p => new { p.Id, p.RideId, p.Latitude, p.Longitude, p.Accuracy, p.Timestamp }) });
        });
    }
    private sealed record MapSnapshot(DateTimeOffset ServerTime, int LocationMaxAgeSeconds, object[] Drivers);
    private static string Etag(MapSnapshot s) => "\"" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { s.LocationMaxAgeSeconds, s.Drivers }))) + "\"";
    private static async Task<MapSnapshot> Snapshot(TaxiDb db, AutoDispatch dispatch, MobilePresence presence, VoiceRooms rooms, TenantContext tenant, CancellationToken cancellationToken)
    {
            var now = DateTimeOffset.UtcNow;
            var age = (await dispatch.Policy()).LocationMaxAgeSeconds;
            var drivers = await db.Set<Driver>().AsNoTracking().OrderBy(d => d.Id).Select(d => new { d.Id, d.FullName, d.Phone, d.Active, d.Status, d.CurrentVehicleId, d.DriverAppEnabled, d.GpsEnabled, d.VoiceEnabled, d.CanListen, d.CanTalkPublic, d.CanTalkPrivate, d.IsVoiceBlocked }).ToListAsync(cancellationToken);
            var vehicles = await db.Set<Vehicle>().AsNoTracking().ToDictionaryAsync(v => v.Id, cancellationToken);
            var locations = await db.Set<DriverLocation>().AsNoTracking().ToDictionaryAsync(l => l.DriverId, cancellationToken);
            var history = await DriverMapLocations.History(db).ToDictionaryAsync(h => h.DriverId, cancellationToken);
            var activeRides = await (from r in db.Set<Ride>().AsNoTracking() join q in db.Set<RideRequest>() on r.RideRequestId equals q.Id where r.DriverId != null && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving) select new { r.Id, r.RideRequestId, r.DriverId, r.Status, q.Pickup, q.Latitude, q.Longitude, q.Destination, q.DestinationLatitude, q.DestinationLongitude, q.CreatedAt }).ToListAsync(cancellationToken);
            // Reserved jobs are future orders, never the driver's current destination.
            var reservedRideIds = await db.Set<DriverJob>().Select(j => j.RideId).ToListAsync(cancellationToken);
            var reserved = reservedRideIds.ToHashSet();
            var rides = activeRides.Where(r => !reserved.Contains(r.Id)).GroupBy(r => r.DriverId!.Value).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.Status == RideStatus.InProgress).ThenByDescending(r => r.CreatedAt).ThenBy(r => r.Id).First());
            var requestIds = rides.Values.Select(r => r.RideRequestId).ToArray();
            var orders = await db.Set<ReceptionOrder>().AsNoTracking().Where(o => o.RideRequestId != null && requestIds.Contains(o.RideRequestId.Value)).ToDictionaryAsync(o => o.RideRequestId!.Value, cancellationToken);
            var jobs = await db.Set<DriverJob>().GroupBy(j => j.DriverId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count, cancellationToken);
            var rows = drivers.Select(d => {
                locations.TryGetValue(d.Id, out var l); rides.TryGetValue(d.Id, out var ride);
                var vehicle = d.CurrentVehicleId.HasValue ? vehicles.GetValueOrDefault(d.CurrentVehicleId.Value) : null;
                var order = ride is null ? null : orders.GetValueOrDefault(ride.RideRequestId);
                var observations = history.GetValueOrDefault(d.Id);
                var location = DriverMapLocations.Latest(l, observations?.Latest);
                var point = observations?.Latest?.Timestamp < location?.UpdatedAt ? observations.Latest : observations?.Previous;
                if (point?.Timestamp >= location?.UpdatedAt) point = null;
                return new { d.Id, d.FullName, d.Phone, d.Active, d.Status, d.DriverAppEnabled, d.GpsEnabled, radioEnabled=d.VoiceEnabled, voiceState=rooms.DriverState(tenant.TenantId,d.Id), driverConnection=presence.Read(tenant.TenantId,d.Id,"driver"), radioConnection=presence.Read(tenant.TenantId,d.Id,"radio"), locationSource=location?.Source, voice = new VoiceAccess(d.VoiceEnabled, d.CanListen, d.CanTalkPublic, d.CanTalkPrivate, d.IsVoiceBlocked), vehicle = vehicle is null ? null : new { vehicle.Id, vehicle.Plate, vehicle.Status, vehicle.Active }, previousLocation = point is null ? null : new { point.Id, point.RideId, point.Latitude, point.Longitude, point.Accuracy, point.Timestamp }, currentRide = ride is null ? null : new { ride.Id, ride.RideRequestId, orderId = order?.ExternalId ?? ride.Id.ToString(), orderNumber = (int?)order?.Number, assignedDriver = ride.DriverId, assignedVehicle = vehicle?.Id, ride.Status, ride.Pickup, pickupLatitude = ride.Latitude, pickupLongitude = ride.Longitude, ride.Destination, ride.DestinationLatitude, ride.DestinationLongitude }, waitingCount = jobs.GetValueOrDefault(d.Id), locationStatus = DriverMapLocations.Freshness(location, now, age), updatedAt = location?.UpdatedAt,
                    location };
            }).ToArray();
            return new MapSnapshot(now, age, rows);
    }

}
