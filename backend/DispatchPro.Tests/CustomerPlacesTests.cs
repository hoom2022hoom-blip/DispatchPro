using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;
public sealed class CustomerPlacesTests
{
    private static async Task<JsonObject> Body(HttpResponseMessage response) { var text = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {text}"); return JsonNode.Parse(text)!.AsObject(); }
    [Theory]
    [InlineData("MANUAL_TEXT")][InlineData("CUSTOMER_GPS")][InlineData("WHATSAPP_LOCATION")][InlineData("MAP_PIN")][InlineData("ADDRESS_SEARCH")][InlineData("SAVED_ADDRESS")]
    public void GpsIsOptionalForEveryLocationSource(string source) => Locations.Validate(new("شارع القدس", LocationSource: source));
    [Fact]
    public void RejectsPartialAndInvalidCoordinates() {
        Assert.Throws<ArgumentException>(() => Locations.Validate(new("عنوان", Latitude: 32)));
        Assert.Throws<ArgumentException>(() => Locations.Validate(new("عنوان", Latitude: 91, Longitude: 35)));
        Locations.Validate(new("", Latitude: 32, Longitude: 35, LocationSource: "MAP_PIN"));
    }
    [PostgresFact]
    public async Task UpgradeSavedAddressesAndUnifiedRequestsAreTenantIsolated()
    {
        var connectionString = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var database = "taxi_test_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(connectionString); await admin.OpenAsync();
        await using (var command = new NpgsqlCommand($"CREATE DATABASE {database}", admin)) await command.ExecuteNonQueryAsync();
        var connection = new NpgsqlConnectionStringBuilder(connectionString) { Database = database }.ConnectionString;
        try {
            await using var factory = new ApiFactory(connection);
            Guid legacyId = Guid.NewGuid();
            using (var scope = factory.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
                await db.Database.MigrateAsync();
                var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
                foreach (var slug in new[] { "places-a", "places-b" }) await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "Places-test-password!" }).Build());
                // Seed with the current model, then exercise an actual upgrade from the legacy schema.
                await db.GetService<IMigrator>().MigrateAsync("20260926230216_ReceptionWriteReplay"); db.ChangeTracker.Clear();
                tenant.TenantId = (await db.Set<Tenant>().SingleAsync(t => t.Slug == "places-a")).Id;
                var payload = "{\"id\":\"legacy-order\",\"pickup\":{\"name\":\"old address\",\"coords\":{\"x\":0,\"y\":0}},\"source\":\"LANDLINE_ICALL\",\"passengerPhone\":\"0000\",\"totalFare\":0,\"status\":\"pending\",\"movingFee\":false,\"createdAt\":\"2026-09-27T12:00:00Z\",\"updatedAt\":\"2026-09-27T12:00:00Z\",\"orderDay\":\"2026-09-27\",\"orderNumber\":7,\"receptionVersion\":1}";
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"ReceptionOrder\" (\"Id\",\"TenantId\",\"ExternalId\",\"Day\",\"Number\",\"Payload\",\"Version\",\"LastWriteHash\") VALUES ({legacyId},{tenant.TenantId},{"legacy-order"},{"2026-09-27"},{7},CAST({payload} AS jsonb),{1},{""})");
                var oldCustomerId = Guid.NewGuid();
                // This database is deliberately downgraded to a schema without Customer.CreatedAt.
                // Insert the legacy row directly instead of using the current EF model.
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Customer\" (\"Id\",\"TenantId\",\"FullName\",\"Phone\") VALUES ({oldCustomerId},{tenant.TenantId},{"Existing customer"},{"+970591111111"})");
                var oldRequestId = Guid.NewGuid(); var oldRideId = Guid.NewGuid();
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"RideRequest\" (\"Id\",\"TenantId\",\"CustomerId\",\"Pickup\",\"Destination\",\"Notes\",\"Source\",\"CreatedAt\") VALUES ({oldRequestId},{tenant.TenantId},{oldCustomerId},{"Existing API address"},{""},{"preserved"},{"MANUAL"},{DateTimeOffset.UtcNow})");
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Ride\" (\"Id\",\"TenantId\",\"RideRequestId\",\"Status\",\"Version\") VALUES ({oldRideId},{tenant.TenantId},{oldRequestId},{0},{1})");
                await db.Database.MigrateAsync();
                var migrated = await db.Set<RideRequest>().SingleAsync(r => r.Id == legacyId); Assert.Equal("LANDLINE", migrated.Source); Assert.Equal("old address", migrated.AddressText); Assert.Null(migrated.CustomerId);
                var upgraded = await db.Set<ReceptionOrder>().SingleAsync(o => o.Id == legacyId); Assert.Equal(7, upgraded.Number); Assert.Equal(legacyId, upgraded.RideRequestId);
                Assert.True(await db.Set<ReceptionOrder>().AnyAsync(o => o.RideRequestId == oldRequestId && o.ExternalId == oldRideId.ToString()));
            }
            using var a = factory.CreateClient(); using var b = factory.CreateClient();
            foreach (var (client, slug) in new[] { (a, "places-a"), (b, "places-b") }) { var auth = await Body(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant = slug, username = "admin", password = "Places-test-password!" })); client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth["accessToken"]!.GetValue<string>()); }
            var customer = await Body(await a.PostAsJsonAsync("/api/v1/customers", new { fullName = "زبون تجريبي", phone = "0591234500", secondaryPhone = "0561234500", notes = "ملاحظة العميل", isActive = true })); var customerId = customer["id"]!.GetValue<string>();
            Assert.Equal("0561234500", customer["secondaryPhone"]!.GetValue<string>()); Assert.Equal("ملاحظة العميل", customer["notes"]!.GetValue<string>()); Assert.True(customer["isActive"]!.GetValue<bool>()); Assert.NotNull(customer["createdAt"]);
            Assert.Single(JsonNode.Parse(await (await a.GetAsync("/api/v1/customers?search=زبون تجريبي")).Content.ReadAsStringAsync())!.AsArray()); Assert.Single(JsonNode.Parse(await (await a.GetAsync("/api/v1/customers?search=0591234500")).Content.ReadAsStringAsync())!.AsArray());
            customer["fullName"] = "زبون معدل"; customer["isActive"] = false;
            var editedCustomer=await Body(await a.PutAsJsonAsync($"/api/v1/customers/{customerId}",customer)); Assert.Equal("زبون معدل",editedCustomer["fullName"]!.GetValue<string>()); Assert.False(editedCustomer["isActive"]!.GetValue<bool>());
            Assert.Equal(HttpStatusCode.NotFound,(await b.GetAsync($"/api/v1/customers/{customerId}")).StatusCode); Assert.Empty(JsonNode.Parse(await (await b.GetAsync("/api/v1/customers?search=زبون معدل")).Content.ReadAsStringAsync())!.AsArray());
            var homeInput = new { customerId, label = "HOME", icon = "HOME", addressText = "عنوان يدوي بلا GPS", neighborhood = "حي الجامعة", street = "شارع القدس", notes = "الطابق الثاني", isDefault = true };
            var home = await Body(await a.PostAsJsonAsync("/api/v1/saved-addresses", homeInput)); Assert.Null(home["latitude"]); Assert.Null(home["longitude"]);
            var homeId = home["id"]!.GetValue<string>();
            var work = await Body(await a.PostAsJsonAsync("/api/v1/saved-addresses", new { customerId, label = "مكتبي الخاص", icon = "WORK", addressText = "", latitude = 32.22, longitude = 35.25, isDefault = true }));
            Assert.False((await Body(await a.GetAsync($"/api/v1/saved-addresses/{homeId}")))["isDefault"]!.GetValue<bool>());
            var list = JsonNode.Parse(await (await a.GetAsync($"/api/v1/saved-addresses?customerId={customerId}")).Content.ReadAsStringAsync())!.AsArray(); Assert.Equal(2, list.Count);
            Assert.Equal(2, JsonNode.Parse(await (await a.GetAsync("/api/v1/saved-addresses?search=0591234500")).Content.ReadAsStringAsync())!.AsArray().Count);
            Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/v1/saved-addresses/{homeId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/v1/saved-addresses", homeInput)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsJsonAsync($"/api/v1/saved-addresses/{homeId}", home)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/v1/saved-addresses/{homeId}?version=1")).StatusCode);
            Assert.Empty(JsonNode.Parse(await (await b.GetAsync("/api/v1/saved-addresses")).Content.ReadAsStringAsync())!.AsArray());
            var workId = work["id"]!.GetValue<string>(); work["latitude"] = 32.23; work["longitude"] = 35.26;
            var moved = await Body(await a.PutAsJsonAsync($"/api/v1/saved-addresses/{workId}", work)); Assert.Equal(32.23, moved["latitude"]!.GetValue<double>());
            Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync($"/api/v1/saved-addresses/{workId}", work)).StatusCode);
            var ride = await Body(await a.PostAsJsonAsync("/api/v1/ride-requests", new { customerId, savedAddressId = workId, source = "CUSTOMER_APP" }));
            var requestId = ride["rideRequestId"]!.GetValue<string>();
            var rides = await Body(await a.GetAsync("/api/v1/reception/snapshot"));
            var reception = rides["rides"]!.AsArray().Single(r => r!["rideRequestId"]!.GetValue<string>() == requestId)!;
            Assert.Equal(32.23, reception["latitude"]!.GetValue<double>()); Assert.Equal("SAVED_ADDRESS", reception["locationSource"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/v1/ride-requests", new { savedAddressId = workId, source = "MANUAL" })).StatusCode);
            var manual = await Body(await a.PostAsJsonAsync("/api/v1/ride-requests", new { source = "MANUAL", location = new { addressText = "عنوان حر", neighborhood = "حي", street = "شارع", locationSource = "MANUAL_TEXT" } }));
            var manualRequestId = manual["rideRequestId"]!.GetValue<string>();
            var detail = await Body(await a.GetAsync("/api/v1/rides/" + manual["id"]!.GetValue<string>())); Assert.Null(detail["request"]!["latitude"]); Assert.Equal("عنوان حر", detail["request"]!["addressText"]!.GetValue<string>());
            await a.PutAsync("/api/v1/features/WhatsApp?enabled=true", null);
            var call = new ReceptionEvent("location-call", "WHATSAPP", "0591234500", "2026-09-27T12:00:00Z", Location: new("موقع واتساب", Latitude: 32.2, Longitude: 35.2, LocationSource: "WHATSAPP_LOCATION"));
            await Body(await a.PostAsJsonAsync("/api/v1/reception/calls", call)); await Body(await a.PostAsJsonAsync("/api/v1/reception/calls", call));
            rides = await Body(await a.GetAsync("/api/v1/reception/snapshot")); var callRow = rides["rides"]!.AsArray().Single(r => r!["callEventId"]?.GetValue<string>() == "location-call")!;
            Assert.Equal("WHATSAPP_LOCATION", callRow["locationSource"]!.GetValue<string>()); Assert.Equal(32.2, callRow["latitude"]!.GetValue<double>());
            Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync($"/api/v1/saved-addresses/{workId}?version={moved["version"]!.GetValue<long>()}")).StatusCode);
            detail = await Body(await a.GetAsync("/api/v1/rides/" + ride["id"]!.GetValue<string>())); Assert.Null(detail["request"]!["savedAddressId"]); Assert.Equal(32.23, detail["request"]!["latitude"]!.GetValue<double>());
            Assert.Equal(HttpStatusCode.NotFound, (await a.GetAsync($"/api/v1/saved-addresses/{workId}")).StatusCode);
            using var verifyScope = factory.Services.CreateScope(); var verifyDb = verifyScope.ServiceProvider.GetRequiredService<TaxiDb>(); var context = verifyScope.ServiceProvider.GetRequiredService<TenantContext>(); context.TenantId = (await verifyDb.Set<Tenant>().SingleAsync(t => t.Slug == "places-a")).Id;
            Assert.Equal(await verifyDb.Set<RideRequest>().CountAsync(), await verifyDb.Set<ReceptionOrder>().CountAsync());
            Assert.Equal(await verifyDb.Set<RideRequest>().CountAsync(), await verifyDb.Set<Ride>().CountAsync());
        } finally { NpgsqlConnection.ClearAllPools(); await using var drop = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", admin); await drop.ExecuteNonQueryAsync(); }
    }
}
