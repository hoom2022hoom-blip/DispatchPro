using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;
public sealed class FinalMasterAccountTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage r){var body=await r.Content.ReadAsStringAsync();Assert.True(r.IsSuccessStatusCode,$"{r.StatusCode}: {body}");return JsonNode.Parse(body)!;}
    [PostgresFact]
    public async Task AccountReusesDriverIdentityAndExplicitUnlinkCannotFallbackToLegacyVehicle()
    {
        var name="master_"+Guid.NewGuid().ToString("N");
        await using var catalog=new NpgsqlConnection(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!);await catalog.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",catalog))await create.ExecuteNonQueryAsync();
        try{
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!){Database=name}.ConnectionString);
            Guid tenantId,classId;
            using(var scope=factory.Services.CreateScope()){
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();await db.Database.MigrateAsync();
                await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="master-test",["Seed:AdminPassword"]="Master-test-admin-123!"}).Build());tenantId=tenant.TenantId;classId=await db.Set<VehicleClass>().Select(v=>v.Id).FirstAsync();
            }
            using var office=factory.CreateClient();var auth=await Read(await office.PostAsJsonAsync("/api/v1/auth/login",new{tenant="master-test",username="admin",password="Master-test-admin-123!"}));office.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",auth["accessToken"]!.GetValue<string>());
            var driver=await Read(await office.PostAsJsonAsync("/api/v1/office/drivers",new{fullName="Isolated master driver",phone="0591234567",status="Available"}));var driverId=Guid.Parse(driver["id"]!.GetValue<string>());var userId=Guid.Parse(driver["userId"]!.GetValue<string>());
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/account",new{username="master-driver",active=true,password="Master-test-driver-123!"}));
            using var driverClient=factory.CreateClient();var login=await Read(await driverClient.PostAsJsonAsync("/api/v1/auth/login",new{tenant="master-test",username="master-driver",password="Master-test-driver-123!"}));driverClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());Assert.Equal(driverId.ToString(),(await Read(await driverClient.GetAsync("/api/v1/driver/me")))["id"]!.GetValue<string>());
            var vehicle=await Read(await office.PostAsJsonAsync("/api/v1/office/vehicles",new{plate="MASTER-ISOLATED",driverId,vehicleClassId=classId,make="Test",model="Test",color="Yellow",year=2026,active=true,status="ACTIVE"}));
            using(var scope=factory.Services.CreateScope()){
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();db.Add(new DriverLocation{DriverId=driverId,Position=new Point(35.25,32.22){SRID=4326},Accuracy=5,UpdatedAt=DateTimeOffset.UtcNow});await db.SaveChangesAsync();
            }
            var state=(await Read(await office.GetAsync("/api/v1/office")))["driverEligibility"]![0]!;Assert.True(state["eligible"]!.GetValue<bool>());Assert.Equal("master-driver",state["username"]!.GetValue<string>());
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}",new{fullName="Isolated master driver",phone="0591234567",status="Available",updateVehicle=true,currentVehicleId=(Guid?)null}));
            state=(await Read(await office.GetAsync("/api/v1/office")))["driverEligibility"]![0]!;Assert.False(state["eligible"]!.GetValue<bool>());Assert.Contains("NO_LINKED_VEHICLE",state["reasons"]!.AsArray().Select(x=>x!.GetValue<string>()));
            using(var scope=factory.Services.CreateScope()){
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var dispatch=scope.ServiceProvider.GetRequiredService<AutoDispatch>();Assert.Empty(await dispatch.Nearest(new RideRequest{TenantId=tenantId,Latitude=32.22,Longitude=35.25},Guid.NewGuid(),await dispatch.Policy()));Assert.Equal(1,await db.Set<Driver>().CountAsync());Assert.Equal(userId,(await db.Set<Driver>().SingleAsync()).UserId);
            }
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/account",new{username="master-driver",active=false}));Assert.Equal(HttpStatusCode.Unauthorized,(await driverClient.GetAsync("/api/v1/driver/me")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,(await office.PutAsJsonAsync($"/api/v1/office/drivers/{Guid.NewGuid()}/account",new{username="other",active=false})).StatusCode);
        }finally{
            NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",catalog);await drop.ExecuteNonQueryAsync();
        }
    }
}
