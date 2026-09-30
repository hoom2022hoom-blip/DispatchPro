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

public sealed class DriverAppTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body=await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");
        return JsonNode.Parse(body)!;
    }

    [PostgresFact]
    public async Task DriverAuthenticationAvailabilityAssignmentNotificationsLifecycleAndHistory()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name="taxi_driver_test_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
                await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="driver-stage",["Seed:AdminPassword"]="Driver-stage-password-123!"}).Build());
            }
            using var office=factory.CreateClient();using var driver=factory.CreateClient();using var other=factory.CreateClient();using var anon=factory.CreateClient();
            async Task Login(HttpClient client,string username)
            {
                var result=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="driver-stage",username,password="Driver-stage-password-123!"}));
                client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",result["accessToken"]!.GetValue<string>());
            }
            Assert.Equal(HttpStatusCode.Unauthorized,(await anon.GetAsync("/api/v1/driver/updates")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,(await anon.PostAsJsonAsync("/api/v1/auth/login",new{tenant="driver-stage",username="admin",password="incorrect"})).StatusCode);
            await Login(office,"admin");
            var roles=(await Read(await office.GetAsync("/api/v1/roles"))).AsArray();var role=roles.Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<string>();
            var ids=new List<string>();var userIds=new List<string>();
            foreach(var username in new[]{"driver-one","driver-two"})
            {
                var user=await Read(await office.PostAsJsonAsync("/api/v1/users",new{username,password="Driver-stage-password-123!",roleId=role}));userIds.Add(user["id"]!.GetValue<string>());
                var record=await Read(await office.PostAsJsonAsync("/api/v1/drivers",new{userId=user["id"]!.GetValue<string>(),fullName=username,status="Offline"}));ids.Add(record["id"]!.GetValue<string>());
            }
            await Login(driver,"driver-one");await Login(other,"driver-two");
            Assert.Equal(ids[0],(await Read(await driver.GetAsync("/api/v1/driver/me")))["id"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.Forbidden,(await office.GetAsync("/api/v1/driver/me")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/notifications/updates")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await driver.PutAsJsonAsync("/api/v1/driver/availability",new{status="Busy"})).StatusCode);
            await Read(await driver.PutAsJsonAsync("/api/v1/driver/availability",new{status="Available"}));
            var customer=await Read(await office.PostAsJsonAsync("/api/v1/customers",new{fullName="عميل خاص",phone="0591234567"}));
            async Task<JsonNode> NewRide()=>await Read(await office.PostAsJsonAsync("/api/v1/ride-requests",new{customerId=customer["id"]!.GetValue<string>(),pickup="نابلس",destination="الجامعة",notes="ملاحظة خاصة",source="MANUAL"}));
            async Task<JsonNode> Assign(JsonNode ride)=>await Read(await office.PutAsJsonAsync($"/api/v1/rides/{ride["id"]}/assignment",new{driverId=ids[0],version=ride["version"]!.GetValue<long>()}));
            var before=await Read(await driver.GetAsync("/api/v1/driver/updates"));
            using var pending=driver.GetAsync("/api/v1/driver/updates?cursor="+before["cursor"]!.GetValue<string>());
            var ride=await Assign(await NewRide());var rideId=ride["id"]!.GetValue<string>();
            var update=await Read(await pending.WaitAsync(TimeSpan.FromSeconds(8)));
            Assert.Single(update["data"]!["rides"]!.AsArray());
            var publicRide=update["data"]!["rides"]![0]!;Assert.Null(publicRide["phone"]);Assert.Null(publicRide["notes"]);
            Assert.Contains(update["data"]!["notices"]!.AsArray(),n=>n!["action"]!.GetValue<string>()=="ride.notification.Assigned");
            Assert.Null((await Read(await driver.GetAsync($"/api/v1/driver/rides/{rideId}")))["phone"]);
            Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync($"/api/v1/driver/rides/{rideId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,(await other.PutAsJsonAsync($"/api/v1/driver/rides/{rideId}/reject",new{version=ride["version"]!.GetValue<long>()})).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await driver.PutAsJsonAsync("/api/v1/driver/availability",new{status="Offline"})).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await driver.PutAsJsonAsync($"/api/v1/rides/{rideId}/status",new{status="Arrived",version=ride["version"]!.GetValue<long>()})).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.PutAsJsonAsync($"/api/v1/rides/{rideId}/status",new{status="Cancelled",version=ride["version"]!.GetValue<long>()})).StatusCode);
            var second=await NewRide();
            Assert.Equal(HttpStatusCode.Conflict,(await office.PutAsJsonAsync($"/api/v1/rides/{second["id"]}/assignment",new{driverId=ids[0],version=second["version"]!.GetValue<long>()})).StatusCode);
            var stale=ride["version"]!.GetValue<long>();
            foreach(var status in new[]{"Accepted","DriverArriving","Arrived","InProgress","Completed"})
            {
                ride=await Read(await driver.PutAsJsonAsync($"/api/v1/rides/{rideId}/status",new{status,version=ride["version"]!.GetValue<long>()}));
                var detail=await Read(await driver.GetAsync($"/api/v1/driver/rides/{rideId}"));
                Assert.Equal("0591234567",detail["phone"]!.GetValue<string>());Assert.Equal("ملاحظة خاصة",detail["notes"]!.GetValue<string>());
            }
            Assert.Equal(HttpStatusCode.Conflict,(await driver.PutAsJsonAsync($"/api/v1/rides/{rideId}/status",new{status="Accepted",version=stale})).StatusCode);
            Assert.Equal(1,(await Read(await driver.GetAsync("/api/v1/driver/history")))["total"]!.GetValue<int>());
            Assert.Equal(0,(await Read(await other.GetAsync("/api/v1/driver/history")))["total"]!.GetValue<int>());
            second=await Assign(second);var secondId=second["id"]!.GetValue<string>();
            var rejected=await Read(await driver.PutAsJsonAsync($"/api/v1/driver/rides/{secondId}/reject",new{version=second["version"]!.GetValue<long>()}));
            Assert.Equal("Rejected",rejected["status"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NotFound,(await driver.GetAsync($"/api/v1/driver/rides/{secondId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,(await driver.PutAsJsonAsync($"/api/v1/driver/rides/{secondId}/reject",new{version=second["version"]!.GetValue<long>()})).StatusCode);
            var officeNotices=(await Read(await office.GetAsync("/api/v1/notifications/updates")))["data"]!.AsArray();
            foreach(var status in new[]{"Assigned","Accepted","Arrived","InProgress","Completed","Rejected"})Assert.Contains(officeNotices,n=>n!["action"]!.GetValue<string>()=="ride.notification."+status);
            Assert.Contains((await Read(await driver.GetAsync("/api/v1/driver/updates")))["data"]!["notices"]!.AsArray(),n=>n!["action"]!.GetValue<string>()=="ride.notification.Rejected");
            Assert.Empty((await Read(await other.GetAsync("/api/v1/driver/updates")))["data"]!["notices"]!.AsArray());
            await Read(await driver.PutAsJsonAsync("/api/v1/driver/availability",new{status="Offline"}));
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                Assert.Empty(await db.Set<DriverVehicleAssignment>().ToListAsync());Assert.All(await db.Set<Driver>().ToListAsync(),d=>Assert.Null(d.CurrentVehicleId));
                var record=await db.Set<Driver>().SingleAsync(d=>d.Id==Guid.Parse(ids[0]));record.Active=false;await db.SaveChangesAsync();
            }
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/driver/me")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync($"/api/v1/driver/rides/{rideId}")).StatusCode);
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
