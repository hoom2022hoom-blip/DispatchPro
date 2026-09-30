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
public sealed class OfficeAdministrationTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response) { var text=await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {text}"); return string.IsNullOrEmpty(text)?new JsonObject():JsonNode.Parse(text)!; }
    [PostgresFact]
    public async Task AdministrationIsolationPermissionsReportsAndNotifications()
    {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();var name="taxi_admin_test_"+Guid.NewGuid().ToString("N");
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
            Guid driverId=Guid.NewGuid(),customerId=Guid.NewGuid();
            using(var scope=factory.Services.CreateScope()){
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();
                foreach(var slug in new[]{"admin-stage","other-stage"})await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]=slug,["Seed:AdminPassword"]="Stage-password-123!"}).Build());
                tenant.TenantId=await db.Set<Tenant>().Where(t=>t.Slug=="admin-stage").Select(t=>t.Id).SingleAsync();
                db.Add(new Customer{Id=customerId,FullName="زبون",Phone="+970591234567"});
                for(var i=0;i<51;i++){var request=new RideRequest{CustomerId=customerId};db.Add(request);db.Add(new ReceptionOrder{RideRequestId=request.Id,ExternalId="admin-report-"+i,Day=i==50?"2026-01-03":"2026-01-02",Number=i+1,Payload=new JsonObject{["id"]="admin-report-"+i,["createdAt"]="2026-01-02T10:00:00Z",["orderNumber"]=i+1,["passengerName"]="تقرير اختبار",["passengerPhone"]="0591234567",["customerId"]=customerId.ToString(),["driverId"]=driverId.ToString(),["status"]=i%2==0?"completed":"pending",["source"]="MANUAL",["notes"]="تفاصيل"}.ToJsonString()});}
                await db.SaveChangesAsync();
            }
            using var client=factory.CreateClient();
            async Task Login(string slug,string username="admin"){var a=await Read(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant=slug,username,password="Stage-password-123!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",a["accessToken"]!.GetValue<string>());}
            await Login("admin-stage");var access=await Read(await client.GetAsync("/api/v1/administration/access"));var actor=access["actorId"]!.GetValue<string>();
            var roles=(await Read(await client.GetAsync("/api/v1/administration/roles")))["roles"]!.AsArray();var adminRole=roles.Single(r=>r!["name"]!.GetValue<string>()=="Administrator")!["id"]!.GetValue<string>();
            var role=await Read(await client.PostAsJsonAsync("/api/v1/roles",new{name="Limited"}));var roleId=role["id"]!.GetValue<string>();
            await Read(await client.PutAsJsonAsync("/api/v1/administration/roles/"+roleId,new{name="Limited",codes=new[]{"rides.read"}}));
            var user=await Read(await client.PostAsJsonAsync("/api/v1/users",new{username="report-user",password="Stage-password-123!",roleId}));var userId=user["id"]!.GetValue<string>();
            var users=await Read(await client.GetAsync("/api/v1/administration/users?search=report-"));Assert.Equal(1,users["total"]!.GetValue<int>());Assert.Null(users["items"]![0]!["passwordHash"]);
            Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync("/api/v1/administration/users/"+actor,new{roleId=adminRole,active=false})).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync("/api/v1/administration/roles/"+adminRole,new{name="Administrator",codes=Array.Empty<string>()})).StatusCode);
            var office=(await Read(await client.GetAsync("/api/v1/offices"))).AsArray()[0]!;office["name"]="مكتب محدّث";await Read(await client.PutAsJsonAsync("/api/v1/offices/"+office["id"],office));
            Assert.NotEmpty((await Read(await client.GetAsync("/api/v1/administration/notifications"))).AsArray());
            const string report="/api/v1/reception/reports/history?kind=orders";
            var all=await Read(await client.GetAsync(report));Assert.Equal(51,all["total"]!.GetValue<int>());Assert.Equal(50,all["items"]!.AsArray().Count);Assert.Equal(51,all["summary"]!["sources"]![0]!["count"]!.GetValue<int>());
            Assert.Single((await Read(await client.GetAsync(report+"&page=2")))["items"]!.AsArray());
            Assert.Equal(25,(await Read(await client.GetAsync(report+"&from=2026-01-02&to=2026-01-02&status=completed&source=MANUAL&search=059123")))["total"]!.GetValue<int>());
            Assert.Equal(0,(await Read(await client.GetAsync(report+"&search=missing")))["total"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.BadRequest,(await client.GetAsync(report+"&from=2026-02-01&to=2026-01-01")).StatusCode);
            foreach(var filter in new[]{"driverId="+driverId,"customerId="+customerId})Assert.Equal(50,(await Read(await client.GetAsync("/api/v1/reception/reports/history?"+filter+"&from=2026-01-02&to=2026-01-02")))["total"]!.GetValue<int>());
            await Login("other-stage");Assert.Equal(0,(await Read(await client.GetAsync(report)))["total"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.NotFound,(await client.PutAsJsonAsync("/api/v1/administration/users/"+userId,new{roleId,active=false})).StatusCode);
            await Login("admin-stage","report-user");Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/v1/administration/users")).StatusCode);Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/v1/administration/notifications")).StatusCode);
            await Login("admin-stage");await Read(await client.PutAsJsonAsync("/api/v1/administration/users/"+userId,new{roleId,active=false}));
            Assert.Equal(HttpStatusCode.Unauthorized,(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="admin-stage",username="report-user",password="Stage-password-123!"})).StatusCode);
        } finally {NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
