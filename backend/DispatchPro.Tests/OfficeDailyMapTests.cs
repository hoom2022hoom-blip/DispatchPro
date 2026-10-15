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
public sealed class OfficeDailyMapTests {
 private static async Task<JsonNode> Read(HttpResponseMessage response){var text=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {text}");return JsonNode.Parse(text)!;}
 [PostgresFact]
 public async Task DailyArchiveMapAndSampledGpsRemainTenantScoped(){
  var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
  await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
  var name="taxi_daily_map_"+Guid.NewGuid().ToString("N");
  await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
  // Preserve the isolated database for review; never modify or delete office data.
  await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
  using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="daily-map",["Seed:AdminPassword"]="Daily-map-password-123!"}).Build());}
  using var office=factory.CreateClient();using var mobile=factory.CreateClient();using var anon=factory.CreateClient();
  async Task Login(HttpClient client,string username){var login=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="daily-map",username,password="Daily-map-password-123!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());}
  await Login(office,"admin");
  var role=(await Read(await office.GetAsync("/api/v1/roles"))).AsArray().Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<string>();
  var user=await Read(await office.PostAsJsonAsync("/api/v1/users",new{username="map-driver",password="Daily-map-password-123!",roleId=role}));
  var driver=await Read(await office.PostAsJsonAsync("/api/v1/drivers",new{userId=user["id"]!.GetValue<string>(),fullName="Map Driver",status="Available"}));var driverId=Guid.Parse(driver["id"]!.GetValue<string>());
  await Login(mobile,"map-driver");
  Assert.Equal(HttpStatusCode.Unauthorized,(await anon.GetAsync("/api/v1/office/driver-map")).StatusCode);
  Assert.Equal(HttpStatusCode.Forbidden,(await mobile.GetAsync("/api/v1/office/driver-map")).StatusCode);
  var capturedAt=DateTimeOffset.UtcNow.AddSeconds(-40);
  await Read(await mobile.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.25,accuracy=8,capturedAt}));
  await Read(await mobile.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.23,longitude=35.26,accuracy=8,capturedAt=capturedAt.AddSeconds(15)}));
  var url=$"/api/v1/office/driver-map/{driverId}/route";
  Assert.Single((await Read(await office.GetAsync(url)))["points"]!.AsArray());
  await Read(await mobile.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.24,longitude=35.27,accuracy=8,capturedAt=DateTimeOffset.UtcNow}));
  Assert.Equal(2,(await Read(await office.GetAsync(url)))["points"]!.AsArray().Count);
  var mapped=(await Read(await office.GetAsync("/api/v1/office/driver-map")))["drivers"]!.AsArray().Single(d=>d!["id"]!.GetValue<Guid>()==driverId)!;
  Assert.Equal("FRESH",mapped["locationStatus"]!.GetValue<string>());Assert.Equal(32.24,mapped["location"]!["latitude"]!.GetValue<double>());
  async Task InDb(Func<TaxiDb,Task> action){using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Where(t=>t.Slug=="daily-map").Select(t=>t.Id).SingleAsync();await action(db);await db.SaveChangesAsync();}
  await InDb(async db=>{var l=await db.Set<DriverLocation>().SingleAsync();l.UpdatedAt=DateTimeOffset.UtcNow.AddMinutes(-10);foreach(var p in await db.Set<DriverGpsPoint>().ToListAsync())p.Timestamp=p.Timestamp.AddMinutes(-10);});
  mapped=(await Read(await office.GetAsync("/api/v1/office/driver-map")))["drivers"]!.AsArray().Single()!;Assert.Equal(32.24,mapped["location"]!["latitude"]!.GetValue<double>());Assert.Equal("STALE",mapped["locationStatus"]!.GetValue<string>());
  var time=DateTimeOffset.UtcNow.AddHours(-2);
  await InDb(db=>{for(var i=0;i<1001;i++)db.Add(new DriverGpsPoint{DriverId=driverId,Latitude=32.2,Longitude=35.2,Accuracy=10,Timestamp=time});return Task.CompletedTask;});
  var first=await Read(await office.GetAsync(url));Assert.Equal(1000,first["points"]!.AsArray().Count);Assert.True(first["hasMore"]!.GetValue<bool>());
  var last=first["points"]!.AsArray().Last()!;
  var next=await Read(await office.GetAsync(url+"?after="+Uri.EscapeDataString(last["timestamp"]!.GetValue<string>())+"&afterId="+last["id"]));Assert.Equal(3,next["points"]!.AsArray().Count);
  Assert.Equal(HttpStatusCode.BadRequest,(await office.GetAsync(url+"?from=2020-01-01T00:00:00Z")).StatusCode);
  JsonObject Order(string id)=>new(){["id"]=id,["passengerName"]="Daily Customer",["passengerPhone"]="0591234567",["pickup"]=new JsonObject{["name"]="Office",["coords"]=new JsonObject{["x"]=0,["y"]=0}},["dropoff"]=new JsonObject{["name"]="Destination"},["totalFare"]=0,["status"]="pending",["source"]="MANUAL"};
  foreach(var id in new[]{"today-order","yesterday-order","active-old"})await Read(await office.PutAsJsonAsync("/api/v1/reception/rides/"+id,Order(id)));
  var yesterday=ReceptionService.Day(DateTimeOffset.UtcNow.AddDays(-1));Guid activeId=Guid.Empty;
  await InDb(async db=>{foreach(var o in await db.Set<ReceptionOrder>().Where(o=>o.ExternalId!="today-order").ToListAsync()){o.Day=yesterday;var p=JsonNode.Parse(o.Payload)!;p["orderDay"]=yesterday;p["createdAt"]=DateTimeOffset.UtcNow.AddDays(-1);o.Payload=p.ToJsonString();if(o.ExternalId=="active-old")activeId=await db.Set<Ride>().Where(r=>r.RideRequestId==o.RideRequestId).Select(r=>r.Id).SingleAsync();}});
  var snapshot=(await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray();Assert.Single(snapshot);Assert.Equal("today-order",snapshot[0]!["id"]!.GetValue<string>());
  var active=await Read(await office.PutAsJsonAsync($"/api/v1/rides/{activeId}/assignment",new{driverId,version=1}));
  snapshot=(await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray();Assert.Equal(2,snapshot.Count);Assert.Equal(yesterday,snapshot.Single(r=>r!["id"]!.GetValue<string>()=="active-old")!["orderDay"]!.GetValue<string>());
  var historyUrl="/api/v1/reception/reports/history?kind=orders&from="+yesterday+"&to="+yesterday;
  Assert.Equal(2,(await Read(await office.GetAsync(historyUrl)))["total"]!.GetValue<int>());
  foreach(var filter in new[]{"&driverId="+driverId,"&search=Map%20Driver","&status=assigned"})Assert.Equal(1,(await Read(await office.GetAsync(historyUrl+filter)))["total"]!.GetValue<int>());
  Assert.Equal(2,(await Read(await office.GetAsync(historyUrl+"&status=active&source=MANUAL&search=Daily")))["total"]!.GetValue<int>());
  Assert.Equal(0,(await Read(await office.GetAsync(historyUrl+"&source=CUSTOMER_APP")))["total"]!.GetValue<int>());
  foreach(var status in new[]{"Accepted","DriverArriving","Arrived","InProgress","Completed"})active=await Read(await mobile.PutAsJsonAsync($"/api/v1/rides/{activeId}/status",new{status,version=active["version"]!.GetValue<long>(),collectedFare=status=="Completed"?(decimal?)30:null}));
  var completed=(await Read(await office.GetAsync(historyUrl+"&status=completed")))["items"]!.AsArray().Single()!;foreach(var field in new[]{"acceptedAt","startedAt","completedAt"})Assert.NotNull(completed[field]);
  Assert.Single((await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray());
 }
}
