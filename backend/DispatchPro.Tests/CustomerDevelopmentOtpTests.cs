using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;

public sealed class CustomerDevelopmentOtpTests
{
    [Theory]
    [InlineData("Development",true,true)][InlineData("Development",false,false)]
    [InlineData("Production",true,false)][InlineData("Staging",true,false)]
    public void ExplicitDevelopmentOnly(string environment,bool optIn,bool expected){
        var host=new TestEnvironment{EnvironmentName=environment};
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"CustomerOtp:DevelopmentEnabled",optIn.ToString()}}).Build();
#if !DEBUG
        expected=false; // All environment/flag combinations are disabled in Release.
#endif
        Assert.Equal(expected,DevelopmentCustomerOtp.Enabled(host,config));
    }
    [PostgresFact]
    public async Task DebugChallengeRegistersNormallyAndProductionRejectsDisclosure(){
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;var name="debug_otp_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try{
            var testConnection=new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString;
            await using var dev=new OtpFactory(testConnection,"Development");
            using(var scope=dev.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Seed:TenantSlug","debug-otp"},{"Seed:AdminPassword","Debug-only-test-123!"}}).Build());}
            using var client=dev.CreateClient();client.DefaultRequestHeaders.Add("X-Customer-Debug","1");
            var account=Guid.NewGuid();var input=new{tenant="debug-otp",accountId=account,phone="0592081197"};
            var response=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",input);
#if DEBUG
            response.EnsureSuccessStatusCode();
            var challenge=JsonNode.Parse(await response.Content.ReadAsStringAsync())!;Assert.True(challenge["developmentOnly"]!.GetValue<bool>());Assert.Equal("no-store",response.Headers.CacheControl?.ToString());
            var verified=await client.PostAsJsonAsync("/api/v1/customer-app/otp/verify",new{input.tenant,input.accountId,challengeId=challenge["challengeId"]!.GetValue<Guid>(),code=challenge["debugCode"]!.GetValue<string>()});verified.EnsureSuccessStatusCode();
            var proof=JsonNode.Parse(await verified.Content.ReadAsStringAsync())!["verificationProof"]!.GetValue<string>();
            var register=await client.PostAsJsonAsync("/api/v1/customer-app/register",new{input.tenant,input.accountId,phone="+970592081197",fullName="اختبار تطوير",deviceSecret=new string('c',64),verificationProof=proof});register.EnsureSuccessStatusCode();
            var token=JsonNode.Parse(await register.Content.ReadAsStringAsync())!["accessToken"]!.GetValue<string>();
            client.DefaultRequestHeaders.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",token);
            var me=await client.GetAsync("/api/v1/customer-app/me");me.EnsureSuccessStatusCode();
            Assert.Equal("0592081197",JsonNode.Parse(await me.Content.ReadAsStringAsync())!["phone"]!.GetValue<string>());
            client.DefaultRequestHeaders.Remove("X-Customer-Debug");
            var release=await client.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{input.tenant,accountId=Guid.NewGuid(),phone="0562081197"});Assert.Equal(HttpStatusCode.ServiceUnavailable,release.StatusCode);Assert.Null(JsonNode.Parse(await release.Content.ReadAsStringAsync())!["debugCode"]);
#else
            Assert.Equal(HttpStatusCode.ServiceUnavailable,response.StatusCode);
            Assert.DoesNotContain("debugCode",await response.Content.ReadAsStringAsync());
#endif
            await using var production=new OtpFactory(testConnection,"Production");using var prod=production.CreateClient();prod.DefaultRequestHeaders.Add("X-Customer-Debug","1");
            var blocked=await prod.PostAsJsonAsync("/api/v1/customer-app/otp/request",new{input.tenant,accountId=Guid.NewGuid(),phone="0592081198"});Assert.Equal(HttpStatusCode.ServiceUnavailable,blocked.StatusCode);Assert.DoesNotContain("debugCode",await blocked.Content.ReadAsStringAsync());
        }finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
    private sealed class OtpFactory(string connection,string environment):WebApplicationFactory<Program>{
        protected override void ConfigureWebHost(IWebHostBuilder builder)=>builder.UseEnvironment(environment).ConfigureAppConfiguration((_,c)=>c.AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:Taxi",connection},{"Auth:SigningKey","debug-test-only-signing-key-012345678901234"},{"CustomerOtp:DevelopmentEnabled","true"}}));
    }
    private sealed class TestEnvironment:IHostEnvironment{
        public string EnvironmentName{get;set;}="Production";
        public string ApplicationName{get;set;}="DispatchPro.Tests";
        public string ContentRootPath{get;set;}=".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider{get;set;}=new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
