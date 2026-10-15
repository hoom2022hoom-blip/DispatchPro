using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;
public sealed class CustomerInternetTestLoginTests
{
    [Theory]
    [InlineData("CustomerTest",true,true)]
    [InlineData("CustomerTest",false,false)]
    [InlineData("Production",true,false)]
    [InlineData("Development",true,false)]
    [InlineData("Staging",true,false)]
    public void ExplicitIsolatedTestMode(string environment,bool flag,bool expected)
    {
#if !DEBUG
        expected=false;
#endif
        Assert.Equal(expected,CustomerTestAccess.Enabled(new Host{EnvironmentName=environment},Config(flag)));
    }

    [PostgresFact]
    public async Task ConcurrentPhonesDevicesSessionsAndRealOrdersRemainIsolated()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name="customer_multi_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try
        {
            var scoped=new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString;
            await using var test=new Factory(scoped,"CustomerTest");
            using(var scope=test.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
                await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Seed:TenantSlug",CustomerTestAccess.Office},{"Seed:AdminPassword","Fixture-password-123!"}}).Build());
            }
            using var client=test.CreateClient();
            var account=Guid.NewGuid();var input=new{tenant=CustomerTestAccess.Office,phone="0592081197",accountId=account};
            Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsJsonAsync("/api/v1/customer-app/test-otp/request",input)).StatusCode);
            client.DefaultRequestHeaders.Add("X-Customer-Debug","1");
            Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsJsonAsync("/api/v1/customer-app/test-otp/request",new{tenant="production-office",input.phone,input.accountId})).StatusCode);
