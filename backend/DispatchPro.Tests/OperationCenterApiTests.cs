using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;
public sealed class OperationCenterApiTests
{
    [PostgresFact]
    public async Task RealMigrationMapAndAuthenticatedVoicePermissions()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin = new NpgsqlConnection(connection); await admin.OpenAsync();
        var name = "taxi_operation_" + Guid.NewGuid().ToString("N");
        await using (var command = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await command.ExecuteNonQueryAsync();
        await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(connection) { Database = name }.ConnectionString);
        var driverId = Guid.NewGuid(); var vehicleId = Guid.NewGuid();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
            await db.Database.MigrateAsync(); Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"] = "operation-test", ["Seed:AdminPassword"] = "Operation-Test-123!" }).Build());
            var role = await db.Set<Role>().SingleAsync(r => r.Name == "Driver");
            var user = new User { Username = "driver-test", RoleId = role.Id }; user.PasswordHash = new PasswordHasher<User>().HashPassword(user, "Operation-Test-123!");
            var driver = new Driver { Id = driverId, UserId = user.Id, FullName = "Real Driver", Status = DriverStatus.Available };
            db.AddRange(user, driver); await db.SaveChangesAsync();
            var vehicleClass = await db.Set<VehicleClass>().FirstAsync();
            db.Add(new Vehicle { Id = vehicleId, DriverId = driverId, VehicleClassId = vehicleClass.Id, Plate = "REAL-321" }); await db.SaveChangesAsync();
            driver.CurrentVehicleId = vehicleId;
            var request = new RideRequest { Pickup = "Real pickup", Destination = "Real destination", Latitude = 32.2, Longitude = 35.2, DestinationLatitude = 32.3, DestinationLongitude = 35.3 };
            db.AddRange(request, new Ride { RideRequestId = request.Id, DriverId = driverId, Status = RideStatus.DriverArriving }, new ReceptionOrder { RideRequestId = request.Id, ExternalId = "office-order", Number = 17, Day = "2026-10-05" });
            await db.SaveChangesAsync();
        }
        using var office = factory.CreateClient(); using var driverClient = factory.CreateClient();
        async Task<JsonNode> Read(HttpResponseMessage r) { var b = await r.Content.ReadAsStringAsync(); Assert.True(r.IsSuccessStatusCode, $"{r.StatusCode}: {b}"); return JsonNode.Parse(b)!; }
        async Task Login(HttpClient c, string username) { var r = await Read(await c.PostAsJsonAsync("/api/v1/auth/login", new { tenant = "operation-test", username, password = "Operation-Test-123!" })); c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", r["accessToken"]!.GetValue<string>()); }
        await Login(office, "admin"); await Login(driverClient, "driver-test");
        var mapResponse = await office.GetAsync("/api/v1/office/driver-map"); var map = await Read(mapResponse); var row = Assert.Single(map["drivers"]!.AsArray())!;
        Assert.Equal("REAL-321", row["vehicle"]!["plate"]!.GetValue<string>());
        Assert.Equal("office-order", row["currentRide"]!["orderId"]!.GetValue<string>()); Assert.Equal(17, row["currentRide"]!["orderNumber"]!.GetValue<int>());
        Assert.Equal("Real pickup", row["currentRide"]!["pickup"]!.GetValue<string>()); Assert.True(row["voice"]!["canListen"]!.GetValue<bool>());
        using var conditional = new HttpRequestMessage(HttpMethod.Get,"/api/v1/office/driver-map"); conditional.Headers.IfNoneMatch.Add(mapResponse.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await office.SendAsync(conditional)).StatusCode);
        var os = (await Read(await office.PostAsJsonAsync("/api/v1/voice/session", new {})))["peer"]!["id"]!.GetValue<Guid>();
        var ds = (await Read(await driverClient.PostAsJsonAsync("/api/v1/voice/session", new {})))["peer"]!["id"]!.GetValue<Guid>();
        var publicFloor = await Read(await driverClient.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = ds, channel = "public" }));
        var officeFloor = await Read(await office.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = os, channel = "public" }));
        Assert.NotEqual(publicFloor["id"]!.GetValue<Guid>(), officeFloor["id"]!.GetValue<Guid>());
        Assert.False((await Read(await driverClient.PostAsJsonAsync("/api/v1/voice/heartbeat", new { sessionId = ds, floorId = publicFloor["id"]!.GetValue<Guid>() })))["held"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Forbidden, (await driverClient.PutAsJsonAsync("/api/v1/voice/settings", new { muted = true })).StatusCode);
        var permissions = new VoicePermissionInput(true, true, false, true, false);
        await Read(await office.PutAsJsonAsync($"/api/v1/voice/drivers/{driverId}", permissions));
        Assert.Equal(HttpStatusCode.Forbidden, (await driverClient.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = ds, channel = "public" })).StatusCode);
        await Read(await office.PostAsJsonAsync("/api/v1/voice/release",new{sessionId=os,floorId=officeFloor["id"]!.GetValue<Guid>()}));
        var privateFloor = await Read(await driverClient.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = ds, channel = "private", driverId = Guid.NewGuid() }));
        Assert.Equal(driverId, privateFloor["driverId"]!.GetValue<Guid>());
        await Read(await office.PutAsJsonAsync($"/api/v1/voice/drivers/{driverId}", permissions with { IsVoiceBlocked = true }));
        Assert.False((await Read(await driverClient.PostAsJsonAsync("/api/v1/voice/heartbeat", new { sessionId = ds, floorId = privateFloor["id"]!.GetValue<Guid>() })))["held"]!.GetValue<bool>());
        var updates = await Read(await driverClient.GetAsync($"/api/v1/voice/updates?sessionId={ds}")); Assert.True(updates["access"]!["canListen"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Forbidden, (await driverClient.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = os, channel = "public" })).StatusCode);
        await Read(await office.PutAsJsonAsync($"/api/v1/voice/drivers/{driverId}", permissions with { CanTalkPublic = true }));
        await Read(await office.PutAsJsonAsync("/api/v1/voice/settings", new { muted = true }));
        Assert.Equal(HttpStatusCode.Forbidden, (await driverClient.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = ds, channel = "public" })).StatusCode);
        Assert.NotNull(await Read(await driverClient.PostAsJsonAsync("/api/v1/voice/floor", new { sessionId = ds, channel = "private" })));
    }
}
