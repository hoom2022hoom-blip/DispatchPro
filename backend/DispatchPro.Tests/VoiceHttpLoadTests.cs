using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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

public sealed class VoiceHttpLoadTests
{
 static async Task<JsonNode> Read(HttpResponseMessage response){var text=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {text}");return JsonNode.Parse(text)!;}
 [PostgresFact] public async Task FiftyAuthenticatedHttpSessionsPublicPrivatePriorityAndChurn()
 {
  var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
  var name="voice_http_load_"+Guid.NewGuid().ToString("N");
  await using(var admin=new NpgsqlConnection(connection)){await admin.OpenAsync();await using var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin);await create.ExecuteNonQueryAsync();}
  // Keep the isolated database: this test never targets or drops the office DB.
  await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
  var clients=new List<HttpClient>();var ids=new List<Guid>();HttpClient office;
  using(var scope=factory.Services.CreateScope()){
   var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
   var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();
   await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="voice-load",["Seed:AdminPassword"]="Test-only-Voice-123!"}).Build());
   var role=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");var adminUser=await db.Set<User>().SingleAsync(u=>u.Username=="admin");
   var sessions=scope.ServiceProvider.GetRequiredService<OfficeSessions>();
   async Task<HttpClient> Client(User u){var session=JsonSerializer.SerializeToNode(await sessions.Create(u,"voice-load",Guid.NewGuid().ToString()))!;var client=factory.CreateClient();client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",session["accessToken"]!.GetValue<string>());return client;}
   office=await Client(adminUser);
   for(var i=0;i<50;i++){var user=new User{Username="load-"+i,RoleId=role.Id,PasswordHash=adminUser.PasswordHash};var driver=new Driver{UserId=user.Id,FullName="load-"+i,Status=DriverStatus.Available};db.Add(user);db.Add(driver);await db.SaveChangesAsync();ids.Add(driver.Id);clients.Add(await Client(user));}
  }
  try{
   // Sessions are created through the real durable session service. Login rate
   // limiting is tested separately; it is not disabled for this workload.
   var join=await Task.WhenAll(clients.Select(async c=>await Read(await c.PostAsJsonAsync("/api/v1/voice/session",new{multiplexed=true}))));
   var peers=join.Select(j=>j["peer"]!["id"]!.GetValue<string>()).ToArray();
   Assert.All(join,j=>Assert.True(j["multiplexedTransport"]!.GetValue<bool>()));
   Assert.All(join,j=>Assert.True(j["cancellableFloor"]!.GetValue<bool>()));
   // Empty-body legacy clients must remain compatible.
   var officeJoin=await Read(await office.PostAsync("/api/v1/voice/session",null));var officePeer=officeJoin["peer"]!["id"]!.GetValue<string>();
   var view=await Read(await office.GetAsync("/api/v1/voice/updates?sessionId="+officePeer));Assert.Equal(51,view["peers"]!.AsArray().Count);
   var cancelledAttempt=Guid.NewGuid();await Read(await clients[0].PostAsJsonAsync("/api/v1/voice/release",new{sessionId=peers[0],attemptId=cancelledAttempt}));
   Assert.Equal(HttpStatusCode.BadRequest,(await clients[0].PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=peers[0],channel="public",attemptId=cancelledAttempt})).StatusCode);
   var nextPress=await Read(await clients[0].PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=peers[0],channel="public",attemptId=Guid.NewGuid()}));
   await Read(await clients[0].PostAsJsonAsync("/api/v1/voice/release",new{sessionId=peers[0],attemptId=cancelledAttempt}));
   Assert.Equal(nextPress["id"]!.GetValue<string>(),Assert.Single((await Read(await office.GetAsync("/api/v1/voice/updates?sessionId="+officePeer)))["floors"]!.AsArray())!["id"]!.GetValue<string>());
   await Read(await clients[0].PostAsJsonAsync("/api/v1/voice/release",new{sessionId=peers[0],floorId=nextPress["id"]!.GetValue<string>()}));
   var durations=new List<double>();var began=Stopwatch.StartNew();var cpu=Process.GetCurrentProcess().TotalProcessorTime;
   for(var round=0;round<5;round++){
    var attempts=await Task.WhenAll(clients.Select(async(c,i)=>{var timer=Stopwatch.StartNew();using var response=await c.PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=peers[i],channel="public",attemptId=Guid.NewGuid()});return new{Index=i,Status=response.StatusCode,Body=await response.Content.ReadAsStringAsync(),Ms=timer.Elapsed.TotalMilliseconds};}));
    Assert.Single(attempts,a=>a.Status==HttpStatusCode.OK);Assert.Equal(49,attempts.Count(a=>a.Status==HttpStatusCode.Conflict));durations.AddRange(attempts.Select(a=>a.Ms));
    var winner=attempts.Single(a=>a.Status==HttpStatusCode.OK);var floor=JsonNode.Parse(winner.Body)!["id"]!.GetValue<string>();
    await Read(await clients[winner.Index].PostAsJsonAsync("/api/v1/voice/heartbeat",new{sessionId=peers[winner.Index],floorId=floor,audioStarted=true}));
    view=await Read(await office.GetAsync("/api/v1/voice/updates?sessionId="+officePeer));Assert.Equal(ids[winner.Index].ToString(),view["lastPublicSpeaker"]!["driverId"]!.GetValue<string>());
    var priority=await Read(await office.PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=officePeer,channel="public"}));
    var revoked=await Read(await clients[winner.Index].PostAsJsonAsync("/api/v1/voice/heartbeat",new{sessionId=peers[winner.Index],floorId=floor}));Assert.False(revoked["held"]!.GetValue<bool>());
    await Read(await office.PostAsJsonAsync("/api/v1/voice/release",new{sessionId=officePeer,floorId=priority["id"]!.GetValue<string>()}));
   }
   var privateFloor=await Read(await office.PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=officePeer,channel="private",driverId=ids[0]}));
   Assert.Single((await Read(await clients[0].GetAsync("/api/v1/voice/updates?sessionId="+peers[0])))["floors"]!.AsArray());
   Assert.Empty((await Read(await clients[1].GetAsync("/api/v1/voice/updates?sessionId="+peers[1])))["floors"]!.AsArray());
   await Read(await clients[49].PostAsJsonAsync("/api/v1/voice/release",new{sessionId=peers[49],leave=true}));
   view=await Read(await office.GetAsync("/api/v1/voice/updates?sessionId="+officePeer));Assert.Equal(50,view["peers"]!.AsArray().Count);Assert.Single(view["floors"]!.AsArray());
   await Read(await office.PostAsJsonAsync("/api/v1/voice/release",new{sessionId=officePeer,floorId=privateFloor["id"]!.GetValue<string>()}));
   durations.Sort();var report=new{kind="ASP.NET TestServer HTTP pipeline, real JWT/durable device sessions and PostgreSQL; no TCP or media",drivers=50,rounds=5,attempts=durations.Count,p50Ms=durations[durations.Count/2],p95Ms=durations[(int)(durations.Count*.95)],maxMs=durations[^1],elapsedMs=began.Elapsed.TotalMilliseconds,processCpuMs=(Process.GetCurrentProcess().TotalProcessorTime-cpu).TotalMilliseconds,processWorkingSetBytes=Process.GetCurrentProcess().WorkingSet64,databaseRetained=name};
   var output=Environment.GetEnvironmentVariable("DISPATCHPRO_VOICE_HTTP_REPORT");if(output!=null)File.WriteAllText(output,JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
  }finally{foreach(var c in clients)c.Dispose();office.Dispose();}
 }
}
