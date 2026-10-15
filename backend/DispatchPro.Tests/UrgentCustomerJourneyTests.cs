using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;

public sealed class UrgentCustomerJourneyTests
{
    static async Task<JsonNode> Read(HttpResponseMessage response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");return string.IsNullOrWhiteSpace(body)?new JsonObject():JsonNode.Parse(body)!;}
    [PostgresFact] public async Task CustomerAndOfficeJourneysCompleteWithMessagesCallsAndIdempotentRetry()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name="urgent_customer_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        await using var baseFactory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
        await using var factory=baseFactory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>s.RemoveAll<IHostedService>()));
        const string slug="urgent-test",password="Urgent-fixture-only-123!";
        Guid driverId;
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
            await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Seed:TenantSlug",slug},{"Seed:AdminPassword",password}}).Build());
            var role=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");
            var user=new User{Username="driver",RoleId=role.Id};user.PasswordHash=new PasswordHasher<User>().HashPassword(user,password);
            var driver=new Driver{UserId=user.Id,FullName="سائق اختبار",Phone="0591234560",Status=DriverStatus.Available};driverId=driver.Id;
            db.AddRange(user,driver);await db.SaveChangesAsync();
            var vehicle=new Vehicle{DriverId=driver.Id,VehicleClassId=await db.Set<VehicleClass>().Select(v=>v.Id).FirstAsync(),Plate="URGENT-TEST",Make="Test",Status="ACTIVE"};db.Add(vehicle);await db.SaveChangesAsync();driver.CurrentVehicleId=vehicle.Id;await db.SaveChangesAsync();
        }
        using var office=factory.CreateClient();using var driverClient=factory.CreateClient();using var customer=factory.CreateClient();using var outsider=factory.CreateClient();
        async Task Login(HttpClient client,string username,string kind){var result=await Read(await client.PostAsJsonAsync("/api/v1/auth/"+kind,new{tenant=slug,username,password,deviceId=Guid.NewGuid().ToString()}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",result["accessToken"]!.GetValue<string>());}
        await Login(office,"admin","login");await Login(driverClient,"driver","driver-login");
        async Task Register(HttpClient client,string phone){var result=await Read(await client.VerifiedRegistration(new{tenant=slug,accountId=Guid.NewGuid(),deviceSecret=new string('e',64),fullName="زبون اختبار",phone}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",result["accessToken"]!.GetValue<string>());}
        await Register(customer,"0591234567");await Register(outsider,"0591234568");
        await Read(await driverClient.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.251,accuracy=8,capturedAt=DateTimeOffset.UtcNow}));
        var captures=new JsonArray();var checks=new List<string>();
        foreach(var source in new[]{"customer","office"}){
            JsonNode ride;
            if(source=="customer"){
                var input=new{id=Guid.NewGuid(),pickup=new{addressText="شارع القدس",latitude=32.22,longitude=35.25,locationSource="CUSTOMER_GPS"},destination="رفيديا",destinationLocation=new{addressText="رفيديا",latitude=32.23,longitude=35.27,locationSource="MAP_PIN"},notes="اختبار تكامل معزول"};
                var created=await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides",input));
                var duplicate=await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/rides",input));Assert.Equal(created["id"]!.ToString(),duplicate["id"]!.ToString());
                ride=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{created["id"]}"));
            }else{
                // Exercise the actual office reception/send path, not a direct ride insert.
                var orderId=Guid.NewGuid().ToString();
                var order=new{id=orderId,source="OFFICE",passengerName="زبون مكتب",passengerPhone="0591234569",pickup=new{name="شارع القدس",coords=new{x=32.22,y=35.25}},dropoff=new{name="رفيديا",coords=new{x=32.23,y=35.27}},status="assigned",driverId=driverId.ToString(),movingFee=false,totalFare=(decimal?)null};
                await Read(await office.PutAsJsonAsync("/api/v1/reception/rides/"+orderId,order));
                var snapshot=await Read(await driverClient.GetAsync("/api/v1/driver/updates"));
                var assigned=Assert.Single(snapshot["data"]!["rides"]!.AsArray())!;
                ride=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{assigned["id"]}"));
            }
            Assert.Equal("Assigned",ride["status"]!.GetValue<string>());var id=ride["id"]!.GetValue<Guid>();
            async Task Capture(string stage){
                var detail=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{id}"));Assert.Equal(stage,detail["status"]!.GetValue<string>());
                var reception=await Read(await office.GetAsync("/api/v1/reception/snapshot"));
                var row=Assert.Single(reception["rides"]!.AsArray(),r=>r!["backendRideId"]?.ToString()==id.ToString())!;
                var expected=new Dictionary<string,string>{{"Assigned","assigned"},{"Accepted","driver-accepted"},{"DriverArriving","driver-arriving"},{"Arrived","arrived"},{"InProgress","in-progress"},{"Completed","completed"}};
                Assert.Equal(expected[stage],row["status"]!.GetValue<string>());
                JsonNode? passenger=null;if(source=="customer"){passenger=await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}"));var expectedCustomer=new Dictionary<string,string>{{"Assigned","SEARCHING_DRIVER"},{"Accepted","DRIVER_ASSIGNED"},{"DriverArriving","DRIVER_ARRIVING"},{"Arrived","DRIVER_ARRIVED"},{"InProgress","IN_PROGRESS"},{"Completed","COMPLETED"}};Assert.Equal(expectedCustomer[stage],passenger["rideStatus"]!.GetValue<string>());}
                var snapshot=await Read(await driverClient.GetAsync("/api/v1/driver/updates"));
                var mobile=await Read(await driverClient.GetAsync("/api/v1/driver/mobile/updates?deviceId="+Guid.NewGuid()));
                captures.Add(new JsonObject{["source"]=source,["phase"]=stage,["driver"]=detail.DeepClone(),["snapshot"]=snapshot.DeepClone(),["mobile"]=mobile.DeepClone(),["customer"]=passenger?.DeepClone(),["office"]=row.DeepClone()});
            }
            await Capture("Assigned");
            foreach(var stage in new[]{"Accepted","DriverArriving","Arrived","InProgress","Completed"}){
                var input=new{status=stage,version=ride["version"]!.GetValue<long>(),collectedFare=stage=="Completed"?(decimal?)(source=="office"?0:30):null};
                ride=await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{id}/status",input));
                var repeat=await Read(await driverClient.PutAsJsonAsync($"/api/v1/rides/{id}/status",input));Assert.Equal(ride["version"]!.ToString(),repeat["version"]!.ToString());
                if(stage=="Completed")Assert.Equal(source=="office"?0:30,ride["finalFare"]!.GetValue<decimal>());
                await Capture(stage);
                if(source=="customer"&&stage=="Accepted"){
                    var message=new{id=Guid.NewGuid(),text="أنا في الموقع"};await Read(await customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{id}/chat",message));await Read(await customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{id}/chat",message));
                    var messages=await Read(await driverClient.GetAsync($"/api/v1/driver/rides/{id}/chat"));Assert.Single(messages["items"]!.AsArray());
                    await Read(await driverClient.PostAsJsonAsync($"/api/v1/driver/rides/{id}/chat",new{id=Guid.NewGuid(),text="دقيقة وبكون عندك"}));
                    Assert.Equal(2,(await Read(await customer.GetAsync($"/api/v1/customer-app/rides/{id}/chat")))["items"]!.AsArray().Count);
                    Assert.Equal(HttpStatusCode.Forbidden,(await outsider.GetAsync($"/api/v1/customer-app/rides/{id}/chat")).StatusCode);
                    var caller=Guid.NewGuid();var answer=Guid.NewGuid();var call=await Read(await customer.PostAsJsonAsync("/api/v1/customer-app/calls",new{rideId=id,deviceId=caller,requestId=Guid.NewGuid()}));var callId=call["id"]!.GetValue<Guid>();
                    Assert.Single((await Read(await driverClient.GetAsync("/api/v1/driver/mobile/updates?deviceId="+answer)))["data"]!["calls"]!.AsArray());
                    Assert.Equal("active",(await Read(await driverClient.PostAsJsonAsync($"/api/v1/driver/calls/{callId}/answer",new{deviceId=answer})))["state"]!.GetValue<string>());
                    await Read(await customer.PostAsJsonAsync($"/api/v1/customer-app/calls/{callId}/signal",new{deviceId=caller,id=Guid.NewGuid(),kind="offer",data="{\"type\":\"offer\",\"sdp\":\"fixture-only\"}"}));
                    Assert.Single((await Read(await driverClient.GetAsync("/api/v1/driver/mobile/updates?deviceId="+answer)))["data"]!["signals"]!.AsArray());
                    await Read(await driverClient.PostAsJsonAsync($"/api/v1/driver/calls/{callId}/end",new{deviceId=answer}));
                    checks.Add("bidirectional chat, dedupe, unrelated-account denial; ringing/answer/signaling/end through authorized HTTP; audio not tested by HTTP");
                }
            }
            Assert.Empty((await Read(await driverClient.GetAsync("/api/v1/driver/updates")))["data"]!["rides"]!.AsArray());
            Assert.Equal(HttpStatusCode.Conflict,(await driverClient.PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Completed",version=ride["version"]!.GetValue<long>()-1,collectedFare=31})).StatusCode);
            checks.Add(source+" journey: six states match driver/office/customer where applicable; replay produces no second version or fare");
        }
        var output=Environment.GetEnvironmentVariable("URGENT_CUSTOMER_CAPTURE_PATH");if(!string.IsNullOrWhiteSpace(output))await File.WriteAllTextAsync(output,new JsonObject{["status"]="PASS",["database"]=name,["productionMutated"]=false,["realPhone"]=false,["captures"]=captures,["checks"]=new JsonArray(checks.Select(c=>(JsonNode?)JsonValue.Create(c)).ToArray())}.ToJsonString(new(){WriteIndented=true}));
        // Retain the isolated test database and its evidence. Never drop a live database.
    }
}
