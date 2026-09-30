using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;
public sealed class UnitTests
{
    [Theory]
    [InlineData("0591234567", "+970591234567")]
    [InlineData("+970591234567", "+970591234567")]
    [InlineData("0561234567", "+970561234567")]
    public void NormalizesPhone(string input, string expected) => Assert.Equal(expected, PalestinianPhone.Normalize(input));
    [Theory]
    [InlineData("+972591234567")][InlineData("059123456")][InlineData("05912345678")][InlineData("abc")][InlineData("")][InlineData("０５９１２３４５６７")]
    public void RejectsPhone(string input) => Assert.Throws<ArgumentException>(() => PalestinianPhone.Normalize(input));
    [Fact]
    public void MeterUsesNightVehicleZoneAndServices()
    {
        var rule = new PricingRule { Mode = PricingMode.GpsMeter, BaseFare = 10, PerKm = 2, PerMinute = 1, WaitingPerMinute = 3, NightPercent = 20, NightFixed = 2 };
        var result = PricingEngine.Calculate(rule, new PricingProfile { TimeZone = "UTC" }, new(5, 10, 2, DateTimeOffset.Parse("2026-01-01T23:00:00Z")), vehicle: new VehicleClass { Multiplier = 2 }, zone: new ZonePrice { AdditionalFare = 4 }, services: [new ServiceSurcharge { Amount = 5 }]);
        Assert.Equal(99.4m, result);
    }
    [Theory]
    [InlineData(21, 10)][InlineData(22, 15)][InlineData(5, 15)][InlineData(6, 10)]
    public void NightBoundary(int hour, decimal expected) => Assert.Equal(expected, PricingEngine.Calculate(new PricingRule { Mode = PricingMode.GpsMeter, BaseFare = 10, NightFixed = 5 }, new PricingProfile { TimeZone = "UTC" }, new(0, 0, 0, new DateTimeOffset(2026, 1, 1, hour, 0, 0, TimeSpan.Zero))));
    [Fact]
    public void MinimumAndReturnAndManual()
    {
        var profile = new PricingProfile(); var input = new MeterInput(0, 0, 0, DateTimeOffset.UtcNow, true);
        Assert.Null(PricingEngine.Calculate(new PricingRule { Mode = PricingMode.Manual }, profile, input));
        Assert.Equal(50, PricingEngine.Calculate(new PricingRule { Mode = PricingMode.FixedRoute }, profile, input, new FixedRoutePrice { Outbound = 40, Return = 50 }));
        Assert.Equal(12, PricingEngine.Calculate(new PricingRule { Mode = PricingMode.Hybrid, MinimumFare = 12 }, profile, input));
        Assert.Throws<ArgumentException>(() => PricingEngine.Calculate(new PricingRule { Mode = PricingMode.FixedRoute }, profile, input));
        Assert.Throws<ArgumentException>(() => PricingEngine.Calculate(new PricingRule(), profile, input with { Kilometers = -1 }));
    }
    [Fact]
    public void TerminalRidesCannotRestart()
    {
        Assert.False(TaxiEndpoints.CanTransition(RideStatus.Completed, RideStatus.InProgress));
        Assert.False(TaxiEndpoints.CanTransition(RideStatus.Pending, RideStatus.Completed));
        Assert.True(TaxiEndpoints.CanTransition(RideStatus.Assigned, RideStatus.Accepted));
    }
}
