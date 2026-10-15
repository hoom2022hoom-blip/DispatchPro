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

public sealed class IndependentCustomerDispatchTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
        return JsonNode.Parse(body)!;
    }

    [PostgresFact]
    public async Task CustomerGpsRejectTimeoutAcceptTrackingAndOfficeWithoutOfficeLogin()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name = "independent_customer_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(connection);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(connection) { Database = name }.ConnectionString);
            var ids = new List<Guid>();
            Guid tenantId;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
                await db.Database.MigrateAsync();
                await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
                { ["Seed:TenantSlug"] = "independent-customer", ["Seed:AdminPassword"] = "Independent-office-123!" }).Build());
                tenantId = tenant.TenantId;
                // Office remains MANUAL throughout; only customer requests auto-dispatch.
                db.Add(new DispatchPolicy { Mode = "MANUAL", OfferTimeoutSeconds = 10 });
                var role = await db.Set<Role>().SingleAsync(r => r.Name == "Driver");
                var vehicleClass = await db.Set<VehicleClass>().FirstAsync();
                for (var i = 0; i < 8; i++)
                {
                    var user = new User { Username = "independent-driver-" + i, RoleId = role.Id };
                    user.PasswordHash = new PasswordHasher<User>().HashPassword(user, "Independent-driver-123!");
                    var driver = new Driver { UserId = user.Id, FullName = "Independent driver " + i,
                        Phone = "0591234500", Active = i != 5,
                        Status = i == 4 ? DriverStatus.Offline : i == 6 ? DriverStatus.Busy : DriverStatus.Available };
                    var vehicle = new Vehicle { DriverId = driver.Id, VehicleClassId = vehicleClass.Id, Plate = "TEST-" + i, Make = "Test car", Status = i == 7 ? "MAINTENANCE" : "ACTIVE" };
                    db.AddRange(user, driver); await db.SaveChangesAsync();
                    db.Add(vehicle); await db.SaveChangesAsync();
                    driver.CurrentVehicleId = i == 0 ? null : vehicle.Id;
                    ids.Add(driver.Id);
                    // Closer but stale/offline/inactive/busy drivers must never receive offers.
                    if (i >= 3) db.Add(new DriverLocation { DriverId = driver.Id,
                        Position = new Point(35.25, 32.22) { SRID = 4326 }, Accuracy = 5,
                        UpdatedAt = DateTimeOffset.UtcNow.AddSeconds(i == 3 ? -1000 : -20) });
                    await db.SaveChangesAsync();
                }
            }
            async Task<HttpClient> Login(string user, string password)
            {
                var client = factory.CreateClient();
                var data = await Read(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant = "independent-customer", username = user, password }));
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", data["accessToken"]!.GetValue<string>());
                return client;
            }
            var drivers = new List<HttpClient>();
            for (var i = 0; i < 3; i++)
            {
                var client = await Login("independent-driver-" + i, "Independent-driver-123!");
                drivers.Add(client);
                await Read(await client.PutAsJsonAsync("/api/v1/driver/location", new { latitude = 32.22, longitude = 35.251 + i * .001, accuracy = 8, capturedAt = DateTimeOffset.UtcNow }));
            }
            using var customer = factory.CreateClient();
            var registered = await Read(await customer.VerifiedRegistration( new
            { tenant = "independent-customer", accountId = Guid.NewGuid(), deviceSecret = new string('d', 64), fullName = "Independent test customer", phone = "0591234567" }));
            customer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered["accessToken"]!.GetValue<string>());
            var id = Guid.NewGuid();
            var input = new { id, pickup = new { addressText = "GPS pickup", latitude = 32.22, longitude = 35.25, locationSource = "CUSTOMER_GPS" },
                destination = "Map destination", destinationLocation = new { addressText = "Map destination", latitude = 32.23, longitude = 35.27, locationSource = "MAP_PIN" } };
            // No office login has occurred, and no office token is sent for creation.
            var creationLatency=System.Diagnostics.Stopwatch.StartNew();
            var created = await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", input));
            LocalLatency.Record("customer_create_confirmed_local_api_ms",creationLatency.Elapsed.TotalMilliseconds);
            Assert.Equal("SEARCHING_DRIVER", created["rideStatus"]!.GetValue<string>());
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", input));
            async Task<JsonArray> Offers(HttpClient driver) => (await Read(await driver.GetAsync("/api/v1/driver/updates")))["data"]!["rides"]!.AsArray();
            async Task<JsonNode> CustomerRide() => await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}"));
            var offerLatency=System.Diagnostics.Stopwatch.StartNew();
            var first = Assert.Single(await Offers(drivers[0]))!;
            LocalLatency.Record("driver_read_assigned_offer_local_api_ms",offerLatency.Elapsed.TotalMilliseconds);
            Assert.Empty(await Offers(drivers[1])); Assert.Empty(await Offers(drivers[2]));
            Assert.Equal(32.22, first["latitude"]!.GetValue<double>());
            Assert.Equal(35.27, first["destinationLongitude"]!.GetValue<double>());
            Assert.InRange(first["offerDistanceMeters"]!.GetValue<double>(), 50, 150);
            Assert.NotNull(first["offerExpiresAt"]);
            var timed = await Read(await drivers[0].GetAsync("/api/v1/driver/updates"));
            var serverTime = DateTimeOffset.Parse(timed["serverTime"]!.GetValue<string>());
            var expires = DateTimeOffset.Parse(first["offerExpiresAt"]!.GetValue<string>());
            Assert.InRange((expires - serverTime).TotalSeconds, 1, 10);
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var ride = await db.Set<Ride>().SingleAsync(r => r.Id == id);
                await scope.ServiceProvider.GetRequiredService<AutoDispatch>().Expire(ride);
                Assert.Equal(ids[0], ride.DriverId);
                Assert.Equal(RideStatus.Assigned, ride.Status);
            }
            Assert.Null((await CustomerRide())["driver"]); // Offers are not accepted assignments.
            Assert.Equal(32.22, (await CustomerRide())["pickupLocation"]!["latitude"]!.GetValue<double>());
            Assert.Equal(35.27, (await CustomerRide())["destinationLocation"]!["longitude"]!.GetValue<double>());
            await Read(await drivers[0].PutAsJsonAsync($"/api/v1/driver/rides/{id}/reject", new { version = first["version"]!.GetValue<long>() }));
            var second = Assert.Single(await Offers(drivers[1]))!;
            Assert.Empty(await Offers(drivers[0])); Assert.Empty(await Offers(drivers[2]));
            // Let the real hosted worker expire the offer, with no database clock manipulation.
            JsonArray third = [];
            var deadline = DateTimeOffset.UtcNow.AddSeconds(22);
            while (third.Count == 0 && DateTimeOffset.UtcNow < deadline)
            { await Task.Delay(500); third = await Offers(drivers[2]); }
            var offered = Assert.Single(third)!;
            Assert.Empty(await Offers(drivers[1]));
            Assert.Equal(HttpStatusCode.NotFound, (await drivers[1].PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status = "Accepted", version = second["version"]!.GetValue<long>() })).StatusCode);
            var before = await Read(await customer.GetAsync("/api/v1/customer-app/updates"));
            var waiting = customer.GetAsync("/api/v1/customer-app/updates?cursor=" + before["cursor"]!.GetValue<string>());
            await Read(await drivers[2].PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status = "Accepted", version = offered["version"]!.GetValue<long>() }));
            var changed = await Read(await waiting.WaitAsync(TimeSpan.FromSeconds(5)));
            Assert.Equal("DRIVER_ASSIGNED", changed["rides"]![0]!["rideStatus"]!.GetValue<string>());
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var ride = await db.Set<Ride>().SingleAsync(r => r.Id == id);
                Assert.Null(ride.OfferExpiresAt);
                var dispatch = scope.ServiceProvider.GetRequiredService<AutoDispatch>();
                await dispatch.Expire(ride); await dispatch.Next(ride);
                Assert.Equal(RideStatus.Accepted, ride.Status);
                Assert.Equal(ids[2], ride.DriverId);
                Assert.Equal(3, await db.Set<RideOffer>().CountAsync(o => o.RideId == id));
            }
            var assigned = await CustomerRide();
            Assert.Equal("Independent driver 2", assigned["driver"]!["fullName"]!.GetValue<string>());
            Assert.Equal("TEST-2", assigned["vehicle"]!["plate"]!.GetValue<string>());
            Assert.NotNull(assigned["tracking"]);
            // Office opens only after the whole request / reject / timeout / accept flow.
            using var office = await Login("admin", "Independent-office-123!");
            Assert.Equal("MANUAL", (await Read(await office.GetAsync("/api/v1/dispatch/policy")))["mode"]!.GetValue<string>());
            async Task<JsonNode> OfficeRide() => Assert.Single((await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray())!;
            Assert.Equal(ids[2].ToString(), (await OfficeRide())["driverId"]!.GetValue<string>());
            foreach (var (status, expected) in new[] { ("DriverArriving", "DRIVER_ARRIVING"), ("Arrived", "DRIVER_ARRIVED"), ("InProgress", "IN_PROGRESS"), ("Completed", "COMPLETED") })
            {
                var current = await Read(await drivers[2].GetAsync($"/api/v1/driver/rides/{id}"));
                var arrivalLatency=System.Diagnostics.Stopwatch.StartNew();
                await Read(await drivers[2].PutAsJsonAsync($"/api/v1/rides/{id}/status", new { status, version = current["version"]!.GetValue<long>(), collectedFare = status=="Completed"?(decimal?)30:null }));
                Assert.Equal(expected, (await CustomerRide())["rideStatus"]!.GetValue<string>());
                if(status=="Arrived")LocalLatency.Record("arrived_commit_and_customer_read_local_api_ms",arrivalLatency.Elapsed.TotalMilliseconds);
                Assert.Equal(expected, (await OfficeRide())["rideStatus"]!.GetValue<string>());
            }
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var offers = await db.Set<RideOffer>().Where(o => o.RideId == id).OrderBy(o => o.OfferedAt).ToListAsync();
                Assert.Equal(new[] { "REJECTED", "TIMEOUT", "ACCEPTED" }, offers.Select(o => o.Outcome));
                Assert.Equal(ids.Take(3), offers.Select(o => o.DriverId));
                Assert.Single(await db.Set<RideRequest>().ToListAsync());
                Assert.DoesNotContain(offers, o => o.Outcome == "OFFERED");
            }
            // Exercise the actual reception write endpoint used by staff to override dispatch.
            var overrideId = Guid.NewGuid();
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", input with { id = overrideId }));
            async Task<JsonNode> OverrideRow() => (await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray().Single(r => r!["id"]!.GetValue<string>() == overrideId.ToString())!;
            var overrideRow = await OverrideRow();
            Assert.Equal(ids[0].ToString(), overrideRow["driverId"]!.GetValue<string>());
            overrideRow["driverId"] = ids[1].ToString();
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{overrideId}", overrideRow));
            Assert.Empty(await Offers(drivers[0]));
            // Reception intentionally separates choosing a replacement from Send.
            overrideRow = await OverrideRow();
            Assert.Equal(ids[1].ToString(), overrideRow["driverId"]!.GetValue<string>());
            overrideRow["status"] = "assigned"; overrideRow["dispatchStatus"] = "SENT"; overrideRow["receptionPending"] = false;
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{overrideId}", overrideRow));
            Assert.Equal(overrideId.ToString(), Assert.Single(await Offers(drivers[1]))!["id"]!.GetValue<string>());
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = tenantId;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var overridden = await db.Set<Ride>().SingleAsync(r => r.Id == overrideId);
                Assert.Equal("MANUAL", overridden.DispatchMode); Assert.Null(overridden.OfferExpiresAt);
                Assert.Equal("OFFICE_OVERRIDE", (await db.Set<RideOffer>().SingleAsync(o => o.RideId == overrideId)).Outcome);
            }
            overrideRow = await OverrideRow(); overrideRow["status"] = "cancelled"; overrideRow["dispatchStatus"] = "CANCELLED";
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{overrideId}", overrideRow));
            Assert.Equal("CANCELLED", (await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{overrideId}")))["rideStatus"]!.GetValue<string>());
            foreach (var driver in drivers) driver.Dispose();
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
