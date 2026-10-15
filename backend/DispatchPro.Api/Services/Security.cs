using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
namespace DispatchPro.Api.Services;
public static class Permissions
{
    public static readonly string[] All = ["customers.read", "customers.write", "rides.read", "rides.write", "rides.drive", "pricing.read", "pricing.write", "pricing.adjust", "settings.write", "users.write", "audit.read", "reception.ingest"];
}
public sealed class TokenService(IConfiguration config)
{
    public string Issue(User user, string? sessionId = null, string? customerSessionId = null, string? application = null)
    {
        var claims = new List<Claim> { new Claim("sub", user.Id.ToString()), new Claim("tenant", user.TenantId.ToString()) };
        if(application is not null)claims.Add(new Claim("mobile_app",application));
        if(sessionId is not null)claims.Add(new Claim("office_session",sessionId));
        if(customerSessionId is not null)claims.Add(new Claim("customer_session",customerSessionId));
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(config["Auth:Issuer"] ?? "DispatchPro", config["Auth:Audience"] ?? "DispatchPro", claims, expires: DateTime.UtcNow.AddMinutes(30), signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Auth:SigningKey"]!)), SecurityAlgorithms.HmacSha256)));
    }
}
public static class Seed
{
    public static async Task RunAsync(TaxiDb db, TenantContext context, IConfiguration config)
    {
        var slug = config["Seed:TenantSlug"] ?? throw new InvalidOperationException("Seed:TenantSlug required");
        var password = config["Seed:AdminPassword"] ?? throw new InvalidOperationException("Seed:AdminPassword required");
        if (password.Length < 8) throw new InvalidOperationException("Seed password must contain at least 8 characters");
        if (await db.Set<Tenant>().AnyAsync(t => t.Slug == slug)) return;
        var tenant = new Tenant { Slug = slug, Name = config["Seed:TenantName"] ?? slug };
        context.TenantId = tenant.Id;
        var admin = new Role { Name = "Administrator" };
        var dispatcher = new Role { Name = "Dispatcher" };
        var driver = new Role { Name = "Driver" };
        var user = new User { Username = config["Seed:AdminUsername"] ?? "admin", RoleId = admin.Id };
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);
        var profile = new PricingProfile { Name = "Default" };
        db.Add(tenant);
        db.AddRange(admin, dispatcher, driver, user, new Office { Name = tenant.Name }, profile);
        foreach (var code in Permissions.All) db.Add(new Permission { RoleId = admin.Id, Code = code });
        foreach (var code in new[] { "customers.read", "customers.write", "rides.read", "rides.write", "pricing.read" }) db.Add(new Permission { RoleId = dispatcher.Id, Code = code });
        db.Add(new Permission { RoleId = driver.Id, Code = "rides.drive" });
        foreach (var name in new[] { "Economy", "Standard", "SUV", "Accessible" }) db.Add(new VehicleClass { Name = name });
        foreach (var mode in Enum.GetValues<PricingMode>()) db.Add(new PricingRule { PricingProfileId = profile.Id, Mode = mode, BaseFare = 10, PerKm = 2, MinimumFare = 10 });
        foreach (var key in new[] { "ElectronicPayment", "ScheduledBooking", "AutoDispatch", "Chat", "Calling", "CallerId", "WhatsApp", "GpsMeter", "ManualPricing", "FixedRoutePricing", "ZonePricing", "VehicleClasses", "SpecialServices" }) db.Add(new FeatureFlag { Key = key, Enabled = key is "ManualPricing" or "GpsMeter" or "FixedRoutePricing" or "VehicleClasses" or "SpecialServices" or "ZonePricing" });
        await db.SaveChangesAsync();
    }
}
