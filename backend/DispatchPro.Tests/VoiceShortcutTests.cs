using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;
public sealed class VoiceShortcutTests {
 [Theory]
 [InlineData("F1",true)][InlineData("Space",true)][InlineData("ControlLeft",true)][InlineData("AltLeft",true)][InlineData("F5",false)][InlineData("Ctrl+W",false)][InlineData("Alt+F4",false)][InlineData("Delete",false)]
 public void RejectReservedShortcuts(string code,bool valid)=>Assert.Equal(valid,VoiceEndpoints.ValidShortcut(code));
 private static async Task<JsonNode> Read(HttpResponseMessage response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");return JsonNode.Parse(body)!;}
 [PostgresFact]
 public async Task ShortcutSurvivesNewSessionAndIsScopedToOfficeUserAndTenant(){
  var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
  await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
  var name="taxi_voice_shortcut_"+Guid.NewGuid().ToString("N");
  await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
  await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
  using(var scope=factory.Services.CreateScope()){
   var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
   foreach(var slug in new[]{"shortcut-a","shortcut-b"})await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]=slug,["Seed:AdminPassword"]="Shortcut-test-password!"}).Build());
  }
  async Task<HttpClient> Login(string slug,string username="admin") {var client=factory.CreateClient();var login=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant=slug,username,password="Shortcut-test-password!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());return client;}
  using var a=await Login("shortcut-a");using var b=await Login("shortcut-b");using var anon=factory.CreateClient();
  Assert.Equal(HttpStatusCode.Unauthorized,(await anon.GetAsync("/api/v1/voice/shortcut")).StatusCode);
  Assert.Equal("F1",(await Read(await a.GetAsync("/api/v1/voice/shortcut")))["code"]!.GetValue<string>());
  await Read(await a.PutAsJsonAsync("/api/v1/voice/shortcut",new{code="F2"}));
  Assert.Equal("F1",(await Read(await b.GetAsync("/api/v1/voice/shortcut")))["code"]!.GetValue<string>());
  using var renewed=await Login("shortcut-a");Assert.Equal("F2",(await Read(await renewed.GetAsync("/api/v1/voice/shortcut")))["code"]!.GetValue<string>());
  Assert.Equal(HttpStatusCode.BadRequest,(await a.PutAsJsonAsync("/api/v1/voice/shortcut",new{code="F5"})).StatusCode);
  var roles=(await Read(await a.GetAsync("/api/v1/roles"))).AsArray();
  var officeRole=roles.Single(r=>r!["name"]!.GetValue<string>()=="Dispatcher")!["id"]!.GetValue<string>();
  await Read(await a.PostAsJsonAsync("/api/v1/users",new{username="second-office",password="Shortcut-test-password!",roleId=officeRole}));
  using var second=await Login("shortcut-a","second-office");Assert.Equal("F1",(await Read(await second.GetAsync("/api/v1/voice/shortcut")))["code"]!.GetValue<string>());
  var driverRole=roles.Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<string>();
  await Read(await a.PostAsJsonAsync("/api/v1/users",new{username="driver-shortcut",password="Shortcut-test-password!",roleId=driverRole}));
  using var driver=await Login("shortcut-a","driver-shortcut");Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/voice/shortcut")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await driver.PutAsJsonAsync("/api/v1/voice/shortcut",new{code="F2"})).StatusCode);
  await Read(await a.PutAsJsonAsync("/api/v1/voice/shortcut",new{code="F1"}));Assert.Equal("F1",(await Read(await renewed.GetAsync("/api/v1/voice/shortcut")))["code"]!.GetValue<string>());
 }
}
