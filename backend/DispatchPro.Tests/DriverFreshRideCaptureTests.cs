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
public sealed class DriverFreshRideCaptureTests
{
    static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body=await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");
        return JsonNode.Parse(body)!;
    }
    [PostgresFact]
    public async Task FreshDriverAndFreshRideExportActualResponsesThroughEveryTransition()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name="taxi_white_screen_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
                await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="white-screen-fixture",["Seed:AdminPassword"]="Fixture-only-password-123!"}).Build());
            }
            using var office=factory.CreateClient();using var driver=factory.CreateClient();
            async Task Login(HttpClient client,string username){var login=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="white-screen-fixture",username,password="Fixture-only-password-123!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());}
            await Login(office,"admin");
            var roles=(await Read(await office.GetAsync("/api/v1/roles"))).AsArray();var role=roles.Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<string>();
            var user=await Read(await office.PostAsJsonAsync("/api/v1/users",new{username="fresh-driver",password="Fixture-only-password-123!",roleId=role}));
            var driverRecord=await Read(await office.PostAsJsonAsync("/api/v1/drivers",new{userId=user["id"]!.GetValue<string>(),fullName="سائق اختبار جديد",status="Offline"}));
            await Login(driver,"fresh-driver");
            Assert.Empty((await Read(await driver.GetAsync("/api/v1/driver/updates")))["data"]!["rides"]!.AsArray());
            await Read(await driver.PutAsJsonAsync("/api/v1/driver/availability",new{status="Available"}));
            var captures=new JsonArray();
            var deviceId=Guid.NewGuid();
            async Task Capture(string phase,JsonNode? transition=null, string? rideId=null)
            {
                var snapshot=await Read(await driver.GetAsync("/api/v1/driver/updates"));
                var detail=rideId is null?null:await Read(await driver.GetAsync($"/api/v1/driver/rides/{rideId}"));
                var mobile=await Read(await driver.GetAsync($"/api/v1/driver/mobile/updates?deviceId={deviceId}"));
                var officeSnapshot=await Read(await office.GetAsync("/api/v1/reception/snapshot"));
                var officeRide=rideId is null?null:officeSnapshot["rides"]!.AsArray().Single(r=>r!["backendRideId"]?.GetValue<string>()==rideId);
                if(officeRide is not null){
                    var expected=phase switch{"Assigned"=>"assigned","Accepted"=>"driver-accepted","DriverArriving"=>"driver-arriving","Arrived"=>"arrived","InProgress"=>"in-progress","Completed"=>"completed",_=>throw new InvalidOperationException("Unknown fixture phase")};
                    Assert.Equal(expected,officeRide["status"]!.GetValue<string>());
                    Assert.Equal(phase,detail!["status"]!.GetValue<string>());
                }
                if(phase=="Assigned"){Assert.Null(detail!["fullName"]);Assert.Null(detail["phone"]);}
                captures.Add(new JsonObject{["phase"]=phase,["transition"]=transition?.DeepClone(),["snapshot"]=snapshot,["detail"]=detail,["mobile"]=mobile,["officeRide"]=officeRide?.DeepClone()});
            }
            await Capture("Online");
            var customerApp=Environment.GetEnvironmentVariable("DRIVER_CAPTURE_CUSTOMER_APP")=="true";
            JsonNode ride;
            if(customerApp)
            {
                using(var scope=factory.Services.CreateScope())
                {
                    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                    db.Add(new Vehicle{DriverId=Guid.Parse(driverRecord["id"]!.GetValue<string>()),VehicleClassId=await db.Set<VehicleClass>().Select(v=>v.Id).FirstAsync(),Plate="FRESH-TEST",Make="Test",Status="ACTIVE"});await db.SaveChangesAsync();
                }
                await Read(await driver.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.251,accuracy=8,capturedAt=DateTimeOffset.UtcNow}));
                using var customerClient=factory.CreateClient();
                var registration=await Read(await customerClient.VerifiedRegistration(new{tenant="white-screen-fixture",accountId=Guid.NewGuid(),deviceSecret=new string('e',64),fullName="زبون اختبار جديد",phone="0591234567"}));
                customerClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",registration["accessToken"]!.GetValue<string>());
                var created=await Read(await customerClient.PostAsJsonAsync("/api/v1/customer-app/rides",new{id=Guid.NewGuid(),pickup=new{addressText="شارع القدس",latitude=32.22,longitude=35.25,locationSource="CUSTOMER_GPS"},destination="جامعة النجاح",destinationLocation=new{addressText="جامعة النجاح",latitude=32.23,longitude=35.27,locationSource="MAP_PIN"},notes="رحلة جديدة بالكامل"}));
                ride=await Read(await driver.GetAsync($"/api/v1/driver/rides/{created["id"]}"));
                Assert.Equal("Assigned",ride["status"]!.GetValue<string>());
                Assert.Equal("CUSTOMER_APP",ride["source"]!.GetValue<string>());
            }
            else
            {
                var customer=await Read(await office.PostAsJsonAsync("/api/v1/customers",new{fullName="زبون اختبار جديد",phone="0591234567"}));
                ride=await Read(await office.PostAsJsonAsync("/api/v1/ride-requests",new{customerId=customer["id"]!.GetValue<string>(),pickup="شارع القدس",destination="جامعة النجاح",notes="رحلة جديدة بالكامل",source="MANUAL"}));
            }
            if(Environment.GetEnvironmentVariable("DRIVER_CAPTURE_FARE_MODE")=="GPS_METER")
            {
                using(var scope=factory.Services.CreateScope()){
                    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                    if(!await db.Set<PricingRule>().AnyAsync(p=>p.Mode==PricingMode.GpsMeter)){
                        var pricing=await db.Set<PricingProfile>().FirstAsync();db.Add(new PricingRule{PricingProfileId=pricing.Id,Mode=PricingMode.GpsMeter,BaseFare=10,MinimumFare=10,PerKm=3,PerMinute=1});await db.SaveChangesAsync();
                    }
                }
                ride=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{ride["id"]}/fare",new{mode="GPS_METER",version=ride["version"]!.GetValue<long>()}));
            }
            if(!customerApp)ride=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{ride["id"]}/assignment",new{driverId=driverRecord["id"]!.GetValue<string>(),version=ride["version"]!.GetValue<long>()}));
            var rideId=ride["id"]!.GetValue<string>();
            await Capture("Assigned",ride,rideId);
            foreach(var status in new[]{"Accepted","DriverArriving","Arrived","InProgress","Completed"})
            {
                ride=await Read(await driver.PutAsJsonAsync($"/api/v1/rides/{rideId}/status",new{status,version=ride["version"]!.GetValue<long>(),collectedFare=status=="Completed"?(decimal?)30:null}));
                await Capture(status,ride,rideId);
            }
            var path=Environment.GetEnvironmentVariable("DRIVER_CAPTURE_PATH");
            if(!string.IsNullOrWhiteSpace(path))await File.WriteAllTextAsync(path,captures.ToJsonString(new(){WriteIndented=true}));
            Assert.Equal(7,captures.Count);
            Assert.Equal("Accepted",captures[2]!["detail"]!["status"]!.GetValue<string>());
            Assert.Equal("0591234567",captures[2]!["detail"]!["phone"]!.GetValue<string>());
            Assert.Empty(captures[6]!["snapshot"]!["data"]!["rides"]!.AsArray());
            Assert.Equal("Available",captures[6]!["snapshot"]!["data"]!["driver"]!["status"]!.GetValue<string>());
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);if(Environment.GetEnvironmentVariable("DISPATCHPRO_KEEP_TEST_DATABASES")!="true") await drop.ExecuteNonQueryAsync();}
    }
}
