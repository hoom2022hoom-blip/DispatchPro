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

public sealed class CustomerDispatchWaitingTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
        return JsonNode.Parse(body)!;
    }

    [PostgresFact]
    public async Task CustomerWaitsWithoutReadyVehicleThenOffersOnceWhenDriverBecomesEligible()
    {
        var name = "customer_wait_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!) { Database = name }.ConnectionString);
            Guid officeId, driverId, vehicleClass;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
                await db.Database.MigrateAsync();
                await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
                    { ["Seed:TenantSlug"] = "customer-wait", ["Seed:AdminPassword"] = "Test-office-123!" }).Build());
                officeId = tenant.TenantId;
                vehicleClass = await db.Set<VehicleClass>().Select(v => v.Id).FirstAsync();
                var role = await db.Set<Role>().SingleAsync(r => r.Name == "Driver");
                var user = new User { Username = "waiting-driver", RoleId = role.Id };
                user.PasswordHash = new PasswordHasher<User>().HashPassword(user, "Test-driver-123!");
                var driver = new Driver { UserId = user.Id, FullName = "Isolated waiting driver", Status = DriverStatus.Available };
                driverId = driver.Id;
                db.AddRange(user, driver);
                await db.SaveChangesAsync();
                db.Add(new DriverLocation { DriverId = driverId, Position = new Point(35.25,32.22) { SRID = 4326 }, Accuracy = 5, UpdatedAt = DateTimeOffset.UtcNow });
                await db.SaveChangesAsync();
            }
            using var customer = factory.CreateClient();
            var registered = await Read(await customer.VerifiedRegistration( new
                { tenant = "customer-wait", accountId = Guid.NewGuid(), deviceSecret = new string('e',64), fullName = "Isolated customer", phone = "0591234567" }));
            customer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", registered["accessToken"]!.GetValue<string>());
            var rideId = Guid.NewGuid();
            var created = await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides", new
                { id = rideId, pickup = new { addressText = "Test pickup", latitude = 32.22, longitude = 35.25, locationSource = "CUSTOMER_GPS" }, destination = "Test destination" }));
            Assert.Equal("SEARCHING_DRIVER", created["status"]!.GetValue<string>());
            using (var scope = factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = officeId;
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                var reception = scope.ServiceProvider.GetRequiredService<ReceptionService>();
                var dispatch = scope.ServiceProvider.GetRequiredService<AutoDispatch>();
                await using var tx = await db.Database.BeginTransactionAsync();
                await reception.Lock();
                var ride = await db.Set<Ride>().SingleAsync(r => r.Id == rideId);
                Assert.Equal(RideStatus.Pending, ride.Status);
                Assert.Null(ride.DriverId);
                await dispatch.Next(ride);
                Assert.Equal(RideStatus.Pending, ride.Status);
                Assert.Empty(await db.Set<RideOffer>().Where(o => o.RideId == rideId).ToListAsync());
                Assert.Single(await db.Set<ReceptionOrder>().Where(o => o.RideRequestId == ride.RideRequestId).ToListAsync());
                db.Add(new Vehicle { DriverId = driverId, VehicleClassId = vehicleClass, Plate = "WAIT-TEST", Active = true, Status = "ACTIVE" });
                await db.SaveChangesAsync();
                await dispatch.Next(ride);
                await db.SaveChangesAsync();
                Assert.Equal(RideStatus.Assigned, ride.Status);
                Assert.Equal(driverId, ride.DriverId);
                await dispatch.Next(ride);
                var offer = Assert.Single(await db.Set<RideOffer>().Where(o => o.RideId == rideId).ToListAsync());
                Assert.Equal(driverId, offer.DriverId);
                Assert.Equal(officeId, offer.TenantId);
                Assert.Equal("OFFERED", offer.Outcome);
                // Exhausted offers retain the existing terminal state.
                await dispatch.Advance(ride, "REJECTED");
                await db.SaveChangesAsync();
                Assert.Equal(RideStatus.NoDriverAvailable, ride.Status);
                Assert.Equal("REJECTED", offer.Outcome);
                await tx.CommitAsync();
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
