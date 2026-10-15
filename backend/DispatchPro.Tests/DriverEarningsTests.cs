using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DispatchPro.Tests;

public sealed class DriverEarningsTests
{
    [Fact]
    public void SummaryUsesFinalFaresAcrossSourcesAndSeparatesMissingZeroAndCurrencies()
    {
        var rows = new List<DriverEarningRide> {
            new() { FinalFare = 12.50m, Currency = "ILS", FareSource = "OFFICE_MANUAL" },
            new() { FinalFare = 10m, Currency = "ILS", FareSource = "DRIVER_MANUAL" },
            new() { FinalFare = 7.25m, Currency = "ILS", FareSource = "GPS_METER" },
            new() { FinalFare = 0m, Currency = "ILS", FareSource = "OFFICE_OVERRIDE" },
            new() { FinalFare = null, Currency = "ILS" },
            new() { FinalFare = 8m, Currency = "USD" }
        };
        rows.AddRange(Enumerable.Range(0, 25).Select(_ => new DriverEarningRide { FinalFare = 1m, Currency = "ILS" }));
        var result = DriverEarnings.Summarize(rows, "2026-10-03", "Asia/Jerusalem");
        Assert.Equal(31, result.CompletedTrips);
        Assert.Equal(1, result.MissingFareTrips);
        Assert.Equal(54.75m, result.Totals.Single(t => t.Currency == "ILS").Amount);
        Assert.Equal(8m, result.Totals.Single(t => t.Currency == "USD").Amount);
        Assert.Empty(DriverEarnings.Summarize(new[] { new DriverEarningRide() }, "2026-10-03", "Asia/Jerusalem").Totals);
    }
    [Fact]
    public void EarningsQueryTranslatesCompletionDatePagingDriverAndTenantFilters()
    {
        var tenant = new TenantContext { TenantId = Guid.NewGuid() };
        using var db = new TaxiDb(new DbContextOptionsBuilder<TaxiDb>().UseNpgsql("Host=localhost;Database=earnings", o => o.UseNetTopologySuite()).Options, tenant);
        var driver = Guid.NewGuid();
        var start = DateTimeOffset.UtcNow.Date;
        var end = start.AddDays(1);
        var query = DriverEarnings.Completed(db, driver).Where(r => r.CompletedAt >= start && r.CompletedAt < end);
        var sql = query.OrderByDescending(r => r.CompletedAt).ThenByDescending(r => r.Id).Skip(20).Take(20).ToQueryString();
        Assert.Contains("ride.notification.Completed", sql);
        Assert.Contains("\"Status\" = 5", sql);
        Assert.Contains("\"DriverId\"", sql);
        Assert.Contains("\"TenantId\"", sql);
        Assert.Contains("\"FinalFare\"", sql);
        Assert.Contains("LIMIT", sql);
        Assert.DoesNotContain("COALESCE", sql);
    }
}
