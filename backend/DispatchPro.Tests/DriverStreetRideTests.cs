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
using Xunit;

namespace DispatchPro.Tests;

public sealed class DriverStreetRideTests
{
    [Fact]
    public void RejectsIdentityOverridesAndInvalidCoordinatesOrDestination()
    {
        var valid = new DriverStreetRideInput(Guid.NewGuid(), new("Destination"));
        ReceptionService.ValidateStreetRide(valid);
        foreach (var input in new[] { valid with { Id = Guid.Empty }, valid with { DriverId = Guid.NewGuid() }, valid with { TenantId = Guid.NewGuid() }, valid with { OfficeId = Guid.NewGuid() }, valid with { Destination = new("") }, valid with { Pickup = new("invalid", Latitude: 91, Longitude: 35, LocationSource: "MAP_PIN") }, valid with { Pickup = new("unverified device GPS", Latitude: 32, Longitude: 35, LocationSource: "CUSTOMER_GPS") }, valid with { FareMode = "OFFICE_OVERRIDE" } })
            Assert.Throws<ArgumentException>(() => ReceptionService.ValidateStreetRide(input));
    }

    [Fact]
    public async Task AnonymousCreationIsRejectedBeforeDatabaseAccess()
    {
        await using var factory = new ApiFactory("Host=127.0.0.1;Port=1;Database=not_contacted;Timeout=1");
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/driver/street-rides", new DriverStreetRideInput(Guid.NewGuid(), new("Destination")))).StatusCode);
    }

