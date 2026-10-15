using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;

[Collection("QA audio environment")]
public sealed class QaOfficeAudioTests
{
 sealed class Factory(string connection):WebApplicationFactory<Program>
 {
  protected override void ConfigureWebHost(IWebHostBuilder b)=>b.UseEnvironment("DriverQa").ConfigureAppConfiguration((_,c)=>c.AddInMemoryCollection(new Dictionary<string,string?>{
   ["ConnectionStrings:Taxi"]=connection,["Auth:SigningKey"]="qa-audio-integration-only-key-0123456789",
   ["CustomerPush:Enabled"]="false",["CustomerSms:Provider"]="QA_DISABLED",["Qa:TenantSlug"]="driver-qa",
   ["CustomerPush:KeyRingPath"]=Path.Combine(Path.GetTempPath(),"dispatchpro-qa-audio-tests-keys")
  }));
 }
 static async Task<JsonNode> Read(HttpResponseMessage response){Assert.True(response.IsSuccessStatusCode,$"HTTP {(int)response.StatusCode}");var body=await response.Content.ReadAsStringAsync();return string.IsNullOrEmpty(body)?new JsonObject():JsonNode.Parse(body)!;}
 [PostgresFact]
 public async Task IsolatedOfficeChatAndCallsAreRetrySafeAuthorizedAndLeaveRidesUntouched()
 {
  var restricted=Environment.GetEnvironmentVariable("TAXI_QA_TEST_POSTGRES");Assert.False(string.IsNullOrEmpty(restricted));
  var role=new NpgsqlConnectionStringBuilder(restricted).Username!;Assert.StartsWith("driverqa_",role);
  var name="dispatchpro_driverqa_audio_test_"+Guid.NewGuid().ToString("N");
  await using var admin=new NpgsqlConnection(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES"));await admin.OpenAsync();
  await using(var create=new NpgsqlCommand($"CREATE DATABASE {name} OWNER \"{role.Replace("\"","\"\"")}\"",admin))await create.ExecuteNonQueryAsync();
  var appEnv=new Dictionary<string,string?>{["ConnectionStrings__Taxi"]=new NpgsqlConnectionStringBuilder(restricted){Database=name}.ConnectionString,["CustomerPush__Enabled"]="false",["CustomerSms__Provider"]="QA_DISABLED",["Qa__TenantSlug"]="driver-qa"};
  var saved=appEnv.ToDictionary(k=>k.Key,k=>Environment.GetEnvironmentVariable(k.Key));foreach(var pair in appEnv)Environment.SetEnvironmentVariable(pair.Key,pair.Value);
  try{
   await using(var dbadmin=new NpgsqlConnection(new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")){Database=name}.ConnectionString)){await dbadmin.OpenAsync();await using var ext=new NpgsqlCommand("CREATE EXTENSION postgis",dbadmin);await ext.ExecuteNonQueryAsync();}
   await using var factory=new Factory(new NpgsqlConnectionStringBuilder(restricted){Database=name}.ConnectionString);
   const string password="Qa-audio-test-only-123!";Guid channel;string peer;
   using(var scope=factory.Services.CreateScope()){
    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
    var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="driver-qa",["Seed:AdminUsername"]="qa.office",["Seed:AdminPassword"]=password,["Qa:DriverPassword"]=password,["Qa:PeerPassword"]=password}).Build();
    var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();await Seed.RunAsync(db,tenant,config);await DriverQaFixture.Seed(db,tenant,config);
    factory.Services.GetRequiredService<IConfiguration>()["Qa:TenantId"]=tenant.TenantId.ToString();
    channel=await db.Set<Driver>().Select(d=>d.Id).SingleAsync();peer=await db.Set<User>().Where(u=>u.Username.StartsWith("customer-")).Select(u=>u.Username).SingleAsync();
   }
   using var office=factory.CreateClient();using var driver=factory.CreateClient();using var customer=factory.CreateClient();
   async Task Login(HttpClient client,string user){var result=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="driver-qa",username=user,password}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",result["accessToken"]!.GetValue<string>());}
   await Login(office,"qa.office");await Login(driver,"qa.driver");await Login(customer,peer);
   var officePath=$"/api/v1/office-qa/rides/{channel}/chat";var driverPath=$"/api/v1/driver/rides/{channel}/chat";
   var message=new{id=Guid.NewGuid(),text="رسالة اختبار صوت المكتب"};await Read(await office.PostAsJsonAsync(officePath,message));await Read(await office.PostAsJsonAsync(officePath,message));
   var page=await Read(await driver.GetAsync(driverPath));Assert.Single(page["items"]!.AsArray());Assert.False(page["items"]![0]!["mine"]!.GetValue<bool>());
   Assert.Equal(HttpStatusCode.Conflict,(await office.PostAsJsonAsync(officePath,new{id=message.id,text="changed"})).StatusCode);
   Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync($"/api/v1/customer-app/rides/{channel}/chat")).StatusCode);
   Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync(officePath)).StatusCode);
   var dev=Guid.NewGuid();var od=Guid.NewGuid();
   var update=await Read(await driver.GetAsync($"/api/v1/driver/mobile/updates?deviceId={dev}"));Assert.Single(update["data"]!["chat"]!.AsArray());Assert.Equal(1,update["data"]!["unread"]![channel.ToString()]!.GetValue<int>());
   await Read(await driver.PostAsJsonAsync("/api/v1/driver/mobile/chat-read",new{rideId=channel,messageId=message.id}));
   await Read(await driver.PostAsJsonAsync(driverPath,new{id=Guid.NewGuid(),text="رد اختبار السائق"}));
   update=await Read(await driver.GetAsync($"/api/v1/driver/mobile/updates?deviceId={dev}"));Assert.Empty(update["data"]!["chat"]!.AsArray());Assert.Equal(0,update["data"]!["unread"]![channel.ToString()]!.GetValue<int>());
   update=await Read(await office.GetAsync($"/api/v1/office-qa/mobile/updates?deviceId={od}"));Assert.Single(update["data"]!["chat"]!.AsArray());
   foreach(var officeCalls in new[]{true,false}){
    var caller=officeCalls?office:driver;var callee=officeCalls?driver:office;var cp=officeCalls?"office-qa":"driver";var rp=officeCalls?"driver":"office-qa";var cd=officeCalls?od:dev;var rd=officeCalls?dev:od;
    var create=new{rideId=channel,deviceId=cd,requestId=Guid.NewGuid()};var call=await Read(await caller.PostAsJsonAsync($"/api/v1/{cp}/calls",create));var id=call["id"]!.GetValue<string>();Assert.Equal("ringing",call["state"]!.GetValue<string>());
    var retry=await Read(await caller.PostAsJsonAsync($"/api/v1/{cp}/calls",create));Assert.Equal(id,retry["id"]!.GetValue<string>());
    Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync($"/api/v1/customer-app/calls/{id}?deviceId={Guid.NewGuid()}")).StatusCode);
    call=await Read(await callee.PostAsJsonAsync($"/api/v1/{rp}/calls/{id}/answer",new{deviceId=rd}));Assert.Equal("active",call["state"]!.GetValue<string>());
    await Read(await callee.PostAsJsonAsync($"/api/v1/{rp}/calls/{id}/answer",new{deviceId=rd}));
    Assert.Equal(HttpStatusCode.Conflict,(await callee.PostAsJsonAsync($"/api/v1/{rp}/calls/{id}/end",new{deviceId=Guid.NewGuid()})).StatusCode);
    call=await Read(await caller.PostAsJsonAsync($"/api/v1/{cp}/calls/{id}/end",new{deviceId=cd}));Assert.Equal("ended",call["state"]!.GetValue<string>());
   }
   Assert.Equal(HttpStatusCode.Forbidden,(await office.PostAsJsonAsync("/api/v1/office-qa/calls",new{rideId=Guid.NewGuid(),deviceId=od,requestId=Guid.NewGuid()})).StatusCode);
   var isolation=await Read(await office.GetAsync("/qa/outbound-probe"));Assert.True(isolation["blocked"]!.GetValue<bool>());Assert.False(isolation["networkRequestSent"]!.GetValue<bool>());
   using(var scope=factory.Services.CreateScope()){
    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=Guid.Parse(factory.Services.GetRequiredService<IConfiguration>()["Qa:TenantId"]!);
    Assert.Empty(await db.Set<Ride>().ToListAsync());Assert.Empty(await db.Set<RideRequest>().ToListAsync());Assert.Equal(DriverStatus.Available,(await db.Set<Driver>().SingleAsync()).Status);
   }
  }finally{foreach(var pair in saved)Environment.SetEnvironmentVariable(pair.Key,pair.Value);NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
 }
}
[CollectionDefinition("QA audio environment",DisableParallelization=true)]
public sealed class QaAudioEnvironmentCollection { }
