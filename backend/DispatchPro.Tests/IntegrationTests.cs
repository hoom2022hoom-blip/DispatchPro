using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;

public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute() { if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES"))) Skip = "Set TAXI_TEST_POSTGRES to a disposable PostgreSQL/PostGIS server connection"; }
}
public sealed class ApiFactory(string connection) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureTestServices(services=>{services.RemoveAll<ICustomerSmsSender>();services.AddSingleton<ICustomerSmsSender,TestCustomerSms>();}).ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["ConnectionStrings:Taxi"] = connection,
        ["Auth:SigningKey"] = "integration-test-only-signing-key-0123456789",
    }));
}
public sealed class IntegrationTests
{
    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
        return JsonDocument.Parse(body).RootElement.Clone();
    }
    [PostgresFact]
    public async Task RealPostgresMigrationTenantSecurityPricingAndRideLifecycle()
    {
        var adminConnection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var database = "taxi_test_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(adminConnection); await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {database}", admin)) await create.ExecuteNonQueryAsync();
        var connection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = database }.ConnectionString;
        try
        {
            await using var factory = new ApiFactory(connection);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                await db.Database.MigrateAsync();
                Assert.Empty(await db.Database.GetPendingMigrationsAsync());
                await db.Database.MigrateAsync(); // repeatable migration
                var context = scope.ServiceProvider.GetRequiredService<TenantContext>();
                foreach (var slug in new[] { "office-a", "office-b" })
                {
                    var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "Test-only-Password-123!" }).Build();
                    await Seed.RunAsync(db, context, config); await Seed.RunAsync(db, context, config);
                }
            }
            using var anonymous = factory.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync("/health/ready")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/customers")).StatusCode);
            anonymous.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "invalid-token");
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/customers")).StatusCode);
            using var a = factory.CreateClient(); using var b = factory.CreateClient();
            foreach (var pair in new[] { (a, "office-a"), (b, "office-b") })
            {
                var login = await Json(await pair.Item1.PostAsJsonAsync("/api/v1/auth/login", new { tenant = pair.Item2, username = "admin", password = "Test-only-Password-123!" }));
                pair.Item1.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.GetProperty("accessToken").GetString());
            }
            var customer = await Json(await a.PostAsJsonAsync("/api/v1/customers", new { fullName = "زبون تجريبي", phone = "0591234567" }));
            Assert.Equal("0591234567", customer.GetProperty("phone").GetString());
            var customerId = customer.GetProperty("id").GetGuid();
            Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/v1/customers", new { fullName = "Duplicate", phone = "+970591234567" })).StatusCode);
            Assert.Empty((await Json(await b.GetAsync("/api/v1/customers"))).EnumerateArray());
            await Json(await b.PostAsJsonAsync("/api/v1/customers", new { fullName = "Other office", phone = "0591234567" }));
            a.DefaultRequestHeaders.Add("X-Tenant-Id", Guid.NewGuid().ToString());
            Assert.Single((await Json(await a.GetAsync("/api/v1/customers"))).EnumerateArray());
            var request = new { customerId, pickup = "نابلس", destination = "رام الله", source = "MANUAL" };
            Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/v1/ride-requests", request)).StatusCode);
            var ride = await Json(await a.PostAsJsonAsync("/api/v1/ride-requests", request));
            var rideId = ride.GetProperty("id").GetGuid();
            var rules = await Json(await a.GetAsync("/api/v1/pricing/rules"));
            var rule = rules.EnumerateArray().Single(r => r.GetProperty("mode").GetString() == "Hybrid");
            var ruleId = rule.GetProperty("id").GetGuid();
            var zone = await Json(await a.PostAsJsonAsync("/api/v1/pricing/zones", new { pricingRuleId = ruleId, name = "Test zone", additionalFare = 3, boundaryWkt = "POLYGON ((35 32, 36 32, 36 33, 35 33, 35 32))" }));
            Assert.StartsWith("POLYGON", zone.GetProperty("boundaryWkt").GetString());
            var zones = await Json(await a.GetAsync("/api/v1/pricing/zones"));
            Assert.Equal(zone.GetProperty("boundaryWkt").GetString(), zones[0].GetProperty("boundaryWkt").GetString());
            Assert.Equal(HttpStatusCode.Conflict, (await b.PostAsJsonAsync("/api/v1/pricing/zones", new { pricingRuleId = ruleId, name = "Cross-office zone", additionalFare = 3 })).StatusCode);
            var quoteInput = new { pricingRuleId = ruleId, meter = new { kilometers = 5, minutes = 10, waitingMinutes = 0, at = "2026-01-01T12:00:00Z" } };
            Assert.Equal(HttpStatusCode.BadRequest, (await b.PostAsJsonAsync("/api/v1/pricing/quote", quoteInput)).StatusCode);
            var quote = await Json(await a.PostAsJsonAsync("/api/v1/pricing/quote", quoteInput)); Assert.Equal(20, quote.GetProperty("amount").GetDecimal());
            var price = await Json(await a.PostAsJsonAsync($"/api/v1/rides/{rideId}/price", quoteInput));
            var adjustment = new { finalPrice = 25, reason = "انتظار إضافي", version = price.GetProperty("version").GetInt64() };
            var adjusted = await Json(await a.PutAsJsonAsync($"/api/v1/rides/{rideId}/price/adjustment", adjustment));
            Assert.Equal(5, adjusted.GetProperty("manualAdjustment").GetDecimal());
            Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync($"/api/v1/rides/{rideId}/price/adjustment", adjustment)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/v1/rides/{rideId}/price")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await a.PutAsync("/api/v1/features/GpsMeter?enabled=false", null)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await a.PostAsJsonAsync("/api/v1/pricing/quote", quoteInput)).StatusCode);
            var roles = await Json(await a.GetAsync("/api/v1/roles"));
            var driverRole = roles.EnumerateArray().Single(r => r.GetProperty("name").GetString() == "Driver").GetProperty("id").GetGuid();
            var user = await Json(await a.PostAsJsonAsync("/api/v1/users", new { username = "driver", password = "Driver-test-password-123!", roleId = driverRole }));
            var driver = await Json(await a.PostAsJsonAsync("/api/v1/drivers", new { userId = user.GetProperty("id").GetGuid(), fullName = "Test driver", status = "Available" }));
            ride = await Json(await a.PutAsJsonAsync($"/api/v1/rides/{rideId}/assignment", new { driverId = driver.GetProperty("id").GetGuid(), version = adjusted.GetProperty("version").GetInt64() }));
            var secondRide = await Json(await a.PostAsJsonAsync("/api/v1/ride-requests", request));
            Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync($"/api/v1/rides/{secondRide.GetProperty("id").GetGuid()}/assignment", new { driverId = driver.GetProperty("id").GetGuid(), version = secondRide.GetProperty("version").GetInt64() })).StatusCode);
            using var d = factory.CreateClient();
            var driverLogin = await Json(await d.PostAsJsonAsync("/api/v1/auth/login", new { tenant = "office-a", username = "driver", password = "Driver-test-password-123!" }));
            d.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", driverLogin.GetProperty("accessToken").GetString());
            Assert.Equal(HttpStatusCode.Forbidden, (await d.GetAsync("/api/v1/customers")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await d.GetAsync($"/api/v1/driver/rides/{secondRide.GetProperty("id").GetGuid()}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await d.PutAsJsonAsync($"/api/v1/rides/{rideId}/price/adjustment", adjustment)).StatusCode);
            Assert.Equal(System.Text.Json.JsonValueKind.Null, (await Json(await d.GetAsync($"/api/v1/driver/rides/{rideId}"))).GetProperty("phone").ValueKind);
            foreach (var status in new[] { "Accepted", "Arrived", "InProgress", "Completed" })
            {
                ride = await Json(await d.PutAsJsonAsync($"/api/v1/rides/{rideId}/status", new { status, version = ride.GetProperty("version").GetInt64() }));
                Assert.Equal("0591234567", (await Json(await d.GetAsync($"/api/v1/driver/rides/{rideId}"))).GetProperty("phone").GetString());
            }
            var audit = await Json(await a.GetAsync("/api/v1/audit"));
            Assert.Contains(audit.EnumerateArray(), e => e.GetProperty("action").GetString() == "price.adjusted");
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var context = scope.ServiceProvider.GetRequiredService<TenantContext>();
                context.TenantId = customer.GetProperty("tenantId").GetGuid();
                var log = await db.Set<AuditLog>().FirstAsync(); log.Detail = "overwrite";
                await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
                db.ChangeTracker.Clear();
                db.Add(new Customer { TenantId = Guid.NewGuid(), FullName = "Attack", Phone = "0590000000" });
                await Assert.ThrowsAsync<UnauthorizedAccessException>(() => db.SaveChangesAsync());
                db.ChangeTracker.Clear();
                var foreignTenant = await db.Set<Tenant>().SingleAsync(t => t.Slug == "office-b");
                context.TenantId = foreignTenant.Id;
                db.Add(new RideRequest { CustomerId = customerId });
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", admin); await drop.ExecuteNonQueryAsync();
        }
    }
}
