using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed class DriverEarningRide
{
    public Guid Id { get; init; }
    public string Pickup { get; init; } = "";
    public string Destination { get; init; } = "";
    public DateTimeOffset? CompletedAt { get; init; }
    public decimal? FinalFare { get; init; }
    public string Currency { get; init; } = "";
    public string FareMode { get; init; } = "";
    public string? FareSource { get; init; }
}
public sealed record DriverEarningsTotal(string Currency, decimal Amount);
public sealed record DriverEarningsSummary(string Date, string TimeZone, int CompletedTrips, int MissingFareTrips, DriverEarningsTotal[] Totals);

// A read-only view over the existing ride lifecycle and final fares.
public static class DriverEarnings
{
    public static IQueryable<DriverEarningRide> Completed(TaxiDb db, Guid driverId) =>
        from ride in db.Set<Ride>().AsNoTracking()
        join request in db.Set<RideRequest>() on ride.RideRequestId equals request.Id
        where ride.DriverId == driverId && ride.Status == RideStatus.Completed
        select new DriverEarningRide { Id = ride.Id, Pickup = request.Pickup, Destination = request.Destination,
            CompletedAt = db.Set<AuditLog>().Where(a => a.EntityId == ride.Id && a.Action == "ride.notification.Completed").Select(a => (DateTimeOffset?)a.CreatedAt).Min(),
            FinalFare = ride.FinalFare, Currency = ride.Currency, FareMode = ride.FareMode, FareSource = ride.FareSource };

    public static async Task<DriverEarningsSummary> Today(TaxiDb db, Guid driverId)
        => await Period(db,driverId,"today");

    public static async Task<DriverEarningsSummary> Period(TaxiDb db, Guid driverId, string period)
    {
        var range=await Range(db,period);
        var rows=await Completed(db,driverId).Where(r=>r.CompletedAt>=range.Start&&r.CompletedAt<range.End).ToListAsync();
        return Summarize(rows,range.Date,range.ZoneId);
    }

    public static async Task<(DateTimeOffset Start,DateTimeOffset End,string Date,string ZoneId)> Range(TaxiDb db,string period)
    {
        var zoneId = await db.Set<Office>().Select(o => o.TimeZone).FirstOrDefaultAsync() ?? "Asia/Jerusalem";
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var date = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).Date;
        var first=period=="month"?new DateTime(date.Year,date.Month,1):period=="week"?date.AddDays(-(int)date.DayOfWeek):date;
        var start = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(first, DateTimeKind.Unspecified), zone));
        var end = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(date.AddDays(1), DateTimeKind.Unspecified), zone));
        return (start,end,first.ToString("yyyy-MM-dd")+ (period=="today"?"":" → "+date.ToString("yyyy-MM-dd")),zoneId);
    }

    public static DriverEarningsSummary Summarize(IReadOnlyCollection<DriverEarningRide> rows, string date, string zoneId) =>
        new(date, zoneId, rows.Count, rows.Count(r => r.FinalFare == null),
            rows.Where(r => r.FinalFare.HasValue).GroupBy(r => r.Currency).Select(g => new DriverEarningsTotal(g.Key, g.Sum(r => r.FinalFare!.Value))).ToArray());
}
