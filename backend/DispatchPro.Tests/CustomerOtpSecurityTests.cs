using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;
public sealed class CustomerOtpSecurityTests{
 private sealed class FailingSms : ICustomerSmsSender {
  public int Calls;public bool Enabled=>true;
  public Task Send(Guid tenant,string phone,string code,Guid challenge,CancellationToken ct){Calls++;throw new HttpRequestException("test ambiguous provider failure");}
 }
 [PostgresFact]
 public async Task ChallengesAreBoundLimitedSingleUseAndSessionsRevocable(){
  var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;var name="otp_security_"+Guid.NewGuid().ToString("N");await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
  try{await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);Guid tenantId;
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();var context=scope.ServiceProvider.GetRequiredService<TenantContext>();await Seed.RunAsync(db,context,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Seed:TenantSlug","otp-test"},{"Seed:AdminPassword","Otp-test-admin-password-123!"}}).Build());tenantId=context.TenantId;}
   using var client=factory.CreateClient();var account=Guid.NewGuid();var input=new{tenant="otp-test",accountId=account,phone="0591234321",deviceSecret=new string('c',64),fullName="اختبار التحقق"};
   Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsJsonAsync("/api/v1/customer-app/register",input)).StatusCode);
   var challengeResponse=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",input);challengeResponse.EnsureSuccessStatusCode();var body=await challengeResponse.Content.ReadAsStringAsync();var id=JsonNode.Parse(body)!["challengeId"]!.GetValue<Guid>();Assert.DoesNotContain(TestCustomerSms.Codes[id],body);
   Assert.Equal(HttpStatusCode.TooManyRequests,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",input)).StatusCode);
   Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-test",accountId=Guid.NewGuid(),challengeId=id,code=TestCustomerSms.Codes[id]})).StatusCode);
   var verified=await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-test",accountId=account,challengeId=id,code=TestCustomerSms.Codes[id]});verified.EnsureSuccessStatusCode();var proof=JsonNode.Parse(await verified.Content.ReadAsStringAsync())!["verificationProof"]!.GetValue<string>();
   Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-test",accountId=account,challengeId=id,code=TestCustomerSms.Codes[id]})).StatusCode);
   Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsJsonAsync("/api/v1/customer-app/register",new{tenant="otp-test",accountId=Guid.NewGuid(),phone=input.phone,input.deviceSecret,input.fullName,verificationProof=proof})).StatusCode);
   var registered=await client.PostAsJsonAsync("/api/v1/customer-app/register",new{input.tenant,input.accountId,input.phone,input.deviceSecret,input.fullName,verificationProof=proof});registered.EnsureSuccessStatusCode();var access=JsonNode.Parse(await registered.Content.ReadAsStringAsync())!["accessToken"]!.GetValue<string>();client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",access);
   Assert.Equal(HttpStatusCode.OK,(await client.GetAsync("/api/v1/customer-app/me")).StatusCode);Assert.Equal(HttpStatusCode.NoContent,(await client.PostAsJsonAsync("/api/v1/customer-app/logout",new{})).StatusCode);Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/v1/customer-app/me")).StatusCode);client.DefaultRequestHeaders.Authorization=null;
   var blockedAccount=Guid.NewGuid();var blocked=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{tenant="otp-test",accountId=blockedAccount,phone="0591234322"});blocked.EnsureSuccessStatusCode();var blockedId=JsonNode.Parse(await blocked.Content.ReadAsStringAsync())!["challengeId"]!.GetValue<Guid>();var wrong=TestCustomerSms.Codes[blockedId]=="111111"?"222222":"111111";
   for(var i=0;i<5;i++)Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-test",accountId=blockedAccount,challengeId=blockedId,code=wrong})).StatusCode);
   Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-test",accountId=blockedAccount,challengeId=blockedId,code=TestCustomerSms.Codes[blockedId]})).StatusCode);
   using(var scope=factory.Services.CreateScope()){scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var stored=await db.Set<AuditLog>().SingleAsync(a=>a.Id==id);Assert.DoesNotContain(input.phone,stored.Detail);Assert.DoesNotContain(TestCustomerSms.Codes[id],stored.Detail);Assert.Equal(5,await db.Set<AuditLog>().CountAsync(a=>a.EntityId==blockedId&&a.Action=="customer.otp.attempt"));}
   var expiredAccount=Guid.NewGuid();var expired=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{tenant="otp-test",accountId=expiredAccount,phone="0591234324"});expired.EnsureSuccessStatusCode();var expiredId=JsonNode.Parse(await expired.Content.ReadAsStringAsync())!["challengeId"]!.GetValue<Guid>();
   using(var scope=factory.Services.CreateScope()){scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var row=await db.Set<AuditLog>().SingleAsync(a=>a.Id==expiredId);var protector=scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>().CreateProtector("DispatchPro.CustomerOtp.v1",tenantId.ToString());var value=JsonSerializer.Deserialize<CustomerOtpChallenge>(protector.Unprotect(row.Detail))!;var expiredDetail=protector.Protect(JsonSerializer.Serialize(value with{Expires=DateTimeOffset.UtcNow.AddMinutes(-1)}));await db.Set<AuditLog>().Where(a=>a.Id==expiredId).ExecuteUpdateAsync(set=>set.SetProperty(a=>a.Detail,expiredDetail));db.Add(new Tenant{Name="اختبار العزل",Slug="otp-other"});await db.SaveChangesAsync();}
   Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-test",accountId=expiredAccount,challengeId=expiredId,code=TestCustomerSms.Codes[expiredId]})).StatusCode);
   Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{tenant="otp-other",accountId=expiredAccount,challengeId=expiredId,code=TestCustomerSms.Codes[expiredId]})).StatusCode);
   var failedSender=new FailingSms();await using var failing=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<ICustomerSmsSender>();s.AddSingleton<ICustomerSmsSender>(failedSender);}));using var failedClient=failing.CreateClient();
   Assert.Equal(HttpStatusCode.BadRequest,(await failedClient.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{tenant="otp-test",accountId=Guid.NewGuid(),phone="092081197"})).StatusCode);Assert.Equal(0,failedSender.Calls);
   var ambiguousInput=new{tenant="otp-test",accountId=Guid.NewGuid(),phone="0561234323"};
   Assert.Equal(HttpStatusCode.ServiceUnavailable,(await failedClient.PostAsJsonAsync("/api/v1/customer-app/otp/request",ambiguousInput)).StatusCode);
   Assert.Equal(HttpStatusCode.TooManyRequests,(await failedClient.PostAsJsonAsync("/api/v1/customer-app/otp/request",ambiguousInput)).StatusCode);Assert.Equal(1,failedSender.Calls);
   await using var disabled=factory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<ICustomerSmsSender>();s.AddSingleton<ICustomerSmsSender,UnconfiguredCustomerSmsSender>();}));using var unavailable=disabled.CreateClient();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await unavailable.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{tenant="otp-test",accountId=Guid.NewGuid(),phone="0591234323"})).StatusCode);
  }finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
 }
}
