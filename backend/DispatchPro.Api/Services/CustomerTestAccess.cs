using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

// Test verification is separate from production phone ownership. Authorization
// exists only while the server explicitly runs the CustomerTest Debug build.
public static class CustomerTestAccess
{
    public const string Office = "office-test-ba6da3f686";
    public const string EnvironmentName = "CustomerTest";
    public sealed record Verification(string PhoneKey, DateTimeOffset? Expires = null);

    public static bool Enabled(IHostEnvironment? environment, IConfiguration? configuration)
    {
#if DEBUG
        return environment?.EnvironmentName == EnvironmentName && configuration?.GetValue<bool>("CustomerTest:Enabled") == true;
#else
        return false;
#endif
    }
    public static async Task<bool> Allowed(TaxiDb db, TenantContext context, IHostEnvironment? environment, IConfiguration? configuration, CancellationToken ct = default)
        => Enabled(environment, configuration) && await db.Set<Tenant>().AnyAsync(t => t.Id == context.TenantId && t.Slug == Office, ct);

    public static async Task<bool> Verified(TaxiDb db, TenantContext context, string phone, IHostEnvironment? environment, IConfiguration? configuration)
    {
        if (!await Allowed(db, context, environment, configuration)) return false;
        var key = CustomerOtp.VerifiedKey(context.TenantId, phone);
        var rows = await db.Set<AuditLog>().Where(a => a.ActorId == context.ActorId && a.Action == "customer.phone.test-verified").Select(a => a.Detail).ToListAsync();
        return rows.Any(detail => { try { return JsonSerializer.Deserialize<Verification>(detail)?.PhoneKey == key; } catch { return false; } });
    }
}
