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
public sealed class CustomerAppTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}"); return JsonNode.Parse(body)!;
    }
    [PostgresFact]
    public async Task CustomerRegistrationOwnershipReceptionStatusAndHistory()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;var name="customer_mvp_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
                await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="customer-stage",["Seed:AdminPassword"]="Customer-stage-password-123!"}).Build());
            }
            using var customer=factory.CreateClient();using var other=factory.CreateClient();using var office=factory.CreateClient();using var anon=factory.CreateClient();
            var account=Guid.NewGuid();var secret=new string('a',64);
            var registration=new{tenant="customer-stage",accountId=account,deviceSecret=secret,fullName="زبون تجريبي",phone="0591234567"};
            var first=await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/register",registration));
            customer.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",first["accessToken"]!.GetValue<string>());
            Assert.Equal(account.ToString(),first["profile"]!["id"]!.GetValue<string>());Assert.False(first["profile"]!["phoneVerified"]!.GetValue<bool>());
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/register",registration));
            Assert.Equal(HttpStatusCode.Conflict,(await anon.PostAsJsonAsync("/api/v1/customer-app/register",new{tenant="customer-stage",accountId=Guid.NewGuid(),deviceSecret=secret,fullName="Duplicate",phone="+970591234567"})).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await anon.PostAsJsonAsync("/api/v1/customer-app/register",new{tenant="customer-stage",accountId=Guid.NewGuid(),deviceSecret=secret,fullName="Invalid",phone="123"})).StatusCode);
            var second=await Read(await other.PostAsJsonAsync("/api/v1/customer-app/register",new{tenant="customer-stage",accountId=Guid.NewGuid(),deviceSecret=secret,fullName="Another",phone="0591234568"}));
            other.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",second["accessToken"]!.GetValue<string>());
            var login=await Read(await anon.PostAsJsonAsync("/api/v1/auth/login",new{tenant="customer-stage",username="customer-"+account.ToString("N"),password=secret}));Assert.NotNull(login["accessToken"]);
            Assert.Equal(HttpStatusCode.Unauthorized,(await anon.GetAsync("/api/v1/customer-app/history")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/v1/office")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/v1/customers")).StatusCode);
            var officeLogin=await Read(await office.PostAsJsonAsync("/api/v1/auth/login",new{tenant="customer-stage",username="admin",password="Customer-stage-password-123!"}));office.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",officeLogin["accessToken"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.Forbidden,(await office.GetAsync("/api/v1/customer-app/me")).StatusCode);
            var id=Guid.NewGuid();var input=new{id,pickup=new{addressText="نابلس، الميدان",latitude=32.22,longitude=35.26,locationSource="CUSTOMER_GPS"},destination="الجامعة",notes="اختبار تكامل الزبون"};
            var initialSnapshot=await office.GetAsync("/api/v1/reception/snapshot");await Read(initialSnapshot);
            using var snapshotRequest=new HttpRequestMessage(HttpMethod.Get,"/api/v1/reception/snapshot?wait=true");
            snapshotRequest.Headers.IfNoneMatch.Add(initialSnapshot.Headers.ETag!);
            using var officeWaiting=office.SendAsync(snapshotRequest);
            await Task.Delay(150);Assert.False(officeWaiting.IsCompleted);
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides",input));await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides",input));
            var liveSnapshot=await Read(await officeWaiting.WaitAsync(TimeSpan.FromSeconds(8)));
            Assert.Equal(id.ToString(),Assert.Single(liveSnapshot["rides"]!.AsArray())!["id"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NotFound,(await other.GetAsync($"/api/v1/customer-app/rides/{id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,(await other.PostAsJsonAsync("/api/v1/customer-app/rides",input)).StatusCode);
            var snapshot=await Read(await office.GetAsync("/api/v1/reception/snapshot"));var order=Assert.Single(snapshot["rides"]!.AsArray())!.DeepClone();
            Assert.Equal("CUSTOMER_APP",order["source"]!.GetValue<string>());Assert.Equal("الجامعة",order["dropoff"]!["name"]!.GetValue<string>());Assert.Equal("زبون تجريبي",order["passengerName"]!.GetValue<string>());
            var roles=(await Read(await office.GetAsync("/api/v1/roles"))).AsArray();
            var role=roles.Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<string>();
            var user=await Read(await office.PostAsJsonAsync("/api/v1/users",new{username="journey-driver",password="Customer-stage-password-123!",roleId=role}));
            var driver=await Read(await office.PostAsJsonAsync("/api/v1/drivers",new{userId=user["id"]!.GetValue<string>(),fullName="Customer integration driver",status="Available"}));
            using var driverClient=factory.CreateClient();
            var driverLogin=await Read(await driverClient.PostAsJsonAsync("/api/v1/auth/login",new{tenant="customer-stage",username="journey-driver",password="Customer-stage-password-123!"}));
            driverClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",driverLogin["accessToken"]!.GetValue<string>());
            order["driverId"]=driver["id"]!.GetValue<string>();order["status"]="assigned";order["dispatchStatus"]="SENT";
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{id}",order));
            var detail=await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}"));Assert.Equal("ASSIGNED",detail["status"]!.GetValue<string>());Assert.Null(detail["driver"]);Assert.Equal("الجامعة",detail["destination"]!.GetValue<string>());
            Assert.Equal("DRIVER_ASSIGNED",detail["workflowStatus"]!.GetValue<string>());
            var offer=(await Read(await driverClient.GetAsync("/api/v1/driver/updates")))["data"]!["rides"]![0]!;
            await Read(await driverClient.PutAsJsonAsync($"/api/v1/driver/rides/{id}/reject",new{version=offer["version"]!.GetValue<long>()}));
            detail=await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}"));Assert.Equal("REJECTED",detail["workflowStatus"]!.GetValue<string>());Assert.Null(detail["driver"]);
            order=(await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]![0]!.DeepClone();
            Assert.Equal("REJECTED",order["dispatchStatus"]!.GetValue<string>());Assert.Null(order["driverId"]);
            order["driverId"]=driver["id"]!.GetValue<string>();order["status"]="assigned";order["dispatchStatus"]="SENT";
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{id}",order));
            foreach(var pair in new[]{("Accepted","ACCEPTED","ACCEPTED"),("DriverArriving","DRIVER_ARRIVING","ARRIVING"),("Arrived","DRIVER_ARRIVED","ARRIVED"),("InProgress","IN_TRIP","STARTED"),("Completed","COMPLETED","COMPLETED")})
            {
                var before=await Read(await customer.GetAsync("/api/v1/customer-app/updates"));
                using var waiting=customer.GetAsync("/api/v1/customer-app/updates?cursor="+before["cursor"]!.GetValue<string>());
                var current=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{id}"));
                await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status=pair.Item1,version=current["version"]!.GetValue<long>()}));
                var pushed=await Read(await waiting.WaitAsync(TimeSpan.FromSeconds(8)));
                Assert.Equal(pair.Item2,pushed["rides"]![0]!["workflowStatus"]!.GetValue<string>());
                detail=await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}"));Assert.Equal(pair.Item2,detail["workflowStatus"]!.GetValue<string>());Assert.Equal("Customer integration driver",detail["driver"]!["fullName"]!.GetValue<string>());Assert.Null(detail["vehicle"]);
                var receptionOrder=(await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]![0]!;
                Assert.Equal(pair.Item3,receptionOrder["dispatchStatus"]!.GetValue<string>());
                Assert.Equal(pair.Item2,receptionOrder["workflowStatus"]!.GetValue<string>());
                if(pair.Item1=="DriverArriving")
                {
                    Assert.Single((await Read(await driverClient.GetAsync("/api/v1/driver/updates")))["data"]!["rides"]!.AsArray());
                    Assert.Equal(HttpStatusCode.Conflict,(await driverClient.PutAsJsonAsync("/api/v1/driver/availability",new{status="Offline"})).StatusCode);
                }
            }
            var updates=await Read(await customer.GetAsync("/api/v1/customer-app/updates"));Assert.Equal("COMPLETED",Assert.Single(updates["rides"]!.AsArray())!["status"]!.GetValue<string>());
            Assert.Equal(1,(await Read(await customer.GetAsync("/api/v1/customer-app/history")))["total"]!.GetValue<int>());Assert.Equal(0,(await Read(await other.GetAsync("/api/v1/customer-app/history")))["total"]!.GetValue<int>());
            var scheduledId=Guid.NewGuid();var scheduled=DateTimeOffset.UtcNow.AddDays(1);
            await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides",new{id=scheduledId,pickup=new{addressText="عنوان يدوي"},destination="المستشفى",scheduledAt=scheduled}));
            var scheduledOrder=(await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray().Single(r=>r!["id"]!.GetValue<string>()==scheduledId.ToString())!;
            Assert.NotNull(scheduledOrder["scheduledTime"]);
            var currentScheduled=await Read(await office.GetAsync($"/api/v1/rides/{scheduledId}"));
            await Read(await office.PutAsJsonAsync($"/api/v1/rides/{scheduledId}/status",new{status="Cancelled",version=currentScheduled["ride"]!["version"]!.GetValue<long>()}));
            Assert.Equal("CANCELLED",(await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{scheduledId}")))["status"]!.GetValue<string>());
            Assert.Equal(2,(await Read(await customer.GetAsync("/api/v1/customer-app/history")))["total"]!.GetValue<int>());
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
