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
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;

public sealed class DriverOfflineReceptionTests
{
    [PostgresFact]
    public async Task ReceptionRespectsDriverOfflineAndPublishesAssignmentWhenAvailable()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name="taxi_availability_test_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
            string token;Guid driverId,tenantId;
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();var context=scope.ServiceProvider.GetRequiredService<TenantContext>();
                await Seed.RunAsync(db,context,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="availability",["Seed:AdminPassword"]="Availability-test-password-123!"}).Build());
                tenantId=context.TenantId;var user=await db.Set<User>().SingleAsync();token=scope.ServiceProvider.GetRequiredService<TokenService>().Issue(user);
                var driver=new Driver{UserId=user.Id,FullName="Offline driver",Status=DriverStatus.Offline};driverId=driver.Id;db.Add(driver);await db.SaveChangesAsync();
            }
            using var client=factory.CreateClient();client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",token);
            var payload=new JsonObject{["id"]="driver-availability-request",["status"]="assigned",["driverId"]=driverId.ToString(),["source"]="MANUAL",["passengerName"]="Test",["passengerPhone"]="0591234567",["pickup"]=new JsonObject{["name"]="Pickup",["coords"]=new JsonObject{["x"]=0,["y"]=0}},["dropoff"]=new JsonObject{["name"]="Destination"},["totalFare"]=10,["movingFee"]=false};
            const string path="/api/v1/reception/rides/driver-availability-request";
            Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync(path,payload)).StatusCode);
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;
                var driver=await db.Set<Driver>().SingleAsync(d=>d.Id==driverId);driver.Status=DriverStatus.Available;await db.SaveChangesAsync();
            }
            var saved=await client.PutAsJsonAsync(path,payload);Assert.True(saved.IsSuccessStatusCode,await saved.Content.ReadAsStringAsync());
            var notices=JsonNode.Parse(await client.GetStringAsync("/api/v1/notifications/updates"))!["data"]!.AsArray();
            Assert.Contains(notices,n=>n!["action"]!.GetValue<string>()=="ride.notification.Assigned");
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