    // Uses a new isolated database, preserved for review; existing office accounts are untouched.
    [PostgresFact]
    public async Task RealStreetJourneyIsIdempotentTenantIsolatedAndUsesExistingCompleteAndQueue()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var database = "street_test_" + Guid.NewGuid().ToString("N");
        await using var admin = new Npgsql.NpgsqlConnection(connection); await admin.OpenAsync();
        await using (var create = new Npgsql.NpgsqlCommand($"CREATE DATABASE {database}", admin)) await create.ExecuteNonQueryAsync();
        await using var factory = new ApiFactory(new Npgsql.NpgsqlConnectionStringBuilder(connection) { Database = database }.ConnectionString);
        using (var scope = factory.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<TaxiDb>().Database.MigrateAsync();
        var suffix = Guid.NewGuid().ToString("N");
        const string password = "StreetRide-isolated-test-password!";
        async Task<(Guid Tenant, Guid Driver, Guid Place, Guid Inactive)> Fixture(string slug)
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
            await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = password }).Build());
            var role = await db.Set<Role>().SingleAsync(r => r.Name == "Driver");
            var user = new User { Username = "street-driver", RoleId = role.Id }; user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);
            var driver = new Driver { UserId = user.Id, FullName = "Isolated street test driver", Status = DriverStatus.Available };
            var place = new SuggestedPlace { Name = "Office active fixture", Latitude = 32.24, Longitude = 35.27, IsActive = true };
            var inactive = new SuggestedPlace { Name = "Office inactive fixture", Latitude = 32.25, Longitude = 35.28, IsActive = false };
            var queueLocation = new QueueLocation { Name = "Isolated queue", IsActive = true };
            db.AddRange(user, driver, place, inactive, queueLocation, new ReceptionQueue { DriverId = driver.Id, QueueLocationId = queueLocation.Id, Position = 1, Status = "WAITING" }, new DriverLocation { DriverId = driver.Id, Position = new Point(35.25, 32.22) { SRID = 4326 }, Accuracy = 10, UpdatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(); return (tenant.TenantId, driver.Id, place.Id, inactive.Id);
        }
        var slugA = "street-test-a-" + suffix; var slugB = "street-test-b-" + suffix;
        var a = await Fixture(slugA); var b = await Fixture(slugB);
        if (Environment.GetEnvironmentVariable("STREET_TEST_EVIDENCE") is { Length: > 0 } evidencePath)
            await File.WriteAllTextAsync(evidencePath, System.Text.Json.JsonSerializer.Serialize(new { slugA, slugB, driverA = a.Driver, driverB = b.Driver, tenantA = a.Tenant, tenantB = b.Tenant, placeA = a.Place, placeB = b.Place }));
        async Task<HttpClient> Login(string slug, string username)
        {
            var client = factory.CreateClient(); var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant = slug, username, password });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", JsonNode.Parse(await response.Content.ReadAsStringAsync())!["accessToken"]!.ToString()); return client;
        }
        using var driverA = await Login(slugA, "street-driver"); using var driverB = await Login(slugB, "street-driver"); using var officeA = await Login(slugA, "admin");
        async Task<JsonObject> Body(HttpResponseMessage response) { var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {text}"); return JsonNode.Parse(text)!.AsObject(); }
        var list = JsonNode.Parse(await (await driverA.GetAsync("/api/v1/driver/places")).Content.ReadAsStringAsync())!.AsArray();
        Assert.Single(list); Assert.Equal(a.Place.ToString(), list[0]!["id"]!.ToString());
        var input = new DriverStreetRideInput(Guid.NewGuid(), new("Chosen office place"), DestinationPlaceId: a.Place);
        Assert.Equal(HttpStatusCode.BadRequest, (await driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input with { DriverId = b.Driver })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input with { TenantId = b.Tenant })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input with { DestinationPlaceId = b.Place })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input with { DestinationPlaceId = a.Inactive })).StatusCode);
        var requests = await Task.WhenAll(driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input), driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input));
        foreach (var response in requests) Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var ride = await Body(await driverA.GetAsync($"/api/v1/driver/rides/{input.Id}"));
        Assert.Equal("InProgress", ride["status"]!.ToString()); Assert.Equal("DRIVER_STREET", ride["source"]!.ToString()); Assert.Equal(32.22, ride["latitude"]!.GetValue<double>()); Assert.Null(ride["finalFare"]);
        Assert.Equal(HttpStatusCode.Conflict, (await driverA.PostAsJsonAsync("/api/v1/driver/street-rides", input with { Id = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driverB.GetAsync($"/api/v1/driver/rides/{input.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await driverB.PutAsJsonAsync($"/api/v1/rides/{input.Id}/locations", new { version = 2, destination = new { addressText = "foreign edit" } })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await driverA.PutAsJsonAsync($"/api/v1/rides/{input.Id}/status", new { status = "Completed", version = ride["version"]!.GetValue<long>() })).StatusCode);
        var edit = await Body(await driverA.PutAsJsonAsync($"/api/v1/rides/{input.Id}/locations", new { version = ride["version"]!.GetValue<long>(), destination = new { addressText = "Changed street destination", locationSource = "MANUAL_TEXT" } }));
        var complete = await Body(await driverA.PutAsJsonAsync($"/api/v1/rides/{input.Id}/status", new { status = "Completed", version = edit["version"]!.GetValue<long>(), collectedFare = 34.5 }));
        Assert.Equal("Completed", complete["status"]!.ToString()); Assert.Equal(34.5m, complete["finalFare"]!.GetValue<decimal>()); Assert.Equal("DRIVER_MANUAL", complete["fareSource"]!.ToString());
        var history = await Body(await driverA.GetAsync("/api/v1/driver/history")); Assert.Single(history["items"]!.AsArray()); Assert.NotNull(history["items"]![0]!["startedAt"]); Assert.NotNull(history["items"]![0]!["completedAt"]);
        var office = await Body(await officeA.GetAsync("/api/v1/office")); Assert.Contains(input.Id.ToString(), office.ToJsonString());
        var report = await Body(await officeA.GetAsync("/api/v1/reception/reports/history?kind=orders&source=DRIVER_STREET&page=1")); Assert.Single(report["items"]!.AsArray()); Assert.NotNull(report["items"]![0]!["startedAt"]); Assert.NotNull(report["items"]![0]!["completedAt"]);
        using (var scope = factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = a.Tenant; var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
            Assert.Equal(0, await db.Set<Customer>().CountAsync()); Assert.Equal(1, await db.Set<Ride>().CountAsync()); Assert.Equal(0, await db.Set<RideOffer>().CountAsync());
            var row = await db.Set<Ride>().SingleAsync(); Assert.Equal(a.Driver, row.DriverId);
            Assert.Equal("WAITING", (await db.Set<ReceptionQueue>().SingleAsync()).Status); Assert.Equal(1, (await db.Set<ReceptionQueue>().SingleAsync()).Position);
            var audit = await db.Set<AuditLog>().SingleAsync(l => l.Action == "ride.locations-updated"); Assert.Contains("Office active fixture", audit.Detail); Assert.Contains("Changed street destination", audit.Detail);
        }
        // Existing configured GPS meter must start and finish, without a default manual price.
        var meter = input with { Id = Guid.NewGuid(), FareMode = "GPS_METER", Pickup = new("Explicit test map point", Latitude: 32.22, Longitude: 35.25, LocationSource: "MAP_PIN") };
        await Body(await driverA.PostAsJsonAsync("/api/v1/driver/street-rides", meter)); var meterRide = await Body(await driverA.GetAsync($"/api/v1/driver/rides/{meter.Id}")); Assert.NotNull(meterRide["meterStartedAt"]);
        var done = await Body(await driverA.PutAsJsonAsync($"/api/v1/rides/{meter.Id}/status", new { status = "Completed", version = meterRide["version"]!.GetValue<long>() })); Assert.Equal("GPS_METER", done["fareSource"]!.ToString()); Assert.NotNull(done["finalFare"]);
    }
}
