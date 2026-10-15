using System.Collections.Concurrent;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;

namespace DispatchPro.Api.Services;

public static class MobileAppAccess
{
    public static bool Allowed(Driver driver, string application) => driver.Active && driver.Status != DriverStatus.Suspended
        && (application == "radio" ? driver.VoiceEnabled : driver.DriverAppEnabled);
    public static bool Prefer(DriverLocation? current, DriverLocationInput next, DateTimeOffset now)
    {
        if (current is null) return true;
        if (next.CapturedAt <= current.UpdatedAt) return false;
        // Keep the more accurate recent observation; let newer fixes replace stale ones.
        var age = next.CapturedAt - current.UpdatedAt;
        return current.UpdatedAt < now.AddSeconds(-30) || age >= TimeSpan.FromSeconds(30)
            || next.Accuracy < current.Accuracy * .75
            || age >= TimeSpan.FromSeconds(10) && next.Accuracy <= Math.Max(50, current.Accuracy * 2);
    }
}

// Connection presence is process-local and expires; GPS timestamps never imply connectivity.
public sealed class MobilePresence
{
    private readonly ConcurrentDictionary<(Guid Tenant, Guid Driver, string App), DateTimeOffset> seen = new();
    public void Touch(Guid tenant, Guid driver, string app) => seen[(tenant, driver, app)] = DateTimeOffset.UtcNow;
    public object Read(Guid tenant, Guid driver, string app) {
        var at = seen.TryGetValue((tenant, driver, app), out var value) ? (DateTimeOffset?)value : null;
        return new { connected = at > DateTimeOffset.UtcNow.AddSeconds(-75), lastSeenAt = at };
    }
}