#if DEBUG
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/test-otp/request",new{input.tenant,phone="invalid",input.accountId})).StatusCode);
            var accounts=new[]{account,Guid.NewGuid(),Guid.NewGuid()};
            var phones=new[]{"0592081197","0562081198","+972 59-208-1197"};
            var names=new[]{"زبون ألف","زبون باء","زبون ألف"};
            var challenges=await Task.WhenAll(Enumerable.Range(0,3).Select(async i=>await Body(await client.PostAsJsonAsync("/api/v1/customer-app/test-otp/request",new{tenant=input.tenant,phone=phones[i],accountId=accounts[i]}))));
            Assert.Equal(3,challenges.Select(c=>c["challengeId"]!.GetValue<Guid>()).Distinct().Count());
            Assert.All(challenges,c=>Assert.Matches("^[0-9]{6}$",c["debugCode"]!.GetValue<string>()));
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{input.tenant,accountId=accounts[1],challengeId=challenges[0]["challengeId"]!.GetValue<Guid>(),code=challenges[0]["debugCode"]!.GetValue<string>()})).StatusCode);
            var proofs=await Task.WhenAll(Enumerable.Range(0,3).Select(async i=>await Body(await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{input.tenant,accountId=accounts[i],challengeId=challenges[i]["challengeId"]!.GetValue<Guid>(),code=challenges[i]["debugCode"]!.GetValue<string>()}))));
            await using var prod=new Factory(scoped,"Production");using var production=prod.CreateClient();production.DefaultRequestHeaders.Add("X-Customer-Debug","1");
            var registration=new{input.tenant,accountId=accounts[0],phone=phones[0],fullName=names[0],deviceSecret=new string('a',64),verificationProof=proofs[0]["verificationProof"]!.GetValue<string>()};
            Assert.Equal(HttpStatusCode.Forbidden,(await production.PostAsJsonAsync("/api/v1/customer-app/register",registration)).StatusCode);
            var registered=new JsonNode[3];
            for(var i=0;i<3;i++)registered[i]=await Body(await client.PostAsJsonAsync("/api/v1/customer-app/register",new{input.tenant,accountId=accounts[i],phone=phones[i],fullName=names[i],deviceSecret=new string((char)('a'+i),64),verificationProof=proofs[i]["verificationProof"]!.GetValue<string>()}));
            var tokens=registered.Select(r=>r["accessToken"]!.GetValue<string>()).ToArray();
            var profiles=registered.Select(r=>r["profile"]!["id"]!.GetValue<Guid>()).ToArray();
            Assert.Equal(profiles[0],profiles[2]);Assert.NotEqual(profiles[0],profiles[1]);
            Assert.Equal("0592081197",registered[2]["profile"]!["phone"]!.GetValue<string>());
            Assert.All(registered,r=>Assert.False(r["profile"]!["phoneVerified"]!.GetValue<bool>()));
            var rides=new[]{Guid.NewGuid(),Guid.NewGuid()};
            for(var i=0;i<2;i++)
            {
                using var own=test.CreateClient();own.DefaultRequestHeaders.Authorization=new("Bearer",tokens[i]);
                await Body(await own.PostAsJsonAsync("/api/v1/customer-app/rides",new{id=rides[i],pickup=new{addressText="انطلاق "+i,latitude=32.22,longitude=35.25,locationSource="MAP_PIN"},destination="وجهة "+i,scheduledAt=DateTimeOffset.UtcNow.AddHours(2)}));
                Assert.Equal(HttpStatusCode.NotFound,(await own.GetAsync("/api/v1/customer-app/rides/"+rides[1-i])).StatusCode);
                Assert.Equal(HttpStatusCode.NotFound,(await own.PostAsJsonAsync("/api/v1/customer-app/rides/"+rides[1-i]+"/cancel",new{})).StatusCode);
            }
            using(var scope=test.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var context=scope.ServiceProvider.GetRequiredService<TenantContext>();context.TenantId=(await db.Set<Tenant>().SingleAsync(t=>t.Slug==input.tenant)).Id;
                Assert.Equal(2,await db.Set<Customer>().CountAsync());
                var requests=await db.Set<RideRequest>().ToListAsync();Assert.Equal(2,requests.Count);
                var orders=await db.Set<ReceptionOrder>().Where(o=>requests.Select(r=>r.Id).Contains(o.RideRequestId!.Value)).ToListAsync();Assert.Equal(2,orders.Count);
                foreach(var order in orders){var payload=JsonNode.Parse(order.Payload)!;Assert.Equal("CUSTOMER_APP",payload["source"]!.GetValue<string>());var request=requests.Single(r=>r.Id==order.RideRequestId);Assert.Equal(request.PassengerPhone,payload["passengerPhone"]!.GetValue<string>());Assert.Equal(request.PassengerName,payload["passengerName"]!.GetValue<string>());}
                Assert.False(await db.Set<AuditLog>().AnyAsync(a=>accounts.Contains(a.ActorId)&&a.Action=="customer.phone.verified"));
                var markers=await db.Set<AuditLog>().Where(a=>a.Action=="customer.phone.test-verified").Select(a=>a.Detail).ToListAsync();Assert.Equal(3,markers.Count);Assert.All(markers,m=>Assert.Null(JsonSerializer.Deserialize<CustomerTestAccess.Verification>(m)!.Expires));
                // An older test account's calendar lease no longer limits the
                // test mode; switching to Production still rejects it.
                context.ActorId=accounts[0];
                db.Add(new AuditLog{ActorId=accounts[0],EntityId=accounts[0],Action="customer.phone.test-verified",Detail=JsonSerializer.Serialize(new CustomerTestAccess.Verification(CustomerOtp.VerifiedKey(context.TenantId,phones[0]),DateTimeOffset.UtcNow.AddDays(-1)))});await db.SaveChangesAsync();
                Assert.True(await CustomerTestAccess.Verified(db,context,phones[0],test.Services.GetRequiredService<IHostEnvironment>(),test.Services.GetRequiredService<IConfiguration>()));
            }
            using var first=test.CreateClient();first.DefaultRequestHeaders.Authorization=new("Bearer",tokens[0]);
            Assert.Equal(HttpStatusCode.NoContent,(await first.PostAsJsonAsync("/api/v1/customer-app/logout",new{})).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,(await first.GetAsync("/api/v1/customer-app/me")).StatusCode);
            for(var i=1;i<3;i++){using var other=test.CreateClient();other.DefaultRequestHeaders.Authorization=new("Bearer",tokens[i]);var me=await Body(await other.GetAsync("/api/v1/customer-app/me"));Assert.Equal(profiles[i],me["id"]!.GetValue<Guid>());}
            Assert.Equal(HttpStatusCode.NotFound,(await production.PostAsJsonAsync("/api/v1/customer-app/test-otp/request",input)).StatusCode);
            production.DefaultRequestHeaders.Authorization=new("Bearer",tokens[1]);Assert.Equal(HttpStatusCode.Unauthorized,(await production.GetAsync("/api/v1/customer-app/me")).StatusCode);production.DefaultRequestHeaders.Authorization=null;
            Assert.Equal(HttpStatusCode.Unauthorized,(await production.PostAsJsonAsync("/api/v1/auth/login",new{input.tenant,username="customer-"+accounts[1].ToString("N"),password=new string('b',64)})).StatusCode);
