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
public sealed class ReceptionReportTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response) {
        var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {text}"); return JsonNode.Parse(text)!;
    }
    [PostgresFact]
    public async Task LandlineOptionalAddressAndPagedReports()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin = new NpgsqlConnection(connection); await admin.OpenAsync();
        var name = "taxi_report_test_" + Guid.NewGuid().ToString("N");
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await create.ExecuteNonQueryAsync();
        try {
            await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(connection) { Database = name }.ConnectionString);
            using (var scope = factory.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); await db.Database.MigrateAsync();
                await Seed.RunAsync(db, scope.ServiceProvider.GetRequiredService<TenantContext>(), new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"]="reports",["Seed:AdminPassword"]="Reports-password-123!" }).Build());
            }
            using var client = factory.CreateClient();
            var login = await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new {tenant="reports",username="admin",password="Reports-password-123!"}));
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());
            var driver = await Read(await client.PostAsJsonAsync("/api/v1/office/drivers",new {fullName="سائق التقرير",phone="0591234567",active=true,status="Available"}));
            var customer = await Read(await client.PostAsJsonAsync("/api/v1/customers",new {fullName="زبون التقرير",phone="0597654321"}));
            JsonObject Order(string id, string phone, string person) => new() { ["id"]=id,["passengerName"]=person,["passengerPhone"]=phone,["pickup"]=new JsonObject { ["name"]="",["coords"]=new JsonObject { ["x"]=0,["y"]=0 } },["totalFare"]=0,["status"]="pending",["source"]="MANUAL" };
            var landline = await Read(await client.PutAsJsonAsync("/api/v1/reception/rides/landline-test",Order("landline-test","0000","أرضي")));
            Assert.Equal("0000",landline["passengerPhone"]!.GetValue<string>()); Assert.Null(landline["customerId"]); Assert.Null(landline["driverId"]); Assert.Equal(1,landline["orderNumber"]!.GetValue<int>()); Assert.Equal("",landline["addressText"]!.GetValue<string>());
            var day = landline["orderDay"]!.GetValue<string>();
            for(var i=0;i<51;i++) {
                var id = "report-"+i; var row = Order(id,"0597654321","زبون التقرير"); row["driverId"]=driver["id"]!.DeepClone(); row["notes"]="تفاصيل محفوظة";
                if(i==1){row["customerId"]=customer["id"]!.DeepClone();row["passengerPhone"]="";}
                if(i==2)row["passengerPhone"]="00970 59-7654321";
                var saved = await Read(await client.PutAsJsonAsync("/api/v1/reception/rides/"+id,row)); Assert.Equal(i+2,saved["orderNumber"]!.GetValue<int>());
            }
            Assert.Single((await Read(await client.GetAsync("/api/v1/reception/reports/drivers?search="+Uri.EscapeDataString("تقرير")))).AsArray());
            Assert.Single((await Read(await client.GetAsync("/api/v1/reception/reports/drivers?search=0097059123"))).AsArray());
            Assert.Empty((await Read(await client.GetAsync("/api/v1/reception/reports/drivers?page=2"))).AsArray());
            foreach(var search in new[]{"059765","00970 59-765","زبون"}) Assert.Single((await Read(await client.GetAsync("/api/v1/customers?limit=50&search="+Uri.EscapeDataString(search)))).AsArray());
            Assert.Empty((await Read(await client.GetAsync("/api/v1/customers?limit=50&page=2"))).AsArray());
            foreach(var filter in new[]{"driverId="+driver["id"],"customerId="+customer["id"]}) {
                var url="/api/v1/reception/reports/history?"+filter;
                var report=await Read(await client.GetAsync(url+"&from="+day+"&to="+day));
                Assert.Equal(51,report["total"]!.GetValue<int>()); Assert.Equal(50,report["items"]!.AsArray().Count);
                Assert.Equal("تفاصيل محفوظة",report["items"]![0]!["notes"]!.GetValue<string>());
                Assert.Equal(52,report["items"]![0]!["orderNumber"]!.GetValue<int>());
                Assert.Equal(2,(await Read(await client.GetAsync(url+"&sort=oldest")))["items"]![0]!["orderNumber"]!.GetValue<int>());
                Assert.Single((await Read(await client.GetAsync(url+"&page=2")))["items"]!.AsArray());
                Assert.Equal(0,(await Read(await client.GetAsync(url+"&to=2000-01-01")))["total"]!.GetValue<int>());
                Assert.Equal(HttpStatusCode.BadRequest,(await client.GetAsync(url+"&from=2026-10-01&to=2026-01-01")).StatusCode);
            }
            Assert.Single((await Read(await client.GetAsync("/api/v1/customers"))).AsArray());
            using (var scope = factory.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Where(t=>t.Slug=="reports").Select(t=>t.Id).SingleAsync();
                var order=await db.Set<ReceptionOrder>().SingleAsync(o=>o.ExternalId=="report-0");order.EventId="linked-call";
                foreach(var eventId in new[]{"linked-call","standalone-call"}) db.Add(new ReceptionCall { EventId=eventId,Payload=new JsonObject { ["eventId"]=eventId,["phone"]="+970597654321",["source"]="LANDLINE_ICALL",["timestamp"]="2026-01-01T22:30:00Z",["notes"]="اتصال محفوظ" }.ToJsonString() });
                await db.SaveChangesAsync();
            }
            var customerUrl="/api/v1/reception/reports/history?customerId="+customer["id"];
            Assert.Equal(52,(await Read(await client.GetAsync(customerUrl)))["total"]!.GetValue<int>());
            var callReport=await Read(await client.GetAsync(customerUrl+"&from=2026-01-02&to=2026-01-02"));
            Assert.Equal(1,callReport["total"]!.GetValue<int>());Assert.Equal("CALL",callReport["items"]![0]!["recordType"]!.GetValue<string>());
            Assert.Equal("اتصال محفوظ",callReport["items"]![0]!["notes"]!.GetValue<string>());
            var normal=Order("normal-address","0590000000","طلب بعنوان");normal["pickup"]!["name"]="عنوان اختبار";
            Assert.Equal("عنوان اختبار",(await Read(await client.PutAsJsonAsync("/api/v1/reception/rides/normal-address",normal)))["addressText"]!.GetValue<string>());
            var empty=Order("normal-empty","0590000000","طلب بدون عنوان");empty["driverId"]=driver["id"]!.DeepClone();empty["status"]="assigned";
            var sent=await Read(await client.PutAsJsonAsync("/api/v1/reception/rides/normal-empty",empty));Assert.Equal("",sent["addressText"]!.GetValue<string>());Assert.Equal("SENT",sent["dispatchStatus"]!.GetValue<string>());
            await Read(await client.PostAsJsonAsync("/api/v1/ride-requests",new {source="MANUAL",pickup=""}));
        } finally {
            NpgsqlConnection.ClearAllPools(); await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin); await drop.ExecuteNonQueryAsync();
        }
    }
}
