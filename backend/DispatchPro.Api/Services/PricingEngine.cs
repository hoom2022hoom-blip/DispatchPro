using DispatchPro.Api.Domain;

namespace DispatchPro.Api.Services;

public sealed record MeterInput(decimal Kilometers, decimal Minutes, decimal WaitingMinutes, DateTimeOffset At, bool ReturnTrip = false);
public static class PricingEngine
{
    public static decimal? Calculate(PricingRule rule, PricingProfile profile, MeterInput input, FixedRoutePrice? route = null, VehicleClass? vehicle = null, ZonePrice? zone = null, IReadOnlyList<ServiceSurcharge>? services = null)
    {
        Validate(rule);
        if (input.Kilometers is < 0 or > 10000 || input.Minutes is < 0 or > 100000 || input.WaitingMinutes is < 0 or > 100000) throw new ArgumentException("Invalid meter values");
        if (rule.Mode == PricingMode.Manual) return null;
        decimal value = rule.Mode == PricingMode.FixedRoute
            ? route is null ? throw new ArgumentException("Fixed route required") : input.ReturnTrip ? route.Return : route.Outbound
            : rule.BaseFare + input.Kilometers * rule.PerKm + input.Minutes * rule.PerMinute + input.WaitingMinutes * rule.WaitingPerMinute;
        var hour = TimeZoneInfo.ConvertTime(input.At, TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)).Hour;
        bool night = rule.NightStartHour != rule.NightEndHour && (rule.NightStartHour < rule.NightEndHour ? hour >= rule.NightStartHour && hour < rule.NightEndHour : hour >= rule.NightStartHour || hour < rule.NightEndHour);
        if (night) value = value * (1 + rule.NightPercent / 100) + rule.NightFixed;
        value *= vehicle?.Multiplier ?? 1;
        value += (zone?.AdditionalFare ?? 0) + (services?.Sum(s => s.Amount) ?? 0);
        return decimal.Round(Math.Max(rule.MinimumFare, value), 2, MidpointRounding.AwayFromZero);
    }
    public static void Validate(PricingRule rule)
    {
        if (!Enum.IsDefined(rule.Mode) || new[] { rule.BaseFare, rule.PerKm, rule.PerMinute, rule.MinimumFare, rule.WaitingPerMinute, rule.NightFixed }.Any(x => x is < 0 or > 10000000) || rule.NightPercent is < 0 or > 1000 || rule.NightStartHour is < 0 or > 23 || rule.NightEndHour is < 0 or > 23) throw new ArgumentException("Invalid pricing rule");
    }
}