#else
            Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsJsonAsync("/api/v1/customer-app/test-otp/request",input)).StatusCode);
            string proof;
            using(var scope=test.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var context=scope.ServiceProvider.GetRequiredService<TenantContext>();context.TenantId=(await db.Set<Tenant>().SingleAsync(t=>t.Slug==input.tenant)).Id;
                var role=new Role{Name="CustomerApp"};db.Add(role);var user=new User{Id=account,RoleId=role.Id,Username="customer-"+account.ToString("N")};user.PasswordHash=new PasswordHasher<User>().HashPassword(user,new string('a',64));db.Add(user);await db.SaveChangesAsync();
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Customer\" (\"Id\",\"TenantId\",\"FullName\",\"Phone\") VALUES ({account},{context.TenantId},{"Release fixture"},{input.phone})");
                var challenge=Guid.NewGuid();db.Add(new AuditLog{ActorId=account,EntityId=challenge,Action="customer.otp.verified"});db.Add(new AuditLog{ActorId=account,EntityId=account,Action="customer.phone.test-verified",Detail=JsonSerializer.Serialize(new CustomerTestAccess.Verification(CustomerOtp.VerifiedKey(context.TenantId,input.phone)))});await db.SaveChangesAsync();
                proof=scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>().CreateProtector("DispatchPro.CustomerOtp.v1",context.TenantId.ToString()).Protect(JsonSerializer.Serialize(new CustomerOtpProof(context.TenantId,account,input.phone,challenge,DateTimeOffset.UtcNow.AddMinutes(5),TestOnly:true)));
            }
            Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsJsonAsync("/api/v1/customer-app/register",new{input.tenant,input.accountId,input.phone,fullName="Release fixture",deviceSecret=new string('a',64),verificationProof=proof})).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized,(await client.PostAsJsonAsync("/api/v1/auth/login",new{input.tenant,username="customer-"+account.ToString("N"),password=new string('a',64)})).StatusCode);
#endif
            client.DefaultRequestHeaders.Authorization=null;
            var normal=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{input.tenant,input.phone,accountId=Guid.NewGuid()});Assert.Equal(HttpStatusCode.ServiceUnavailable,normal.StatusCode);Assert.DoesNotContain("debugCode",await normal.Content.ReadAsStringAsync());
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
    private static async Task<JsonNode> Body(HttpResponseMessage response){response.EnsureSuccessStatusCode();return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;}
    private static IConfiguration Config(bool flag)=>new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"CustomerTest:Enabled",flag.ToString()}}).Build();
    private sealed class Factory(string connection,string environment):WebApplicationFactory<Program>{protected override void ConfigureWebHost(IWebHostBuilder builder)=>builder.UseEnvironment(environment).ConfigureAppConfiguration((_,c)=>c.AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:Taxi",connection},{"Auth:SigningKey","isolated-test-signing-key-12345678901234567890"},{"CustomerTest:Enabled","true"}}));}
    private sealed class Host:IHostEnvironment{public string EnvironmentName{get;set;}="Production";public string ApplicationName{get;set;}="Tests";public string ContentRootPath{get;set;}=".";public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider{get;set;}=new Microsoft.Extensions.FileProviders.NullFileProvider();}
}
