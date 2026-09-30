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
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;
public sealed class PostgresTheoryAttribute : TheoryAttribute
{
    public PostgresTheoryAttribute() { if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES"))) Skip = "Local PostgreSQL required"; }
}
public sealed class CompleteHailingStageTests
{
    [PostgresTheory]
    [InlineData("A_nearest_accept")]
    [InlineData("B_reject_next")]
    [InlineData("C_timeout_next")]
    [InlineData("D_no_drivers")]
    [InlineData("E_atomic_accept")]
    [InlineData("F_customer_cancel")]
    [InlineData("G_full_lifecycle_history")]
    [InlineData("H_office_live_updates")]
    [InlineData("I_office_override")]
    [InlineData("J_office_auto")]
    [InlineData("K_ineligible_drivers")]
    [InlineData("L_offline_during_offer")]
    [InlineData("M_stale_during_offer")]
    [InlineData("N_cancel_accept_race")]
    [InlineData("O_concurrent_requests")]
    [InlineData("P_complete_keeps_offline")]
    [InlineData("Q_cancel_keeps_offline")]
    [InlineData("R_missing_gps_then_real_fix")]
    [InlineData("S_poor_accuracy")]
    public async Task RealPostgresScenario(string scenario)
    {
        await using var f = await Fixture.Create();
        if (scenario is "R_missing_gps_then_real_fix" or "S_poor_accuracy")
        {
            await f.Availability(1,"Offline");await f.Availability(2,"Offline");
            await f.WithDb(async db=>{
                var location=await db.Set<DriverLocation>().SingleAsync(l=>l.DriverId==f.DriverIds[0]);
                if(scenario=="R_missing_gps_then_real_fix")db.Remove(location);else location.Accuracy=500;
                await db.SaveChangesAsync();
            });
            var expected=scenario=="R_missing_gps_then_real_fix"?"NO_LOCATION":"POOR_ACCURACY";
            Assert.Equal(expected,(await Read(await f.Drivers[0].GetAsync("/api/v1/driver/me")))["locationStatus"]!.GetValue<string>());
            var failed=Guid.NewGuid();await f.Request(failed);
            Assert.Equal("NO_DRIVER_AVAILABLE",(await f.CustomerRide(failed))["rideStatus"]!.GetValue<string>());
            Assert.Empty(await f.Offers(0));
            await f.WithDb(async db=>{var location=await db.Set<DriverLocation>().SingleOrDefaultAsync(l=>l.DriverId==f.DriverIds[0]);if(location is not null){location.UpdatedAt=DateTimeOffset.UtcNow.AddMinutes(-5);await db.SaveChangesAsync();}});
            await Read(await f.Drivers[0].PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.251,accuracy=10,capturedAt=DateTimeOffset.UtcNow}));
            Assert.Equal("READY",(await Read(await f.Drivers[0].GetAsync("/api/v1/driver/updates")))["data"]!["driver"]!["locationStatus"]!.GetValue<string>());
            var retry=Guid.NewGuid();await f.Request(retry);Assert.Single(await f.Offers(0));await f.Accept(0,retry);
            Assert.Equal("DRIVER_ASSIGNED",(await f.CustomerRide(retry))["rideStatus"]!.GetValue<string>());
            return;
        }
        if (scenario == "D_no_drivers") for (var i=0;i<3;i++) await f.Availability(i,"Offline");
        if (scenario == "K_ineligible_drivers")
        {
            await f.Availability(0,"Offline");
            await f.WithDb(async db => { (await db.Set<Driver>().SingleAsync(d=>d.Id==f.DriverIds[1])).Status=DriverStatus.Busy;
                (await db.Set<DriverLocation>().SingleAsync(l=>l.DriverId==f.DriverIds[2])).UpdatedAt=DateTimeOffset.UtcNow.AddMinutes(-10); await db.SaveChangesAsync(); });
        }
        if (scenario == "J_office_auto")
        {
            var externalId="office-"+Guid.NewGuid().ToString("N");
            var body=new {id=externalId,source="MANUAL",pickup=new {name="Office GPS",coords=new{x=32.22,y=35.25}},latitude=32.22,longitude=35.25,locationSource="MAP_PIN",dropoff=new{name="Office destination",coords=new{x=32.23,y=35.27}},totalFare=0,movingFee=false,status="pending",passengerName="Office test",passengerPhone="0591234500"};
            var row=await Read(await f.Office.PutAsJsonAsync("/api/v1/reception/rides/"+externalId,body));
            var backendId=row["backendRideId"]!.GetValue<Guid>();
            Assert.Empty(await f.Offers(0));
            var monitor=(await Read(await f.Office.GetAsync("/api/v1/dispatch/rides"))).AsArray().Single(r=>r!["id"]!.GetValue<Guid>()==backendId)!;
            Assert.True(monitor["hasPickupLocation"]!.GetValue<bool>());
            await Read(await f.Office.PutAsJsonAsync($"/api/v1/dispatch/rides/{backendId}/mode",new{mode="AUTO_NEAREST",version=monitor["version"]!.GetValue<long>()}));
            Assert.Equal(backendId,Assert.Single(await f.Offers(0))!["id"]!.GetValue<Guid>());
            await f.Accept(0,backendId);
            Assert.Equal("DRIVER_ASSIGNED",(await f.OfficeRow(externalId))["rideStatus"]!.GetValue<string>());
            return;
        }
        if(scenario=="O_concurrent_requests")
        {
            var a=Guid.NewGuid();var b=Guid.NewGuid();
            var responses=await Task.WhenAll(f.RequestResponse(a),f.RequestResponse(b));
            Assert.Single(responses,r=>r.IsSuccessStatusCode);Assert.Single(responses,r=>r.StatusCode==HttpStatusCode.Conflict);
            Assert.Single(await f.Offers(0));Assert.Empty(await f.Offers(1));Assert.Empty(await f.Offers(2));
            await f.WithDb(async db=>Assert.Equal(1,await db.Set<RideOffer>().CountAsync(o=>o.Outcome=="OFFERED")));
            return;
        }
        var id=Guid.NewGuid();await f.Request(id);await f.Request(id);
        if(scenario is "D_no_drivers" or "K_ineligible_drivers")
        {
            Assert.Equal("NO_DRIVER_AVAILABLE",(await f.CustomerRide(id))["rideStatus"]!.GetValue<string>());
            Assert.Equal("NO_DRIVER_AVAILABLE",(await f.OfficeRow(id.ToString()))["rideStatus"]!.GetValue<string>());
            for(var i=0;i<3;i++)Assert.Empty(await f.Offers(i));
            return;
        }
        var offer=Assert.Single(await f.Offers(0))!;Assert.Empty(await f.Offers(1));Assert.Empty(await f.Offers(2));
        Assert.InRange(offer["offerDistanceMeters"]!.GetValue<double>(),50,150);
        Assert.Equal(32.22,offer["latitude"]!.GetValue<double>());Assert.Equal(35.27,offer["destinationLongitude"]!.GetValue<double>());
        switch(scenario)
        {
            case "P_complete_keeps_offline":
            case "Q_cancel_keeps_offline":
                await f.Accept(0,id);
                if(scenario=="P_complete_keeps_offline")
                {
                    await f.Move(0,id,"DriverArriving");await f.Move(0,id,"Arrived");await f.Move(0,id,"InProgress");
                }
                // An office availability change must survive closing the active ride.
                await f.WithDb(async db=>{(await db.Set<Driver>().SingleAsync(d=>d.Id==f.DriverIds[0])).Status=DriverStatus.Offline;await db.SaveChangesAsync();});
                var closing=await Read(await f.Office.GetAsync($"/api/v1/rides/{id}"));
                await Read(await f.Office.PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status=scenario=="P_complete_keeps_offline"?"Completed":"Cancelled",version=closing["ride"]!["version"]!.GetValue<long>()}));
                Assert.Equal("Offline",(await Read(await f.Drivers[0].GetAsync("/api/v1/driver/me")))["status"]!.GetValue<string>());
                break;
            case "A_nearest_accept":
                await f.Accept(0,id);Assert.Equal("DRIVER_ASSIGNED",(await f.CustomerRide(id))["rideStatus"]!.GetValue<string>());
                Assert.Equal("Busy",(await Read(await f.Drivers[0].GetAsync("/api/v1/driver/me")))["status"]!.GetValue<string>());
                await f.WithDb(async db=>Assert.Single(await db.Set<Ride>().ToListAsync()));
                break;
            case "B_reject_next":
                await Read(await f.Drivers[0].PutAsJsonAsync($"/api/v1/driver/rides/{id}/reject",new{version=offer["version"]!.GetValue<long>()}));
                Assert.Empty(await f.Offers(0));Assert.Single(await f.Offers(1));await f.Accept(1,id);
                await f.WithDb(async db=>Assert.Equal(new[]{"REJECTED","ACCEPTED"},await db.Set<RideOffer>().OrderBy(o=>o.OfferedAt).Select(o=>o.Outcome).ToArrayAsync()));
                break;
            case "C_timeout_next":
                await f.WaitForOffer(1,id);Assert.Empty(await f.Offers(0));
                Assert.False((await f.Drivers[0].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Accepted",version=offer["version"]!.GetValue<long>()})).IsSuccessStatusCode);
                await f.Accept(1,id);await f.WithDb(async db=>Assert.Equal("TIMEOUT",(await db.Set<RideOffer>().SingleAsync(o=>o.DriverId==f.DriverIds[0])).Outcome));
                break;
            case "E_atomic_accept":
                var attempts=await Task.WhenAll(f.Drivers[0].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Accepted",version=offer["version"]!.GetValue<long>()}),f.Drivers[1].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Accepted",version=offer["version"]!.GetValue<long>()}),f.Drivers[0].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Accepted",version=offer["version"]!.GetValue<long>()}));
                Assert.Single(attempts,r=>r.IsSuccessStatusCode);
                await f.WithDb(async db=>{Assert.Single(await db.Set<RideOffer>().Where(o=>o.Outcome=="ACCEPTED").ToListAsync());Assert.Equal(f.DriverIds[0],(await db.Set<Ride>().SingleAsync()).DriverId);});
                break;
            case "F_customer_cancel":
                await Read(await f.Customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{id}/cancel",new{}));
                await Read(await f.Customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{id}/cancel",new{}));
                Assert.Empty(await f.Offers(0));Assert.Equal("CANCELLED",(await f.OfficeRow(id.ToString()))["rideStatus"]!.GetValue<string>());
                var second=Guid.NewGuid();await f.Request(second);await f.Accept(0,second);
                await Read(await f.Customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{second}/cancel",new{}));
                Assert.Equal("Available",(await Read(await f.Drivers[0].GetAsync("/api/v1/driver/me")))["status"]!.GetValue<string>());
                break;
            case "G_full_lifecycle_history":
                await f.Accept(0,id);
                Assert.NotNull((await f.CustomerRide(id))["vehicle"]);Assert.NotNull((await f.CustomerRide(id))["tracking"]);
                foreach(var (status,expected) in new[]{("DriverArriving","DRIVER_ARRIVING"),("Arrived","DRIVER_ARRIVED"),("InProgress","IN_PROGRESS"),("Completed","COMPLETED")})
                {
                    await f.Move(0,id,status);Assert.Equal(expected,(await f.CustomerRide(id))["rideStatus"]!.GetValue<string>());Assert.Equal(expected,(await f.OfficeRow(id.ToString()))["rideStatus"]!.GetValue<string>());
                    if(status=="InProgress")Assert.Equal(HttpStatusCode.Conflict,(await f.Customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{id}/cancel",new{})).StatusCode);
                }
                var events=(await Read(await f.Customer.GetAsync($"/api/v1/customer-app/rides/{id}/events"))).AsArray();
                Assert.True(events.Count>=6);Assert.All(events,e=>Assert.True(e!["createdAt"]!.GetValue<DateTimeOffset>()<=DateTimeOffset.UtcNow));
                var closed=await f.OfficeRow(id.ToString());closed["status"]="assigned";closed["dispatchStatus"]="SENT";
                Assert.Equal(HttpStatusCode.Conflict,(await f.Office.PutAsJsonAsync($"/api/v1/reception/rides/{id}",closed)).StatusCode);
                break;
            case "H_office_live_updates":
                var snapshot=await f.Office.GetAsync("/api/v1/reception/snapshot");await Read(snapshot);
                var waitingRequest=new HttpRequestMessage(HttpMethod.Get,"/api/v1/reception/snapshot?wait=true");waitingRequest.Headers.TryAddWithoutValidation("If-None-Match",snapshot.Headers.ETag!.ToString());
                var officeWaiting=f.Office.SendAsync(waitingRequest);
                var before=await Read(await f.Customer.GetAsync("/api/v1/customer-app/updates"));var customerWaiting=f.Customer.GetAsync("/api/v1/customer-app/updates?cursor="+before["cursor"]!.GetValue<string>());
                await f.Accept(0,id);
                Assert.Equal("DRIVER_ASSIGNED",(await Read(await officeWaiting.WaitAsync(TimeSpan.FromSeconds(5))))["rides"]![0]!["rideStatus"]!.GetValue<string>());
                Assert.Equal("DRIVER_ASSIGNED",(await Read(await customerWaiting.WaitAsync(TimeSpan.FromSeconds(5))))["rides"]![0]!["rideStatus"]!.GetValue<string>());
                break;
            case "I_office_override":
                var row=await f.OfficeRow(id.ToString());row["driverId"]=f.DriverIds[1].ToString();await Read(await f.Office.PutAsJsonAsync($"/api/v1/reception/rides/{id}",row));
                row=await f.OfficeRow(id.ToString());row["status"]="assigned";row["dispatchStatus"]="SENT";row["receptionPending"]=false;
                await Read(await f.Office.PutAsJsonAsync($"/api/v1/reception/rides/{id}",row));await f.Accept(1,id);Assert.Empty(await f.Offers(0));
                await f.WithDb(async db=>{var ride=await db.Set<Ride>().SingleAsync();Assert.Equal("MANUAL",ride.DispatchMode);Assert.Null(ride.OfferExpiresAt);Assert.Equal("OFFICE_OVERRIDE",(await db.Set<RideOffer>().SingleAsync()).Outcome);});
                break;
            case "L_offline_during_offer":
                await f.Availability(0,"Offline");await f.WaitForOffer(1,id);await f.Accept(1,id);
                Assert.Equal("Offline",(await Read(await f.Drivers[0].GetAsync("/api/v1/driver/me")))["status"]!.GetValue<string>());
                break;
            case "M_stale_during_offer":
                await f.WithDb(async db=>{(await db.Set<DriverLocation>().SingleAsync(l=>l.DriverId==f.DriverIds[0])).UpdatedAt=DateTimeOffset.UtcNow.AddMinutes(-5);await db.SaveChangesAsync();});
                Assert.False((await f.Drivers[0].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Accepted",version=offer["version"]!.GetValue<long>()})).IsSuccessStatusCode);
                await f.WaitForOffer(1,id);await f.Accept(1,id);
                break;
            case "N_cancel_accept_race":
                var race=await Task.WhenAll(f.Customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{id}/cancel",new{}),f.Drivers[0].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status="Accepted",version=offer["version"]!.GetValue<long>()}));
                Assert.True(race[0].IsSuccessStatusCode);Assert.Equal("CANCELLED",(await f.CustomerRide(id))["rideStatus"]!.GetValue<string>());Assert.Empty(await f.Offers(0));
                await f.WithDb(async db=>Assert.False(await db.Set<RideOffer>().AnyAsync(o=>o.Outcome=="OFFERED")));
                break;
        }
    }
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");return JsonNode.Parse(body)!;
    }
    private sealed class Fixture : IAsyncDisposable
    {
        public ApiFactory Factory=null!;public HttpClient Customer=null!,Office=null!;public List<HttpClient> Drivers=[];public List<Guid> DriverIds=[];
        private NpgsqlConnection admin=null!;private string database="";private Guid tenantId;
        public static async Task<Fixture> Create()
        {
            var f=new Fixture();var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;f.database="complete_hailing_"+Guid.NewGuid().ToString("N");f.admin=new NpgsqlConnection(connection);await f.admin.OpenAsync();
            await using(var cmd=new NpgsqlCommand($"CREATE DATABASE {f.database}",f.admin))await cmd.ExecuteNonQueryAsync();
            try{
                f.Factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=f.database}.ConnectionString);
                using(var scope=f.Factory.Services.CreateScope())
                {
                    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();await db.Database.MigrateAsync();
                    await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="complete-stage",["Seed:AdminPassword"]="Stage-office-123!"}).Build());f.tenantId=tenant.TenantId;
                    db.Add(new DispatchPolicy{Mode="MANUAL",OfferTimeoutSeconds=10,LocationMaxAgeSeconds=60});
                    var role=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");var vc=await db.Set<VehicleClass>().FirstAsync();
                    for(var i=0;i<3;i++){
                        var user=new User{Username="driver"+i,RoleId=role.Id};user.PasswordHash=new PasswordHasher<User>().HashPassword(user,"Stage-driver-123!");
                        var driver=new Driver{UserId=user.Id,FullName="Stage Driver "+i,Phone="0591234500",Status=DriverStatus.Available};db.AddRange(user,driver);await db.SaveChangesAsync();
                        var car=new Vehicle{DriverId=driver.Id,VehicleClassId=vc.Id,Plate="STAGE-"+i,Make="Test"};db.Add(car);await db.SaveChangesAsync();driver.CurrentVehicleId=car.Id;await db.SaveChangesAsync();f.DriverIds.Add(driver.Id);
                    }
                }
                for(var i=0;i<3;i++){var client=await f.Login("driver"+i,"Stage-driver-123!");f.Drivers.Add(client);await Read(await client.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.251+i*.001,accuracy=5,capturedAt=DateTimeOffset.UtcNow}));}
                f.Office=await f.Login("admin","Stage-office-123!");f.Customer=f.Factory.CreateClient();
                var account=await Read(await f.Customer.PostAsJsonAsync("/api/v1/customer-app/register",new{tenant="complete-stage",accountId=Guid.NewGuid(),deviceSecret=new string('e',64),fullName="Stage Customer",phone="0591234567"}));
                f.Customer.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",account["accessToken"]!.GetValue<string>());return f;
            }catch{await f.DisposeAsync();throw;}
        }
        private async Task<HttpClient> Login(string username,string password){var c=Factory.CreateClient();var result=await Read(await c.PostAsJsonAsync("/api/v1/auth/login",new{tenant="complete-stage",username,password}));c.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",result["accessToken"]!.GetValue<string>());return c;}
        public async Task WithDb(Func<TaxiDb,Task> work){using var scope=Factory.Services.CreateScope();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;await work(scope.ServiceProvider.GetRequiredService<TaxiDb>());}
        public Task<HttpResponseMessage> RequestResponse(Guid id)=>Customer.PostAsJsonAsync("/api/v1/customer-app/rides",new{id,pickup=new{addressText="Stage GPS",latitude=32.22,longitude=35.25,locationSource="CUSTOMER_GPS"},destination="Stage destination",destinationLocation=new{addressText="Stage destination",latitude=32.23,longitude=35.27,locationSource="MAP_PIN"}});
        public async Task Request(Guid id)=>await Read(await RequestResponse(id));
        public async Task<JsonNode> CustomerRide(Guid id)=>await Read(await Customer.GetAsync($"/api/v1/customer-app/rides/{id}"));
        public async Task<JsonNode> OfficeRow(string id)=>(await Read(await Office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray().Single(r=>r!["id"]!.GetValue<string>()==id)!;
        public async Task<JsonArray> Offers(int driver)=>(await Read(await Drivers[driver].GetAsync("/api/v1/driver/updates")))["data"]!["rides"]!.AsArray();
        public async Task Accept(int driver,Guid id)=>await Move(driver,id,"Accepted");
        public async Task Move(int driver,Guid id,string status){var ride=await Read(await Drivers[driver].GetAsync($"/api/v1/driver/rides/{id}"));await Read(await Drivers[driver].PutAsJsonAsync($"/api/v1/rides/{id}/status",new{status,version=ride["version"]!.GetValue<long>()}));}
        public async Task Availability(int driver,string status)=>await Read(await Drivers[driver].PutAsJsonAsync("/api/v1/driver/availability",new{status}));
        public async Task WaitForOffer(int driver,Guid id){var deadline=DateTimeOffset.UtcNow.AddSeconds(20);while(DateTimeOffset.UtcNow<deadline){if((await Offers(driver)).Any(r=>r!["id"]!.GetValue<Guid>()==id))return;await Task.Delay(300);}Assert.Fail("Next driver did not receive offer");}
        public async ValueTask DisposeAsync(){Customer?.Dispose();Office?.Dispose();foreach(var d in Drivers)d.Dispose();if(Factory is not null)await Factory.DisposeAsync();NpgsqlConnection.ClearAllPools();if(admin is not null){await using var drop=new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();await admin.DisposeAsync();}}
    }
}
