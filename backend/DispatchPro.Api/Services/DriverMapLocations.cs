using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed record MapLocation(double Latitude, double Longitude, double Accuracy, DateTimeOffset UpdatedAt, string Source = "driver");
public sealed record MapLocationHistory(Guid DriverId, DriverGpsPoint? Latest, DriverGpsPoint? Previous);

public static class DriverMapLocations
{
    // One tenant-filtered SQL query, bounded to two recorded observations per driver.
    public static IQueryable<MapLocationHistory> History(TaxiDb db)
    {
        var points = db.Set<DriverGpsPoint>().AsNoTracking().Where(p => p.LocationAccepted &&
            p.Latitude >= -90 && p.Latitude <= 90 && p.Longitude >= -180 && p.Longitude <= 180);
        return db.Set<Driver>().AsNoTracking().Select(d => new MapLocationHistory(d.Id,
            points.Where(p => p.DriverId == d.Id).OrderByDescending(p => p.Timestamp).ThenByDescending(p => p.Id).FirstOrDefault(),
            points.Where(p => p.DriverId == d.Id).OrderByDescending(p => p.Timestamp).ThenByDescending(p => p.Id).Skip(1).FirstOrDefault()));
    }

    public static MapLocation? Latest(DriverLocation? snapshot, DriverGpsPoint? history)
    {
        var position = snapshot?.Position;
        MapLocation? latest = position is not null && Valid(position.Y, position.X)
            ? new(position.Y, position.X, snapshot!.Accuracy, snapshot.UpdatedAt, snapshot.Source) : null;
        if (history is not null && Valid(history.Latitude, history.Longitude) && (latest is null || history.Timestamp > latest.UpdatedAt))
            latest = new(history.Latitude, history.Longitude, history.Accuracy, history.Timestamp, history.Source);
        return latest;
    }

    public static string Freshness(MapLocation? location, DateTimeOffset now, int age) => location is null ? "NO_LOCATION"
        : location.UpdatedAt >= now.AddSeconds(-age) && location.UpdatedAt <= now.AddSeconds(10)
          && double.IsFinite(location.Accuracy) && location.Accuracy is >= 0 and <= 200 ? "FRESH" : "STALE";

    private static bool Valid(double latitude, double longitude) => double.IsFinite(latitude) && double.IsFinite(longitude)
        && latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;
}
