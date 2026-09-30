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
public sealed class CustomerPhoneTests
{
    [Theory]
    [InlineData("+970592081197")][InlineData("970592081197")][InlineData("+972592081197")][InlineData("972592081197")][InlineData("0592081197")]
    public void SameLocalPhone(string input)=>Assert.Equal("0592081197",CustomerPhone.Local(input));
    private static async Task<JsonNode> Read(HttpResponseMessage response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");return JsonNode.Parse(body)!;}
    [PostgresFact]
    public async Task ExistingCustomerRecoveryIsScopedAndDoesNotDuplicate()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;var name="customer_phone_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try
        {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);var customerId=Guid.NewGuid();
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();
                await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="phone-test",["Seed:AdminPassword"]="Customer-phone-password-123!"}).Build());
                db.Add(new Customer{Id=customerId,FullName="Existing name",Phone="+970592081197"});await db.SaveChangesAsync();
            }
            using var client=factory.CreateClient();using var office=factory.CreateClient();
            var config=factory.Services.GetRequiredService<IConfiguration>();var secret=new string('b',64);
            object Input(Guid id,string phone)=>new{tenant="phone-test",accountId=id,deviceSecret=secret,fullName="Do not replace name",phone};
            Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsJsonAsync("/api/v1/customer-app/register",Input(Guid.NewGuid(),"0592081197"))).StatusCode);
            config["CustomerApp:TestPhoneRecoveryEnabled"]="true";config["CustomerApp:TestPhoneRecoveryTenant"]="different-office";
            Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsJsonAsync("/api/v1/customer-app/register",Input(Guid.NewGuid(),"0592081197"))).StatusCode);
            config["CustomerApp:TestPhoneRecoveryTenant"]="phone-test";
            string? firstToken=null;Guid lastAccount=Guid.Empty;
            foreach(var phone in CustomerPhone.Variants("0592081197"))
            {
                lastAccount=Guid.NewGuid();var result=await Read(await client.PostAsJsonAsync("/api/v1/customer-app/register",Input(lastAccount,phone)));
                var token=result["accessToken"]!.GetValue<string>();firstToken??=token;client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",token);
                Assert.Equal(customerId.ToString(),result["profile"]!["id"]!.GetValue<string>());Assert.Equal("0592081197",result["profile"]!["phone"]!.GetValue<string>());Assert.Equal("Existing name",result["profile"]!["fullName"]!.GetValue<string>());
                Assert.Equal(customerId.ToString(),(await Read(await client.GetAsync("/api/v1/customer-app/me")))["id"]!.GetValue<string>());
            }
            await Read(await client.PostAsJsonAsync("/api/v1/customer-app/register",Input(lastAccount,"+972592081197")));
            client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",firstToken);
            await Read(await client.GetAsync("/api/v1/customer-app/me")); // Earlier devices remain valid.
            var ot=await Read(await office.PostAsJsonAsync("/api/v1/auth/login",new{tenant="phone-test",username="admin",password="Customer-phone-password-123!"}));office.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",ot["accessToken"]!.GetValue<string>());
            foreach(var phone in CustomerPhone.Variants("0592081197")){var rows=(await Read(await office.GetAsync("/api/v1/customers?search="+Uri.EscapeDataString(phone)))).AsArray();Assert.Single(rows);Assert.Equal("0592081197",rows[0]!["phone"]!.GetValue<string>());}
            var rideId=Guid.NewGuid();await Read(await client.PostAsJsonAsync("/api/v1/customer-app/rides",new{id=rideId,pickup=new{addressText="Test pickup"},destination="Test destination"}));
            var order=Assert.Single((await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray())!;
            Assert.Equal("0592081197",order["passengerPhone"]!.GetValue<string>());Assert.Equal(customerId.ToString(),order["customerId"]!.GetValue<string>());
            using(var scope=factory.Services.CreateScope())
            {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                Assert.Equal(1,await db.Set<Customer>().CountAsync());Assert.Equal("0592081197",(await db.Set<Customer>().SingleAsync()).Phone);Assert.Equal("0592081197",(await db.Set<RideRequest>().SingleAsync()).PassengerPhone);
                Assert.Equal(5,await db.Set<AuditLog>().CountAsync(a=>a.Action=="customer-app.device-linked"));
            }
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
