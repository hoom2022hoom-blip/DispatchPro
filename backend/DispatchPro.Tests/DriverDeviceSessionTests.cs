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
public sealed class DriverDeviceSessionTests
{
 [PostgresFact]
 public async Task NewDeviceRevokesOldAccessAndRefreshAndConcurrentLoginLeavesOneSession()
 {
  var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
  var name="driver_device_"+Guid.NewGuid().ToString("N");
  await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
  await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
  try{
   await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
   using(var scope=factory.Services.CreateScope()){
    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
    var context=scope.ServiceProvider.GetRequiredService<TenantContext>();
    await Seed.RunAsync(db,context,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="devices",["Seed:AdminPassword"]="Device-test-password-123!"}).Build());
    var role=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");
    var user=new User{Username="driver",RoleId=role.Id};user.PasswordHash=new PasswordHasher<User>().HashPassword(user,"Device-test-password-123!");db.Add(user);db.Add(new Driver{UserId=user.Id,FullName="Device Driver",Status=DriverStatus.Offline});await db.SaveChangesAsync();
   }
   using var a=factory.CreateClient();using var b=factory.CreateClient();
   async Task<JsonNode> Login(HttpClient client,string device){var response=await client.PostAsJsonAsync("/api/v1/auth/driver-login",new{tenant="devices",username="driver",password="Device-test-password-123!",deviceId=device});Assert.Equal(HttpStatusCode.OK,response.StatusCode);return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;}
   var first=await Login(a,"device-a");a.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",first["accessToken"]!.GetValue<string>());Assert.Equal(HttpStatusCode.OK,(await a.GetAsync("/api/v1/driver/me")).StatusCode);
   var second=await Login(b,"device-b");b.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",second["accessToken"]!.GetValue<string>());Assert.Equal(HttpStatusCode.OK,(await b.GetAsync("/api/v1/driver/me")).StatusCode);
   var revoked=await a.GetAsync("/api/v1/driver/me");Assert.Equal(HttpStatusCode.Unauthorized,revoked.StatusCode);Assert.Contains("SESSION_REPLACED",await revoked.Content.ReadAsStringAsync());
   using var anonymous=factory.CreateClient();var oldRefresh=await anonymous.PostAsJsonAsync("/api/v1/auth/refresh",new{refreshToken=first["refreshToken"]!.GetValue<string>()});Assert.Equal(HttpStatusCode.Unauthorized,oldRefresh.StatusCode);Assert.Contains("SESSION_REPLACED",await oldRefresh.Content.ReadAsStringAsync());
   var concurrent=await Task.WhenAll(Login(anonymous,"device-c"),Login(anonymous,"device-d"));var valid=0;
   foreach(var session in concurrent){anonymous.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",session["accessToken"]!.GetValue<string>());if((await anonymous.GetAsync("/api/v1/driver/me")).StatusCode==HttpStatusCode.OK)valid++;}Assert.Equal(1,valid);
  }finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);if(Environment.GetEnvironmentVariable("DISPATCHPRO_KEEP_TEST_DATABASES")!="true") await drop.ExecuteNonQueryAsync();}
 }
}
