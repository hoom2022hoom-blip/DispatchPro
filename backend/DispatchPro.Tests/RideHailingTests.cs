using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;
public sealed class RideHailingTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}"); return JsonNode.Parse(body)!;
    }
    [PostgresFact]
    public async Task LocationNearestRejectTimeoutAcceptanceReceptionAndTenantIsolation()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name = "hailing_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(connection); await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(connection) { Database = name }.ConnectionString);
            var ids = new List<Guid>(); Guid tenantA = Guid.Empty;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
                await db.Database.MigrateAsync(); await db.Database.MigrateAsync();
                foreach (var slug in new[] { "hailing-a", "hailing-b" })
                {
                    await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "Test-hailing-password-123!" }).Build());
                    if (slug == "hailing-a") tenantA = tenant.TenantId;
                    var role = await db.Set<Role>().SingleAsync(r => r.Name == "Driver");
                    for (var i = 0; i < (slug == "hailing-a" ? 6 : 1); i++)
                    {
                        var user = new User { Username = "driver" + i, RoleId = role.Id };
                        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, "Driver-hailing-password-123!");
                        var driver = new Driver { UserId = user.Id, FullName = "Driver " + i, Phone = "0591234500", Status = DriverStatus.Available, Active = i != 4 };
                        if (i == 5) driver.Status = DriverStatus.Busy;
                        db.AddRange(user, driver); await db.SaveChangesAsync();
                        if (slug == "hailing-a") ids.Add(driver.Id);
                        // Stale, inactive, busy and cross-tenant drivers are all closer than eligible drivers.
                        var lon = slug == "hailing-b" || i >= 3 ? 35.25 : 35.251 + i * .001;
                        db.Add(new DriverLocation { DriverId = driver.Id, Position = new Point(lon, 32.22) { SRID = 4326 }, Accuracy = 10, UpdatedAt = DateTimeOffset.UtcNow.AddSeconds(i == 3 ? -1000 : -20) });
                        await db.SaveChangesAsync();
                    }
                }
            }
            async Task<HttpClient> Login(string slug, string username = "admin")
            {
                var client = factory.CreateClient();
                var data = await Read(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant = slug, username, password = username == "admin" ? "Test-hailing-password-123!" : "Driver-hailing-password-123!" }));
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", data["accessToken"]!.GetValue<string>()); return client;
            }
            using var office = await Login("hailing-a"); using var otherOffice = await Login("hailing-b");
            using var first = await Login("hailing-a", "driver0"); using var second = await Login("hailing-a", "driver1"); using var third = await Login("hailing-a", "driver2");
            Assert.Equal("MANUAL", (await Read(await office.GetAsync("/api/v1/dispatch/policy")))["mode"]!.GetValue<string>());
            await Read(await office.PutAsJsonAsync("/api/v1/dispatch/policy", new { mode = "AUTO_NEAREST", locationMaxAgeSeconds = 120, offerTimeoutSeconds = 30 }));
            await Read(await first.PutAsJsonAsync("/api/v1/driver/location", new { latitude = 32.22, longitude = 35.251, accuracy = 8, capturedAt = DateTimeOffset.UtcNow }));
            Assert.Equal(HttpStatusCode.BadRequest, (await first.PutAsJsonAsync("/api/v1/driver/location", new { latitude = 92, longitude = 35.25, accuracy = 8, capturedAt = DateTimeOffset.UtcNow })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await first.PutAsJsonAsync("/api/v1/driver/location", new { latitude = 32, longitude = 35, accuracy = 8, capturedAt = DateTimeOffset.UtcNow.AddHours(-1) })).StatusCode);
            using var customer = factory.CreateClient();
            var account = await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/register", new { tenant = "hailing-a", accountId = Guid.NewGuid(), deviceSecret = new string('c',64), fullName = "Hailing Customer", phone = "0591234567" }));
            customer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", account["accessToken"]!.GetValue<string>());
            var id = Guid.NewGuid();
            var input = new { id, pickup = new { addressText = "Pickup", latitude = 32.22, longitude = 35.25, locationSource = "MAP_PIN" }, destination = "Destination", destinationLocation = new { addressText = "Destination", latitude = 32.23, longitude = 35.27, locationSource = "MAP_PIN" } };
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", input));
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", input));
            async Task<JsonNode> Ride() => (await Read(await office.GetAsync($"/api/v1/rides/{id}")))["ride"]!;
            var ride = await Ride(); Assert.Equal(ids[0].ToString(), ride["driverId"]!.GetValue<string>());
            var customerBefore = await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}")); Assert.Null(customerBefore["driver"]); Assert.Null(customerBefore["tracking"]);
            Assert.Equal(HttpStatusCode.NotFound, (await otherOffice.GetAsync($"/api/v1/rides/{id}")).StatusCode);
            Assert.Empty((await Read(await otherOffice.GetAsync("/api/v1/dispatch/rides"))).AsArray());
            Assert.Equal(HttpStatusCode.Forbidden, (await customer.PutAsJsonAsync("/api/v1/dispatch/policy", new { mode = "MANUAL" })).StatusCode);
            await Read(await first.PutAsJsonAsync($"/api/v1/driver/rides/{id}/reject", new { version = ride["version"]!.GetValue<long>() }));
            ride = await Ride(); Assert.Equal(ids[1].ToString(), ride["driverId"]!.GetValue<string>());
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantA;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var stored = await db.Set<Ride>().SingleAsync(r => r.Id == id); stored.OfferExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1); await db.SaveChangesAsync();
                var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == stored.RideRequestId); Assert.Equal(32.23, request.DestinationLatitude);
            }
            ride = await Ride();
            Assert.Equal(HttpStatusCode.Conflict, (await second.PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status = "Accepted", version = ride["version"]!.GetValue<long>() })).StatusCode);
            // Exercise the actual hosted timeout worker without a client triggering dispatch.
            for (var i = 0; i < 30 && ride["driverId"]?.GetValue<string>() != ids[2].ToString(); i++) { await Task.Delay(300); ride = await Ride(); }
            Assert.Equal(ids[2].ToString(), ride["driverId"]!.GetValue<string>());
            await Read(await third.PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status = "Accepted", version = ride["version"]!.GetValue<long>() }));
            var visible = await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}"));
            Assert.Equal("ACCEPTED", visible["status"]!.GetValue<string>()); Assert.Equal("Driver 2", visible["driver"]!["fullName"]!.GetValue<string>()); Assert.Null(visible["driver"]!["phone"]);
            Assert.NotNull(visible["tracking"]); Assert.True(visible["tracking"]!["etaMinutes"]!.GetValue<int>() > 0);
            var reception = await Read(await office.GetAsync("/api/v1/reception/snapshot"));
            Assert.Equal("driver-accepted", Assert.Single(reception["rides"]!.AsArray())!["status"]!.GetValue<string>());
            var monitor = Assert.Single((await Read(await office.GetAsync("/api/v1/dispatch/rides"))).AsArray())!;
            Assert.Equal("ACCEPTED", monitor["status"]!.GetValue<string>()); Assert.NotNull(monitor["tracking"]);
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantA;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var offers = await db.Set<RideOffer>().Where(o => o.RideId == id).OrderBy(o => o.OfferedAt).ToListAsync();
                Assert.Equal(new[] { "REJECTED", "TIMEOUT", "ACCEPTED" }, offers.Select(o => o.Outcome));
                Assert.Equal(3, offers.Select(o => o.DriverId).Distinct().Count());
                Assert.All(offers, o => Assert.Equal(tenantA, o.TenantId));
                Assert.All(offers, o => Assert.InRange(o.DistanceMeters, 50, 1000));
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)", admin); await drop.ExecuteNonQueryAsync();
        }
    }
}
