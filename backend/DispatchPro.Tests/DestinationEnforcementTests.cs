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

public sealed class DestinationEnforcementTests
{
    [Fact]
    public void DestinationRejectsMissingAndWhitespaceAndTrimsText()
    {
        foreach (var text in new string?[] { null, "", " \t\n", new('a', 501) })
            Assert.Throws<ArgumentException>(() => Locations.RequiredDestination(text));
        Assert.Equal("الجامعة", Locations.RequiredDestination("  الجامعة  "));
        foreach (var text in new string?[] { null, "", " \t\n" }) Assert.Equal("", Locations.OfficeDestination(text));
        Assert.Equal("الجامعة", Locations.OfficeDestination("  الجامعة  "));
        Assert.Throws<ArgumentException>(() => Locations.OfficeDestination(new('a', 501)));
    }

    [PostgresFact]
    public async Task RealEndpointsEnforceDestinationPreserveDraftsAndUpdateActiveMapForAllSources()
    {
        var database = "taxi_destination_test_" + Guid.NewGuid().ToString("N");
        var adminConnection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin = new NpgsqlConnection(adminConnection);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {database}", admin)) await create.ExecuteNonQueryAsync();
        var connection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = database }.ConnectionString;
        try
        {
            await using var factory = new ApiFactory(connection);
            const string password = "Destination-test-only-123!";
            Guid tenantId, driverId, driverUserId, placeId;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
                await db.Database.MigrateAsync();
                foreach (var slug in new[] { "destination-b", "destination-a" })
                    await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = password }).Build());
                tenantId = tenant.TenantId;
                var role = await db.Set<Role>().SingleAsync(r => r.Name == "Driver");
                var user = new User { Username = "destination-driver", RoleId = role.Id };
                user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);
                var driver = new Driver { UserId = user.Id, FullName = "Destination test driver", Status = DriverStatus.Available };
                var vehicleClass = await db.Set<VehicleClass>().FirstAsync();
                var vehicle = new Vehicle { DriverId = driver.Id, VehicleClassId = vehicleClass.Id, Plate = "DESTINATION-TEST" };
                var place = new SuggestedPlace { Name = "رفيديا - المستشفى", Latitude = 32.24, Longitude = 35.27, IsActive = true };
                db.AddRange(user, driver, vehicle, place,
                    new DriverLocation { DriverId = driver.Id, Position = new Point(35.25, 32.22) { SRID = 4326 }, Accuracy = 10, UpdatedAt = DateTimeOffset.UtcNow });
                await db.SaveChangesAsync(); driverId = driver.Id; driverUserId = user.Id; placeId = place.Id;
                // Historical data without a destination remains readable/editable.
                var oldRequest = new RideRequest { Pickup = "Old pickup", AddressText = "Old pickup", Destination = "" };
                db.AddRange(oldRequest, new Ride { RideRequestId = oldRequest.Id, Status = RideStatus.Completed });
                await db.SaveChangesAsync();
            }
            static async Task<JsonNode> Read(HttpResponseMessage response)
            {
                var body = await response.Content.ReadAsStringAsync();
                Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
                return JsonNode.Parse(body)!;
            }
            async Task<HttpClient> Login(string slug, string username)
            {
                var client = factory.CreateClient();
                var login = await Read(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant = slug, username, password }));
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login["accessToken"]!.ToString());
                return client;
            }
            using var office = await Login("destination-a", "admin");
            using var other = await Login("destination-b", "admin");
            using var driverClient = await Login("destination-a", "destination-driver");
            using var customer = factory.CreateClient();
            var registered = await Read(await customer.VerifiedRegistration( new { tenant = "destination-a", accountId = Guid.NewGuid(), deviceSecret = new string('a', 64), fullName = "Destination customer", phone = "0591234567" }));
            customer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered["accessToken"]!.ToString());

            foreach (var destination in new[] { "", " \t " })
            {
                var id = Guid.NewGuid().ToString();
                await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{id}", new { id, source = "MANUAL", status = "pending", pickup = (object?)null, dropoff = new { name = destination }, totalFare = (decimal?)null }));
                var optionalRide = await Read(await office.PostAsJsonAsync("/api/v1/ride-requests", new { pickup = "Pickup", destination, source = "MANUAL" }));
                var optionalDetail = await Read(await office.GetAsync($"/api/v1/rides/{optionalRide["id"]}"));
                Assert.Equal("", optionalDetail["request"]!["destination"]!.ToString());
                optionalRide = await Read(await office.PutAsJsonAsync($"/api/v1/rides/{optionalRide["id"]}/assignment", new { driverId, version = optionalRide["version"]!.GetValue<long>() }));
                foreach (var status in new[] { "Accepted", "DriverArriving", "Arrived", "InProgress", "Completed" })
                    optionalRide = await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{optionalRide["id"]}/status", new { status, version = optionalRide["version"]!.GetValue<long>(), collectedFare = status == "Completed" ? (decimal?)18 : null }));
                var ready = await Read(await driverClient.GetAsync("/api/v1/driver/updates"));
                Assert.Equal("Available", ready["data"]!["driver"]!["status"]!.ToString());
                Assert.Empty(ready["data"]!["rides"]!.AsArray());
                Assert.Equal(HttpStatusCode.BadRequest, (await customer.PostAsJsonAsync("/api/v1/customer-app/rides", new { id = Guid.NewGuid(), pickup = new { addressText = "Pickup" }, destination })).StatusCode);
                Assert.Equal(HttpStatusCode.BadRequest, (await driverClient.PostAsJsonAsync("/api/v1/driver/street-rides", new DriverStreetRideInput(Guid.NewGuid(), new(destination)))).StatusCode);
            }
            await Read(await office.PutAsync("/api/v1/features/CallerId?enabled=true", null));
            await Read(await office.PostAsJsonAsync("/api/v1/reception/calls", new ReceptionEvent("destination-draft", "LANDLINE_ICALL", "0591234567", DateTimeOffset.UtcNow.ToString("O"))));
            var snapshot = await Read(await office.GetAsync("/api/v1/reception/snapshot"));
            var draft = snapshot["rides"]!.AsArray().Single(r => r!["callEventId"]?.ToString() == "destination-draft")!.AsObject();
            var draftId = draft["id"]!.ToString();
            Assert.Null(draft["backendRideId"]);
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                Assert.Equal(5, await db.Set<Ride>().CountAsync());
                Assert.Null((await db.Set<ReceptionOrder>().SingleAsync(r => r.ExternalId == draftId)).RideRequestId);
            }
            draft["pickup"] = new JsonObject { ["name"] = "Office pickup" };
            draft["receptionPending"] = false;
            draft = (await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{draft["id"]}", draft))).AsObject();
            draft["dropoff"] = new JsonObject { ["name"] = "Office destination", ["coords"] = new JsonObject { ["x"] = 32.24, ["y"] = 35.27 } };
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{draft["id"]}", draft));
            snapshot = await Read(await office.GetAsync("/api/v1/reception/snapshot"));
            var officeRide = snapshot["rides"]!.AsArray().Single(r => r!["id"]?.ToString() == draft["id"]!.ToString())!;
            var cleared = officeRide.DeepClone().AsObject(); cleared["dropoff"] = null;
            cleared = (await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{draft["id"]}", cleared))).AsObject();
            cleared["dropoff"] = officeRide["dropoff"]!.DeepClone();
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{draft["id"]}", cleared));
            var officeRideId = Guid.Parse(officeRide["backendRideId"]!.ToString());

            async Task AssertFlow(Guid id, string destination, bool street = false)
            {
                if (!street)
                {
                    var detail = await Read(await office.GetAsync($"/api/v1/rides/{id}"));
                    if (detail["ride"]!["status"]!.ToString() != "Assigned")
                        await Read(await office.PutAsJsonAsync($"/api/v1/rides/{id}/assignment", new { driverId, version = detail["ride"]!["version"]!.GetValue<long>() }));
                    var offered = await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{id}"));
                    Assert.Equal(destination, offered["destination"]!.ToString());
                    await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status = "Accepted", version = offered["version"]!.GetValue<long>() }));
                }
                var ride = await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{id}"));
                Assert.Equal(destination, ride["destination"]!.ToString());
                var map = await Read(await office.GetAsync("/api/v1/office/driver-map"));
                Assert.Equal(destination, map["drivers"]!.AsArray().Single(d => d!["id"]!.ToString() == driverId.ToString())!["currentRide"]!["destination"]!.ToString());
                if (id == officeRideId)
                {
                    for (var position = 1; position <= 3; position++)
                    {
                        var waiting = await Read(await office.PostAsJsonAsync("/api/v1/ride-requests", new { pickup = "Waiting pickup", destination = "Waiting destination " + position, source = "MANUAL" }));
                        var response = await office.PostAsJsonAsync("/api/v1/reception/jobs", new { type = "send", rideId = waiting["id"]!.ToString(), driverId, version = waiting["version"]!.GetValue<long>() });
                        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
                    }
                    map = await Read(await office.GetAsync("/api/v1/office/driver-map"));
                    var mapDriver = map["drivers"]!.AsArray().Single(d => d!["id"]!.ToString() == driverId.ToString())!;
                    Assert.Equal(3, mapDriver["waitingCount"]!.GetValue<int>());
                    Assert.Equal(destination, mapDriver["currentRide"]!["destination"]!.ToString());
                    while (true)
                    {
                        var jobs = (await Read(await office.GetAsync("/api/v1/reception/jobs"))).AsArray();
                        if (jobs.Count == 0) break;
                        var job = jobs[0]!;
                        Assert.Equal(HttpStatusCode.NoContent, (await office.PostAsJsonAsync("/api/v1/reception/jobs", new { type = "remove", rideId = job["rideId"]!.ToString(), version = job["version"]!.GetValue<long>() })).StatusCode);
                    }
                }
                var changed = await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{id}/locations", new { version = ride["version"]!.GetValue<long>(), destination = new { addressText = "Updated " + destination, latitude = 32.25, longitude = 35.28, locationSource = "MAP_PIN" } }));
                map = await Read(await office.GetAsync("/api/v1/office/driver-map"));
                Assert.Equal("Updated " + destination, map["drivers"]!.AsArray().Single(d => d!["id"]!.ToString() == driverId.ToString())!["currentRide"]!["destination"]!.ToString());
                var after = await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{id}"));
                Assert.Equal(ride["fareMode"]!.ToString(), after["fareMode"]!.ToString());
                Assert.Equal(ride["finalFare"]?.ToJsonString(), after["finalFare"]?.ToJsonString());
                Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/v1/rides/{id}")).StatusCode);
                Assert.Empty((await Read(await other.GetAsync("/api/v1/office/driver-map")))["drivers"]!.AsArray());
                using (var scope = factory.Services.CreateScope())
                {
                    scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                    var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                    var persisted = await db.Set<Ride>().SingleAsync(r => r.Id == id);
                    Assert.Equal(driverId, persisted.DriverId);
                    var audit = await db.Set<AuditLog>().SingleAsync(a => a.EntityId == id && a.Action == "ride.locations-updated" && a.ActorId == driverUserId);
                    Assert.Equal(driverUserId, audit.ActorId);
                    var auditData = JsonNode.Parse(audit.Detail)!;
                    Assert.Equal(destination, auditData["previous"]!["destination"]!.ToString());
                    Assert.Equal("Updated " + destination, auditData["next"]!["destination"]!.ToString());
                }
                await Read(await office.PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status = "Cancelled", version = changed["version"]!.GetValue<long>() }));
            }
            await AssertFlow(officeRideId, "Office destination");
            // Customer GPS uses the existing server-side nearest-driver dispatch.
            var customerRide = await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", new { id = Guid.NewGuid(), pickup = new { addressText = "Customer pickup", latitude = 32.22, longitude = 35.25, locationSource = "CUSTOMER_GPS" }, destination = "Customer destination" }));
            await AssertFlow(Guid.Parse(customerRide["id"]!.ToString()), "Customer destination");
            var street = new DriverStreetRideInput(Guid.NewGuid(), new("رفيديا - المستشفى"), Pickup: new("Explicit map pickup", Latitude: 32.22, Longitude: 35.25, LocationSource: "MAP_PIN"), DestinationPlaceId: placeId);
            await Read(await driverClient.PostAsJsonAsync("/api/v1/driver/street-rides", street));
            await AssertFlow(street.Id, "رفيديا - المستشفى", street: true);
            // A suggested pickup works without a stored device GPS location.
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                await db.Set<DriverLocation>().Where(l => l.DriverId == driverId).ExecuteDeleteAsync();
            }
            foreach (var suggestedDestination in new[] { true, false })
            {
                var text = suggestedDestination ? "رفيديا - المستشفى" : "جامعة النجاح - الحرم الجديد";
                var withoutGps = new DriverStreetRideInput(Guid.NewGuid(), new(text), DestinationPlaceId: suggestedDestination ? placeId : null, PickupPlaceId: placeId);
                await Read(await driverClient.PostAsJsonAsync("/api/v1/driver/street-rides", withoutGps));
                using (var scope = factory.Services.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                    scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                    var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == db.Set<Ride>().Where(r => r.Id == withoutGps.Id).Select(r => r.RideRequestId).Single());
                    Assert.Equal(32.24, request.Latitude);
                    Assert.Equal(35.27, request.Longitude);
                    if (!suggestedDestination) { Assert.Null(request.DestinationLatitude); Assert.Null(request.DestinationLongitude); Assert.Equal(text, request.Destination); }
                }
                await AssertFlow(withoutGps.Id, text, street: true);
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
