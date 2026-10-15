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
public sealed class FareIntegrationTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response){var text=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {text}");return JsonNode.Parse(text)!;}
    [PostgresFact] public async Task ManualMeterOverrideAuditReportsAndPermissions(){
        // Isolated additive test database is retained. Never delete or recreate office data.
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        var database="taxi_fare_"+Guid.NewGuid().ToString("N");
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {database}",admin))await create.ExecuteNonQueryAsync();
        await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=database}.ConnectionString);
        using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();Assert.False(db.Database.HasPendingModelChanges());await db.Database.MigrateAsync();await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="fare-test",["Seed:AdminPassword"]="Fare-test-password-123!"}).Build());}
        using var office=factory.CreateClient();using var driverClient=factory.CreateClient();using var anonymous=factory.CreateClient();
        async Task Login(HttpClient client,string username){var login=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="fare-test",username,password="Fare-test-password-123!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());}
        await Login(office,"admin");
        Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/v1/fare/settings")).StatusCode);
        var role=(await Read(await office.GetAsync("/api/v1/roles"))).AsArray().Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<string>();
        var user=await Read(await office.PostAsJsonAsync("/api/v1/users",new{username="fare-driver",password="Fare-test-password-123!",roleId=role}));
        var driver=await Read(await office.PostAsJsonAsync("/api/v1/drivers",new{userId=user["id"]!.GetValue<string>(),fullName="Fare Driver",status="Available"}));
        await Login(driverClient,"fare-driver");
        var settings=new {rule=new{baseFare=5,perKm=2,minimumFare=5,nightStartHour=0,nightEndHour=0},currency="ILS",allowDriverManual=true};
        Assert.Equal(HttpStatusCode.Forbidden,(await driverClient.PutAsJsonAsync("/api/v1/fare/settings",settings)).StatusCode);
        await Read(await office.PutAsJsonAsync("/api/v1/fare/settings",settings));
        Assert.Equal(HttpStatusCode.BadRequest,(await office.PutAsJsonAsync("/api/v1/fare/settings",new{rule=new{baseFare=-1},currency="ILS",allowDriverManual=true})).StatusCode);
        async Task<JsonNode> Create(){return await Read(await office.PostAsJsonAsync("/api/v1/ride-requests",new{pickup="Real pickup",destination="Real destination",notes="searchable fare notes",source="MANUAL"}));}
        async Task<JsonNode> Assign(JsonNode ride){return await Read(await office.PutAsJsonAsync($"/api/v1/rides/{ride["id"]}/assignment",new{driverId=driver["id"]!.GetValue<string>(),version=ride["version"]!.GetValue<long>()}));}
        async Task<JsonNode> Transition(JsonNode ride,string status){return await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{ride["id"]}/status",new{status,version=ride["version"]!.GetValue<long>()}));}
        var manual=await Create();var manualId=manual["id"]!.GetValue<string>();
        manual=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{manualId}/fare",new{mode="OFFICE_MANUAL",amount=20,version=manual["version"]!.GetValue<long>()}));
        Assert.Equal(20,manual["finalFare"]!.GetValue<decimal>());
        Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.PutAsJsonAsync($"/api/v1/rides/{manualId}/fare",new{mode="OFFICE_MANUAL",amount=99,version=manual["version"]!.GetValue<long>()})).StatusCode);
        manual=await Assign(manual);manual=await Transition(manual,"Accepted");
        Assert.Equal(HttpStatusCode.Forbidden,(await driverClient.PutAsJsonAsync($"/api/v1/rides/{manualId}/fare",new{mode="OFFICE_MANUAL",amount=999,version=manual["version"]!.GetValue<long>()})).StatusCode);
        var staleVersion=manual["version"]!.GetValue<long>();
        manual=await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{manualId}/fare",new{mode="DRIVER_MANUAL",amount=25,version=staleVersion}));
        Assert.Equal("DRIVER_MANUAL",manual["fareSource"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict,(await driverClient.PutAsJsonAsync($"/api/v1/rides/{manualId}/fare",new{mode="DRIVER_MANUAL",amount=30,version=staleVersion})).StatusCode);
        manual=await Transition(manual,"Arrived");manual=await Transition(manual,"InProgress");await Transition(manual,"Completed");
        // Mandatory completion collection works even when optional advance manual pricing is disabled.
        await Read(await office.PutAsJsonAsync("/api/v1/fare/settings",new {rule=settings.rule,currency="ILS",allowDriverManual=false}));
        var unpriced=await Assign(await Create());
        unpriced=await Transition(unpriced,"Accepted");unpriced=await Transition(unpriced,"Arrived");unpriced=await Transition(unpriced,"InProgress");
        var unpricedId=unpriced["id"]!.GetValue<string>();var version=unpriced["version"]!.GetValue<long>();
        var rejected=await driverClient.PutAsJsonAsync($"/api/v1/rides/{unpricedId}/status",new{status="Completed",version});
        Assert.Equal(HttpStatusCode.Conflict,rejected.StatusCode);
        Assert.Equal("FINAL_FARE_REQUIRED",JsonNode.Parse(await rejected.Content.ReadAsStringAsync())!["code"]!.GetValue<string>());
        foreach(var invalid in new[]{-1m,1.001m,10000001m})Assert.Equal(HttpStatusCode.BadRequest,(await driverClient.PutAsJsonAsync($"/api/v1/rides/{unpricedId}/status",new{status="Completed",version,collectedFare=invalid})).StatusCode);
        var stillActive=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{unpricedId}"));
        Assert.Equal("InProgress",stillActive["status"]!.GetValue<string>());Assert.Null(stillActive["finalFare"]);
        var collected=await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{unpricedId}/status",new{status="Completed",version,collectedFare=18m}));
        Assert.Equal("Completed",collected["status"]!.GetValue<string>());Assert.Equal("DRIVER_MANUAL",collected["fareSource"]!.GetValue<string>());Assert.Equal(18m,collected["finalFare"]!.GetValue<decimal>());
        Assert.Equal(HttpStatusCode.Conflict,(await driverClient.PutAsJsonAsync($"/api/v1/rides/{unpricedId}/status",new{status="Completed",version,collectedFare=18m})).StatusCode);
        var officePriced=await Create();var officePricedId=officePriced["id"]!.GetValue<string>();
        officePriced=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{officePricedId}/fare",new{mode="OFFICE_MANUAL",amount=12m,version=officePriced["version"]!.GetValue<long>()}));
        officePriced=await Assign(officePriced);officePriced=await Transition(officePriced,"Accepted");officePriced=await Transition(officePriced,"Arrived");officePriced=await Transition(officePriced,"InProgress");officePriced=await Transition(officePriced,"Completed");
        Assert.Equal(12m,officePriced["finalFare"]!.GetValue<decimal>());Assert.Equal("OFFICE_MANUAL",officePriced["fareSource"]!.GetValue<string>());
        var meter=await Create();var meterId=meter["id"]!.GetValue<string>();
        meter=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{meterId}/fare",new{mode="GPS_METER",version=meter["version"]!.GetValue<long>()}));
        meter=await Assign(meter);meter=await Transition(meter,"Accepted");meter=await Transition(meter,"Arrived");meter=await Transition(meter,"InProgress");
        Assert.NotNull(meter["meterStartedAt"]);
        await Read(await driverClient.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.25,accuracy=5,capturedAt=DateTimeOffset.UtcNow}));
        var detail=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{meterId}"));
        meter=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{meterId}/fare",new{mode="OFFICE_MANUAL",amount=4,version=detail["version"]!.GetValue<long>(),reason="Office approval"}));
        meter=await Transition(meter,"Completed");
        Assert.Equal(5,meter["meterCalculatedFare"]!.GetValue<decimal>());Assert.Equal(4,meter["finalFare"]!.GetValue<decimal>());Assert.Equal("OFFICE_OVERRIDE",meter["fareSource"]!.GetValue<string>());
        var report=await Read(await office.GetAsync("/api/v1/reception/reports/history?kind=orders&fareMode=GPS_METER"));
        Assert.Single(report["items"]!.AsArray());Assert.Equal(4,report["fareTotals"]![0]!["value"]!.GetValue<decimal>());
        foreach(var term in new[]{"Real pickup","Real destination","searchable fare","Fare Driver","مكتمل","المكتب"}) {
            var found=await Read(await office.GetAsync("/api/v1/reception/reports/history?kind=orders&search="+Uri.EscapeDataString(term)));
            Assert.True(found["total"]!.GetValue<int>()==4,$"Search '{term}' returned {found["total"]} instead of 4");
        }
        var combined=await Read(await office.GetAsync($"/api/v1/reception/reports/history?kind=orders&driverId={driver["id"]}&status=completed&fareSource=DRIVER_MANUAL&search=destination"));
        Assert.Equal(2,combined["total"]!.GetValue<int>());Assert.Equal(43m,combined["fareTotals"]!.AsArray().Sum(r=>r!["value"]!.GetValue<decimal>()));
        var empty=await Read(await office.GetAsync("/api/v1/reception/reports/history?kind=orders&search=missing-unique-term"));Assert.Equal(0,empty["total"]!.GetValue<int>());Assert.Empty(empty["items"]!.AsArray());Assert.Empty(empty["fareTotals"]!.AsArray());
        var blank=await Create();var blankId=blank["id"]!.GetValue<string>();
        var snapshot=await Read(await office.GetAsync("/api/v1/reception/snapshot"));var blankOrder=snapshot["rides"]!.AsArray().Single(r=>r!["id"]!.GetValue<string>()==blankId)!.DeepClone().AsObject();
        blankOrder["totalFare"]=null;blankOrder["passengerName"]="إبراهيم";blankOrder["passengerPhone"]="0592081197";blankOrder["receptionPending"]=false;
        var savedBlank=await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{blankId}",blankOrder));Assert.Null(savedBlank["finalFare"]);
        foreach(var term in new[]{"إبراهيم","0592081197","0592",savedBlank["orderNumber"]!.ToString()}){var found=await Read(await office.GetAsync("/api/v1/reception/reports/history?kind=orders&search="+Uri.EscapeDataString(term)));Assert.Contains(found["items"]!.AsArray(),r=>r!["id"]!.GetValue<string>()==blankId);}
        // PostgreSQL paginates after filtering, and the summary includes rows outside page one.
        for(var i=0;i<51;i++)await Create();
        var secondPage=await Read(await office.GetAsync("/api/v1/reception/reports/history?kind=orders&search=searchable&page=2"));Assert.Equal(56,secondPage["total"]!.GetValue<int>());Assert.Equal(6,secondPage["items"]!.AsArray().Count);Assert.Equal(4,secondPage["summary"]!["statuses"]!.AsArray().Single(r=>r!["key"]!.GetValue<string>()=="completed")!["count"]!.GetValue<int>());
        using var customerClient=factory.CreateClient();
        var customerLogin=await Read(await customerClient.VerifiedRegistration(new{tenant="fare-test",accountId=Guid.NewGuid(),deviceSecret=new string('a',64),fullName="Fare Customer",phone="0592111222"}));
        customerClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",customerLogin["accessToken"]!.GetValue<string>());
        var customerId=customerLogin["profile"]!["id"]!.GetValue<string>();
        async Task<JsonNode> CustomerCreate()=>await Read(await office.PostAsJsonAsync("/api/v1/ride-requests",new{customerId,pickup="Customer pickup",destination="Customer destination",source="MANUAL"}));
        async Task<JsonNode> CustomerView(string rideId){var update=await Read(await customerClient.GetAsync("/api/v1/customer-app/updates"));return update["rides"]!.AsArray().Single(r=>r!["id"]!.GetValue<string>()==rideId)!;}
        var customerRide=await CustomerCreate();var customerRideId=customerRide["id"]!.GetValue<string>();Assert.Null((await CustomerView(customerRideId))["finalFare"]);
        customerRide=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{customerRideId}/fare",new{mode="OFFICE_MANUAL",amount=21m,version=customerRide["version"]!.GetValue<long>()}));
        Assert.Equal(21m,(await CustomerView(customerRideId))["finalFare"]!.GetValue<decimal>());
        customerRide=await Assign(customerRide);customerRide=await Transition(customerRide,"Accepted");customerRide=await Transition(customerRide,"Arrived");customerRide=await Transition(customerRide,"InProgress");customerRide=await Transition(customerRide,"Completed");
        var customerManual=await Assign(await CustomerCreate());var customerManualId=customerManual["id"]!.GetValue<string>();customerManual=await Transition(customerManual,"Accepted");customerManual=await Transition(customerManual,"Arrived");customerManual=await Transition(customerManual,"InProgress");
        await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{customerManualId}/status",new{status="Completed",version=customerManual["version"]!.GetValue<long>(),collectedFare=18m}));
        var customerFinal=await CustomerView(customerManualId);Assert.Equal(18m,customerFinal["finalFare"]!.GetValue<decimal>());Assert.Equal("DRIVER_MANUAL",customerFinal["fareSource"]!.GetValue<string>());
        using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Where(t=>t.Slug=="fare-test").Select(t=>t.Id).SingleAsync();Assert.True(await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==Guid.Parse(meterId)&&a.Action=="fare.changed"));Assert.Single(await db.Set<DriverGpsPoint>().Where(p=>p.RideId==Guid.Parse(meterId)).ToListAsync());}
    }
}
