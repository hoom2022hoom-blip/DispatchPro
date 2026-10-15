using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;
public sealed class CentralCallStateTests
{
    private static async Task<JsonObject> Read(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}");
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
    }
    private static async Task Login(HttpClient client, string tenant)
    {
        var login = await Read(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant, username="admin",password="Central-call-test-only!" }));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());
    }
    [PostgresFact]
    public async Task IndependentOfficeDevicesReceiveSameCommittedCallAndOtherOfficeStaysIsolatedAcrossRestart()
    {
        var database="taxi_test_"+Guid.NewGuid().ToString("N");
        var adminConnection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin=new NpgsqlConnection(adminConnection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {database}",admin))await create.ExecuteNonQueryAsync();
        var connection=new NpgsqlConnectionStringBuilder(adminConnection){Database=database}.ConnectionString;
        try
        {
            await using(var factory=new ApiFactory(connection))
            {
                using(var scope=factory.Services.CreateScope())
                {
                    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();
                    foreach(var slug in new[]{"central-a","central-b"})await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]=slug,["Seed:AdminPassword"]="Central-call-test-only!"}).Build());
                }
                using var a=factory.CreateClient();using var a2=factory.CreateClient();using var b=factory.CreateClient();using var anonymous=factory.CreateClient();
                await Login(a,"central-a");await Login(a2,"central-a");await Login(b,"central-b");
                Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/v1/reception/call-updates")).StatusCode);
                Assert.Equal(HttpStatusCode.BadRequest,(await a.GetAsync("/api/v1/reception/call-updates?cursor="+new string('x',65))).StatusCode);
                foreach(var client in new[]{a,b})Assert.Equal(HttpStatusCode.OK,(await client.PutAsync("/api/v1/features/CallerId?enabled=true",null)).StatusCode);
                var tenantA=(await Read(await a.GetAsync("/api/v1/me")))["tenantId"]!.GetValue<Guid>();
                var tenantB=(await Read(await b.GetAsync("/api/v1/me")))["tenantId"]!.GetValue<Guid>();
                var baseline=await Read(await a.GetAsync("/api/v1/reception/call-updates"));Assert.Null(baseline["data"]);
                var cursor=baseline["cursor"]!.GetValue<string>();
                using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var waitA=a.GetAsync("/api/v1/reception/call-updates?cursor="+cursor,timeout.Token);
                var waitA2=a2.GetAsync("/api/v1/reception/call-updates?cursor="+cursor,timeout.Token);
                var waitB=b.GetAsync("/api/v1/reception/call-updates?cursor="+cursor,timeout.Token);
                await Task.Delay(50);
                var input=new {source="LANDLINE",callerNumber="0000",eventId="central-field-fixture",receivedAt="2026-10-04T12:00:00Z",tenantId=tenantA,line="01"};
                await Read(await a.PostAsJsonAsync("/api/v1/reception/bridge/calls",input));
                var stateA=await Read(await waitA);var stateA2=await Read(await waitA2);
                Assert.Equal(stateA["cursor"]!.GetValue<string>(),stateA2["cursor"]!.GetValue<string>());
                Assert.True(JsonNode.DeepEquals(stateA["data"],stateA2["data"]));
                Assert.Equal(input.eventId,stateA["data"]!["eventId"]!.GetValue<string>());
                Assert.Equal("no-store",(await a.GetAsync("/api/v1/reception/latest-call")).Headers.CacheControl?.ToString());
                Assert.False(waitB.IsCompleted);
                var replay=await Read(await a.PostAsJsonAsync("/api/v1/reception/bridge/calls",input));Assert.True(replay["duplicate"]!.GetValue<bool>());
                Assert.Equal(HttpStatusCode.Conflict,(await a.PostAsJsonAsync("/api/v1/reception/bridge/calls",new {input.source,callerNumber="1111",input.eventId,input.receivedAt,input.tenantId})).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden,(await b.PostAsJsonAsync("/api/v1/reception/bridge/calls",input)).StatusCode);
                var bInput=new {source="LANDLINE",callerNumber="1111",eventId=input.eventId,receivedAt=input.receivedAt,tenantId=tenantB};
                await Read(await b.PostAsJsonAsync("/api/v1/reception/bridge/calls",bInput));
                Assert.Equal("1111",(await Read(await waitB))["data"]!["phone"]!.GetValue<string>());
                await Read(await a.PostAsJsonAsync("/api/v1/reception/bridge/calls",new {input.source,input.callerNumber,eventId="older-retry",receivedAt="2026-10-03T12:00:00Z",input.tenantId}));
                Assert.Equal(input.eventId,(await Read(await a.GetAsync("/api/v1/reception/call-updates")))["data"]!["eventId"]!.GetValue<string>());
                var snapshot=await Read(await a.GetAsync("/api/v1/reception/snapshot"));Assert.Single(snapshot["rides"]!.AsArray(),r=>r!["callEventId"]!.GetValue<string>()==input.eventId);
            }
            await using(var restarted=new ApiFactory(connection))
            {
                using var client=restarted.CreateClient();await Login(client,"central-a");
                Assert.Equal("central-field-fixture",(await Read(await client.GetAsync("/api/v1/reception/call-updates")))["data"]!["eventId"]!.GetValue<string>());
            }
        }
        finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
