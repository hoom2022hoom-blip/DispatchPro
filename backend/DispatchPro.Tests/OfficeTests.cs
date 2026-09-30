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
public sealed class OfficeTests
{
    private static async Task<JsonObject> Body(HttpResponseMessage response) { var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {text}"); return JsonNode.Parse(text)!.AsObject(); }
    [PostgresFact]
    public async Task DispatcherFleetCrudQueueAndCrossOfficeIsolation()
    {
        await using var admin = new NpgsqlConnection(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")); await admin.OpenAsync();
        var name = "taxi_test_" + Guid.NewGuid().ToString("N"); await using (var c = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await c.ExecuteNonQueryAsync();
        try {
            await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")) { Database = name }.ConnectionString);
            using (var scope = factory.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>(); await db.Database.MigrateAsync();
                foreach (var slug in new[] { "fleet-a", "fleet-b" }) {
                    await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "Fleet-admin-password!" }).Build());
                    var role = await db.Set<Role>().SingleAsync(r => r.Name == "Dispatcher"); var user = new User { Username = "dispatcher", RoleId = role.Id }; user.PasswordHash = new PasswordHasher<User>().HashPassword(user, "Fleet-dispatcher-password!"); db.Add(user); await db.SaveChangesAsync();
                }
            }
            using var a = factory.CreateClient(); using var b = factory.CreateClient();
            foreach (var (client,slug) in new[] {(a,"fleet-a"),(b,"fleet-b")}) {var auth = await Body(await client.PostAsJsonAsync("/api/v1/auth/login",new {tenant=slug,username="dispatcher",password="Fleet-dispatcher-password!"}));client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",auth["accessToken"]!.GetValue<string>());}
            using var anonymous = factory.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/v1/office")).StatusCode);
            var driver = await Body(await a.PostAsJsonAsync("/api/v1/office/drivers",new { fullName="Test Driver",phone="0591234567",active=true,status="Available" })); var id=driver["id"]!.GetValue<string>(); Assert.Equal("0591234567",driver["phone"]!.GetValue<string>());
            var dashboard = await Body(await a.GetAsync("/api/v1/office")); Assert.Single(dashboard["drivers"]!.AsArray()); Assert.Empty((await Body(await b.GetAsync("/api/v1/office")))["drivers"]!.AsArray());
            Assert.Equal(HttpStatusCode.NotFound,(await b.PutAsJsonAsync("/api/v1/office/drivers/"+id,driver)).StatusCode);
            var vehicleInput = new JsonObject { ["plate"]="TEST-123",["driverId"]=id,["vehicleClassId"]=dashboard["classes"]![0]!["id"]!.DeepClone(),["make"]="Toyota",["model"]="Corolla",["color"]="White",["year"]=2024,["active"]=true,["status"]="ACTIVE" };
            Assert.Equal(HttpStatusCode.NotFound,(await b.PostAsJsonAsync("/api/v1/office/vehicles",vehicleInput)).StatusCode);
            var vehicle = await Body(await a.PostAsJsonAsync("/api/v1/office/vehicles",vehicleInput));var vehicleId=vehicle["id"]!.GetValue<string>();Assert.Equal(2024,vehicle["year"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.Conflict,(await a.PostAsJsonAsync("/api/v1/office/vehicles",vehicleInput)).StatusCode);
            vehicle["color"]="Black";await Body(await a.PutAsJsonAsync("/api/v1/office/vehicles/"+vehicleId,vehicle));
            Assert.Equal(HttpStatusCode.NotFound,(await b.PutAsJsonAsync("/api/v1/office/vehicles/"+vehicleId,vehicle)).StatusCode);
            for(var i=0;i<2;i++) Assert.Equal(HttpStatusCode.OK,(await a.PostAsJsonAsync($"/api/v1/office/drivers/{id}/queue",new {vehicleId})).StatusCode);
            dashboard = await Body(await a.GetAsync("/api/v1/office"));Assert.Single(dashboard["reception"]!["queue"]!.AsArray());
            driver["active"]=false;Assert.Equal(HttpStatusCode.Conflict,(await a.PutAsJsonAsync("/api/v1/office/drivers/"+id,driver)).StatusCode);
            vehicle["active"]=false;Assert.Equal(HttpStatusCode.Conflict,(await a.PutAsJsonAsync("/api/v1/office/vehicles/"+vehicleId,vehicle)).StatusCode);
            var shift=dashboard["reception"]!["shifts"]![0]!["id"]!.GetValue<string>();Assert.Equal(HttpStatusCode.NoContent,(await a.PostAsync($"/api/v1/reception/shifts/{shift}/end",null)).StatusCode);
            await Body(await a.PutAsJsonAsync("/api/v1/office/drivers/"+id,driver)); await Body(await a.PutAsJsonAsync("/api/v1/office/vehicles/"+vehicleId,vehicle));
            Assert.Equal(HttpStatusCode.BadRequest,(await a.PostAsJsonAsync($"/api/v1/office/drivers/{id}/queue",new {vehicleId})).StatusCode);
            driver["active"]=true;driver["fullName"]="Edited Driver";driver["status"]="Available";await Body(await a.PutAsJsonAsync("/api/v1/office/drivers/"+id,driver));vehicle["active"]=true;await Body(await a.PutAsJsonAsync("/api/v1/office/vehicles/"+vehicleId,vehicle));
            Assert.Equal("Edited Driver",(await Body(await a.GetAsync("/api/v1/office")))["drivers"]![0]!["fullName"]!.GetValue<string>());
        } finally { NpgsqlConnection.ClearAllPools(); await using var drop = new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)", admin); await drop.ExecuteNonQueryAsync(); }
    }
}
