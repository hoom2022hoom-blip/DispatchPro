using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;

namespace DispatchPro.Api.Services;

public interface IArrivalEstimate { int Minutes(double meters); }
public sealed class SimpleArrivalEstimate : IArrivalEstimate
{
    public int Minutes(double meters) => Math.Max(1, (int)Math.Ceiling(meters / 1000 / 25 * 60));
}

// Call mutations under the same tenant advisory transaction lock used by Reception.
public sealed class AutoDispatch(TaxiDb db, ReceptionService reception, ILogger<AutoDispatch> logger)
{
    public static bool ValidMode(string mode) => mode is "MANUAL" or "AUTO_NEAREST" or "HYBRID";
    public Task<DispatchPolicy> Policy() => ReadPolicy();
    private async Task<DispatchPolicy> ReadPolicy() => await db.Set<DispatchPolicy>().SingleOrDefaultAsync() ?? new DispatchPolicy();
    public static string State(Ride ride) => ride.Status switch
    {
        RideStatus.NoDriverAvailable => "NO_DRIVER_AVAILABLE",
        RideStatus.Pending => ride.DispatchMode == "MANUAL" ? "REQUESTED" : "SEARCHING_DRIVER",
        RideStatus.DriverArriving => "DRIVER_ARRIVING", RideStatus.Rejected => "REJECTED",
        RideStatus.Assigned => "OFFERED", RideStatus.Accepted => "ACCEPTED", RideStatus.Arrived => "ARRIVED",
        RideStatus.InProgress => "IN_PROGRESS", RideStatus.Completed => "COMPLETED", _ => "CANCELLED"
    };
    public async Task Initialize(Ride ride, RideRequest request)
    {
        // Customer requests are dispatched by the server even while the office is
        // closed or uses manual reception. Staff can still override each ride.
        ride.DispatchMode = request.Source == "CUSTOMER_APP" ? "AUTO_NEAREST" : (await Policy()).Mode;
        // Persist before querying offers / projecting the assigned driver.
        await db.SaveChangesAsync();
        await Next(ride, request);
        await reception.SyncRide(ride);
    }
    public async Task<List<(Guid DriverId, double DistanceMeters)>> Nearest(RideRequest request, Guid rideId, DispatchPolicy policy)
    {
        if (request.Latitude is null || request.Longitude is null) {
            logger.LogWarning("Dispatch ride {RideId} office {OfficeId}: NO_PICKUP_LOCATION", rideId, request.TenantId);
            return [];
        }
        var cutoff = DateTimeOffset.UtcNow.AddSeconds(-policy.LocationMaxAgeSeconds);
        var point = new Point(request.Longitude.Value, request.Latitude.Value) { SRID = 4326 };
        // Geography distance executes in PostGIS in meters. Every source has the tenant query filter.
        var candidates = await (from driver in db.Set<Driver>()
            join location in db.Set<DriverLocation>() on driver.Id equals location.DriverId into locations
            from location in locations.DefaultIfEmpty()
            select new { Driver = driver, Location = location,
                VehicleReady = db.Set<Vehicle>().Any(v => v.Id == driver.CurrentVehicleId && v.Active && v.Status == "ACTIVE")
                    || driver.CurrentVehicleId == null && db.Set<Vehicle>().Count(v => v.DriverId == driver.Id && v.Active && v.Status == "ACTIVE") == 1,
                ActiveRide = db.Set<Ride>().Any(r => r.DriverId == driver.Id && r.Id != rideId && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving)),
                AlreadyOffered = db.Set<RideOffer>().Any(o => o.RideId == rideId && o.DriverId == driver.Id),
                DistanceMeters = location == null ? 0 : location.Position.Distance(point) }).ToListAsync();
        var result = new List<(Guid, double)>();
        foreach (var candidate in candidates)
        {
            var d = candidate.Driver;
            var reasons = new List<string>();
            if (d.TenantId != request.TenantId) reasons.Add("OFFICE_MISMATCH");
            if (!d.Active) reasons.Add("INACTIVE");
            if (d.Status != DriverStatus.Available) reasons.Add(d.Status == DriverStatus.Busy ? "BUSY" : "OFFLINE");
            var locationReason = LocationReason(candidate.Location, cutoff);
            if (locationReason != "READY") reasons.Add(locationReason);
            if (!candidate.VehicleReady) reasons.Add("NO_READY_VEHICLE");
            if (candidate.ActiveRide || await reception.HasActiveOrder(d.Id, exceptRequest: request.Id)) reasons.Add("ACTIVE_ORDER");
            if (candidate.AlreadyOffered) reasons.Add("ALREADY_OFFERED");
            if (reasons.Count == 0) result.Add((d.Id, candidate.DistanceMeters));
            else logger.LogInformation("Dispatch ride {RideId} office {OfficeId} driver {DriverId} excluded: {Reasons}; locationAt {LocationAt}, accuracy {Accuracy}", rideId, request.TenantId, d.Id, string.Join(",", reasons), candidate.Location?.UpdatedAt, candidate.Location?.Accuracy);
        }
        return result.OrderBy(x => x.Item2).ThenBy(x => x.Item1).ToList();
    }
    public static string LocationReason(DriverLocation? location, DateTimeOffset cutoff) => location is null ? "NO_LOCATION"
        : !double.IsFinite(location.Accuracy) || location.Accuracy is < 0 or > 200 ? "POOR_ACCURACY"
        : location.UpdatedAt < cutoff ? "STALE_LOCATION" : "READY";
    public async Task Next(Ride ride, RideRequest? request = null)
    {
        if (ride.DispatchMode == "MANUAL" || ride.Status != RideStatus.Pending) return;
        request ??= await db.Set<RideRequest>().SingleAsync(r => r.Id == ride.RideRequestId);
        if (request.ScheduledAt > DateTimeOffset.UtcNow) return;
        var policy = await Policy();
        var nearest = (await Nearest(request, ride.Id, policy)).FirstOrDefault();
        if (nearest.DriverId == Guid.Empty)
        {
            logger.LogWarning("Dispatch ride {RideId} office {OfficeId}: NO_DRIVER_AVAILABLE", ride.Id, request.TenantId);
            ride.DriverId = null; ride.OfferExpiresAt = null; ride.Status = RideStatus.NoDriverAvailable;
            await reception.SyncRide(ride);
            return;
        }
        var now = DateTimeOffset.UtcNow;
        ride.DriverId = nearest.DriverId; ride.Status = RideStatus.Assigned;
        ride.OfferExpiresAt = now.AddSeconds(policy.OfferTimeoutSeconds is >= 10 and <= 180 ? policy.OfferTimeoutSeconds : 30);
        db.Add(new RideOffer { RideId = ride.Id, DriverId = nearest.DriverId, OfferedAt = now, ExpiresAt = ride.OfferExpiresAt.Value, DistanceMeters = nearest.DistanceMeters });
        logger.LogInformation("Dispatch ride {RideId} office {OfficeId}: OFFERED driver {DriverId}, distance {DistanceMeters}, expires {ExpiresAt}", ride.Id, request.TenantId, nearest.DriverId, nearest.DistanceMeters, ride.OfferExpiresAt);
        await reception.SyncRide(ride);
    }
    public async Task CloseOffer(Ride ride, string outcome)
    {
        var offer = await db.Set<RideOffer>().SingleOrDefaultAsync(o => o.RideId == ride.Id && o.DriverId == ride.DriverId && o.Outcome == "OFFERED");
        if (offer is not null) offer.Outcome = outcome;
        ride.OfferExpiresAt = null;
    }
    public async Task Expire(Ride ride)
    {
        if (ride.DispatchMode == "MANUAL" || ride.Status != RideStatus.Assigned || ride.OfferExpiresAt is null) return;
        var outcome = ride.OfferExpiresAt <= DateTimeOffset.UtcNow ? "TIMEOUT" :
            await CanReceive(ride) ? null : "UNAVAILABLE";
        if (outcome is null) return;
        await Advance(ride, outcome);
    }
    public async Task<bool> CanReceive(Ride ride)
    {
        var cutoff = DateTimeOffset.UtcNow.AddSeconds(-(await Policy()).LocationMaxAgeSeconds);
        return await db.Set<Driver>().AnyAsync(d => d.Id == ride.DriverId && d.Active && d.Status == DriverStatus.Available
            && db.Set<DriverLocation>().Any(l => l.DriverId == d.Id && l.UpdatedAt >= cutoff && l.Accuracy >= 0 && l.Accuracy <= 200)
            && (db.Set<Vehicle>().Any(v => v.Id == d.CurrentVehicleId && v.Active && v.Status == "ACTIVE")
                || d.CurrentVehicleId == null && db.Set<Vehicle>().Count(v => v.DriverId == d.Id && v.Active && v.Status == "ACTIVE") == 1))
            && !await reception.HasActiveOrder(ride.DriverId!.Value, exceptRequest: ride.RideRequestId);
    }
    public async Task Advance(Ride ride, string outcome)
    {
        await CloseOffer(ride, outcome);
        ride.DriverId = null; ride.Status = RideStatus.Pending;
        await reception.SyncRide(ride); await db.SaveChangesAsync();
        await Next(ride);
    }
}

public sealed class DispatchWorker(IServiceScopeFactory scopes, ILogger<DispatchWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var catalog = scopes.CreateScope();
                var tenants = await catalog.ServiceProvider.GetRequiredService<TaxiDb>().Set<Tenant>().Select(t => t.Id).ToListAsync(stoppingToken);
                foreach (var id in tenants)
                {
                    using var scope = scopes.CreateScope();
                    scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = id;
                    var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                    var reception = scope.ServiceProvider.GetRequiredService<ReceptionService>();
                    var dispatch = scope.ServiceProvider.GetRequiredService<AutoDispatch>();
                    await using var tx = await db.Database.BeginTransactionAsync(stoppingToken); await reception.Lock();
                    var rides = await db.Set<Ride>().Where(r => r.DispatchMode != "MANUAL" && (r.Status == RideStatus.Pending || r.Status == RideStatus.Assigned)).OrderBy(r => r.Id).ToListAsync(stoppingToken);
                    foreach (var ride in rides) { await dispatch.Expire(ride); await dispatch.Next(ride); await db.SaveChangesAsync(stoppingToken); }
                    await tx.CommitAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception exception) { logger.LogWarning(exception, "Dispatch retry on next tick"); }
        }
    }
}
