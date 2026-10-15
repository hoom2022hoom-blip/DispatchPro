using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;

namespace DispatchPro.Api.Endpoints;
public sealed record DriverLocationInput(double Latitude, double Longitude, double Accuracy, DateTimeOffset CapturedAt);
public sealed record DispatchPolicyInput(string Mode, int LocationMaxAgeSeconds = 120, int OfferTimeoutSeconds = 30, bool ShowDriverPhone = false);
public sealed record DispatchModeInput(string Mode, long Version);
public static class DispatchEndpoints
{
    public static void MapDispatch(this WebApplication app)
    {
        app.MapOfficeDriverMap();
        app.MapGet("/api/v1/radio/me", async (TaxiDb db, TenantContext tenant) =>
            await DriverEndpoints.CurrentDriver(db,tenant) is {} d && MobileAppAccess.Allowed(d,"radio")
                ? Results.Ok(new { d.Id, d.FullName, d.Status, d.GpsEnabled, radioEnabled=d.VoiceEnabled, access=VoiceEndpoints.Access(d), serverTime=DateTimeOffset.UtcNow }) : Results.Forbid()).RequireAuthorization("rides.drive");
        app.MapPut("/api/v1/driver/location", (DriverLocationInput input, TaxiDb db, TenantContext tenant, ReceptionService reception, ILogger<AutoDispatch> logger) => SaveLocation(input,db,tenant,reception,logger,"driver")).RequireAuthorization("rides.drive");
        app.MapPut("/api/v1/radio/location", (DriverLocationInput input, TaxiDb db, TenantContext tenant, ReceptionService reception, ILogger<AutoDispatch> logger) => SaveLocation(input,db,tenant,reception,logger,"radio")).RequireAuthorization("rides.drive");
        app.MapGet("/api/v1/dispatch/policy", async (AutoDispatch dispatch) => Results.Ok(await dispatch.Policy())).RequireAuthorization("rides.read");
        app.MapPut("/api/v1/dispatch/policy", async (DispatchPolicyInput input, TaxiDb db, ReceptionService reception) =>
        {
            if (!AutoDispatch.ValidMode(input.Mode) || input.LocationMaxAgeSeconds is < 60 or > 600 || input.OfferTimeoutSeconds is < 10 or > 180) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var policy = await db.Set<DispatchPolicy>().SingleOrDefaultAsync();
            if (policy is null) { policy = new DispatchPolicy(); db.Add(policy); }
            policy.Mode = input.Mode; policy.LocationMaxAgeSeconds = input.LocationMaxAgeSeconds; policy.OfferTimeoutSeconds = input.OfferTimeoutSeconds; policy.ShowDriverPhone = input.ShowDriverPhone;
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(policy);
        }).RequireAuthorization("settings.write");
        app.MapPut("/api/v1/dispatch/rides/{id:guid}/mode", async (Guid id, DispatchModeInput input, TaxiDb db, ReceptionService reception, AutoDispatch dispatch) =>
        {
            if (!AutoDispatch.ValidMode(input.Mode)) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            if (ride is null) return Results.NotFound();
            if (await reception.IsQueued(id)) return Results.Conflict(new { error = "أخرج الطلب من الطابور قبل التوزيع التلقائي" });
            if (ride.Version != input.Version || ride.Status is not (RideStatus.Pending or RideStatus.Assigned or RideStatus.Rejected or RideStatus.NoDriverAvailable)) return Results.Conflict();
            var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == ride.RideRequestId);
            if (input.Mode != "MANUAL" && (request.Latitude is null || request.Longitude is null)) return Results.BadRequest(new { detail = "حدد موقع الانطلاق GPS أو على الخريطة قبل التوزيع التلقائي" });
            await dispatch.CloseOffer(ride, "OFFICE_OVERRIDE");
            ride.DispatchMode = input.Mode;
            if (input.Mode != "MANUAL") { ride.DriverId = null; ride.Status = RideStatus.Pending; }
            await reception.SyncRide(ride); await db.SaveChangesAsync(); await dispatch.Next(ride); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(ride);
        }).RequireAuthorization("rides.write");
        app.MapGet("/api/v1/dispatch/rides", async (TaxiDb db, AutoDispatch dispatch, IArrivalEstimate eta) =>
        {
            var policy = await dispatch.Policy();
            var rows = await (from r in db.Set<Ride>().AsNoTracking() join q in db.Set<RideRequest>() on r.RideRequestId equals q.Id
                join d in db.Set<Driver>() on r.DriverId equals d.Id into drivers from d in drivers.DefaultIfEmpty()
                join l in db.Set<DriverLocation>() on r.DriverId equals l.DriverId into locations from l in locations.DefaultIfEmpty()
                where r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving || r.Status == RideStatus.Rejected || r.Status == RideStatus.NoDriverAvailable orderby q.CreatedAt descending
                select new { Ride = r, Request = q, Driver = d, Location = l }).Take(200).ToListAsync();
            return Results.Ok(rows.Select(x => new { x.Ride.Id, x.Ride.Version, x.Ride.DispatchMode, status = AutoDispatch.State(x.Ride), x.Ride.OfferExpiresAt, hasPickupLocation = x.Request.Latitude != null && x.Request.Longitude != null, x.Request.PassengerName, x.Request.Pickup, x.Request.Destination, driver = x.Driver?.FullName, tracking = Tracking(x.Location, x.Request, policy, eta) }));
        }).RequireAuthorization("rides.read");
    }
    private static async Task<IResult> SaveLocation(DriverLocationInput input, TaxiDb db, TenantContext tenant, ReceptionService reception, ILogger<AutoDispatch> logger, string source)
    {
            Locations.Validate(new LocationInput("", Latitude: input.Latitude, Longitude: input.Longitude));
            var now = DateTimeOffset.UtcNow;
            var invalid = !double.IsFinite(input.Accuracy) || input.Accuracy is < 0 or > 200 ? "POOR_ACCURACY"
                : input.CapturedAt < now.AddSeconds(-60) ? "STALE_LOCATION" : input.CapturedAt > now.AddSeconds(10) ? "FUTURE_LOCATION" : null;
            if (invalid is not null) {
                logger.LogWarning("Driver GPS office {OfficeId} user {UserId} rejected: {Reason}; accuracy {Accuracy}, capturedAt {CapturedAt}", tenant.TenantId, tenant.ActorId, invalid, input.Accuracy, input.CapturedAt);
                return Results.BadRequest(new { error = invalid, serverTime = now });
            }
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var driver = await DriverEndpoints.CurrentDriver(db, tenant);
            if (driver is null || !driver.GpsEnabled || !MobileAppAccess.Allowed(driver,source) || (source != "radio" && driver.Status != DriverStatus.Available && !await db.Set<Ride>().AnyAsync(r => r.DriverId == driver.Id && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving)))) return Results.Forbid();
            var location = await db.Set<DriverLocation>().SingleOrDefaultAsync(l => l.DriverId == driver.Id);
            var selected=MobileAppAccess.Prefer(location,input,now);
            if (location is null) { location = new DriverLocation { DriverId = driver.Id }; db.Add(location); }
            if(selected){location.Source = source; location.Position = new Point(input.Longitude, input.Latitude) { SRID = 4326 }; location.Accuracy = input.Accuracy; location.UpdatedAt = input.CapturedAt.ToUniversalTime();}
            var rideId = await db.Set<Ride>().Where(r => r.DriverId == driver.Id && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving)).Select(r => (Guid?)r.Id).FirstOrDefaultAsync();
            var meterRide = rideId.HasValue ? await db.Set<Ride>().SingleAsync(r => r.Id == rideId.Value) : null;
            var acceptedMeter=source=="driver" && meterRide is not null && RideFare.Accept(meterRide, input, now);
            var lastPoint = await db.Set<DriverGpsPoint>().Where(p => p.DriverId == driver.Id).OrderByDescending(p => p.Timestamp).FirstOrDefaultAsync();
            // At most one history point per 30 seconds, plus the first observation of a new ride.
            if (acceptedMeter || selected && (lastPoint is null || lastPoint.RideId != rideId || input.CapturedAt - lastPoint.Timestamp >= TimeSpan.FromSeconds(30)))
                db.Add(new DriverGpsPoint { DriverId = driver.Id, RideId = rideId, Source=source, LocationAccepted=selected, Latitude = input.Latitude, Longitude = input.Longitude, Accuracy = input.Accuracy, Timestamp = input.CapturedAt.ToUniversalTime() });
            await db.SaveChangesAsync(); await tx.CommitAsync();
            logger.LogInformation("Driver GPS office {OfficeId} driver {DriverId}: STORED; accuracy {Accuracy}, capturedAt {CapturedAt}", tenant.TenantId, driver.Id, location.Accuracy, location.UpdatedAt);
            return Results.Ok(new { stored = selected, source=location.Source, meterAccepted = acceptedMeter, location.UpdatedAt });
    }
    public static object? Tracking(DriverLocation? location, RideRequest request, DispatchPolicy policy, IArrivalEstimate eta)
    {
        if (location is null || location.UpdatedAt < DateTimeOffset.UtcNow.AddSeconds(-policy.LocationMaxAgeSeconds)) return null;
        var meters = request.Latitude is double lat && request.Longitude is double lon ? Distance(lat, lon, location.Position.Y, location.Position.X) : (double?)null;
        return new { latitude = location.Position.Y, longitude = location.Position.X, location.Accuracy, location.UpdatedAt, distanceMeters = meters, etaMinutes = meters.HasValue ? eta.Minutes(meters.Value) : (int?)null };
    }
    private static double Distance(double lat, double lon, double otherLat, double otherLon)
    {
        const double rad = Math.PI / 180;
        var a = Math.Pow(Math.Sin((otherLat - lat) * rad / 2), 2) + Math.Cos(lat * rad) * Math.Cos(otherLat * rad) * Math.Pow(Math.Sin((otherLon - lon) * rad / 2), 2);
        return 6371000 * 2 * Math.Asin(Math.Sqrt(Math.Clamp(a, 0, 1)));
    }
}
