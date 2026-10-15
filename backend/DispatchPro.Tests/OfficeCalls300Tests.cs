using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;

public sealed class OfficeCalls300Tests
{
    [Theory]
    [InlineData("+972 59 123 4567", "+972591234567")]
    [InlineData("+972   59   123 4567", "+972591234567")]
    [InlineData("+972\u00a059\u202f123\u200b4567", "+972591234567")]
    [InlineData("\u200f+970 (59)-123-4567\u200e", "+970591234567")]
    [InlineData("00972 59 123 4567", "+972591234567")]
    [InlineData("00970 59 123 4567", "+970591234567")]
    [InlineData("059 123 4567", "0591234567")]
    [InlineData("+972 56 123 4567", "+972561234567")]
    [InlineData("+٩٧٢ ٥٩ ١٢٣ ٤٥٦٧", "+972591234567")]
    [InlineData("+۹۷۰ ۵۹ ۱۲۳ ۴۵۶۷", "+970591234567")]
    [InlineData("+९७२ ५९ १२३ ४५६७", "+972591234567")]
    [InlineData("+1 591234567", "+1591234567")]
    [InlineData("+972 0591234567", "+9720591234567")]
    [InlineData("05912345678", "05912345678")]
    [InlineData("0591234567 0561234567", "")]
    [InlineData("contact 0591234567", "")]
    public void CanonicalCandidateNormalization(string input, string expected) => Assert.Equal(expected, OfficePhoneNormalizer.Normalize(input));
    private static async Task<JsonObject> Body(HttpResponseMessage response) {
        var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
        return JsonNode.Parse(body)!.AsObject();
    }
    [PostgresFact]
    public async Task RealDatabasePairingSecurityReplayIndependentDeliveryAndReceptionCompatibility()
    {
        var database = "officecalls_test_" + Guid.NewGuid().ToString("N");
        var adminConnection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var adminDb = new NpgsqlConnection(adminConnection); await adminDb.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {database}", adminDb)) await create.ExecuteNonQueryAsync();
        try {
            var connection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = database }.ConnectionString;
            await using var factory = new ApiFactory(connection);
            using (var scope = factory.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); await db.Database.MigrateAsync(); await db.Database.MigrateAsync();
                Assert.Empty(await db.Database.GetPendingMigrationsAsync());
                foreach (var slug in new[] { "calls-a", "calls-b" }) await Seed.RunAsync(db, scope.ServiceProvider.GetRequiredService<TenantContext>(), new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "OfficeCalls-test-password!" }).Build());
            }
            using var a = factory.CreateClient(); using var b = factory.CreateClient(); using var phone = factory.CreateClient(); using var windows = factory.CreateClient(); using var anonymous = factory.CreateClient();
            foreach (var pair in new[] { (a, "calls-a"), (b, "calls-b") }) {
                var login = await Body(await pair.Item1.PostAsJsonAsync("/api/v1/auth/login", new { tenant = pair.Item2, username = "admin", password = "OfficeCalls-test-password!" }));
                pair.Item1.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login["accessToken"]!.GetValue<string>());
            }
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/v1/officecalls/admin/pairings?kind=ANDROID", null)).StatusCode);
            using var rsa = RSA.Create(2048);
            async Task<JsonObject> Pair(HttpClient client, string kind, string name, string? publicKey = null) {
                var pair = await Body(await a.PostAsync("/api/v1/officecalls/admin/pairings?kind=" + kind, null));
                var qr = new Uri(pair["qr"]!.GetValue<string>());
                var secret = qr.Query.Split("secret=")[1]; var sessionId = pair["sessionId"]!.GetValue<string>();
                var input = new { sessionId, secret, name, publicKey };
                var result = await Body(await anonymous.PostAsJsonAsync("/api/v1/officecalls/pair/complete", input));
                Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/officecalls/pair/complete", input)).StatusCode);
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", result["token"]!.GetValue<string>());
                Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/officecalls/health")).StatusCode);
                Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync($"/api/v1/officecalls/admin/devices/{result["deviceId"]}/approve", null)).StatusCode);
                Assert.Equal(HttpStatusCode.OK, (await a.PostAsync($"/api/v1/officecalls/admin/devices/{result["deviceId"]}/approve", null)).StatusCode);
                return result;
            }
            var p = await Pair(phone, "ANDROID", "TECNO simulation", Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo()));
            await Pair(windows, "WINDOWS", "Office Agent simulation");
            var otherPair = await Body(await a.PostAsync("/api/v1/officecalls/admin/pairings?kind=WINDOWS", null));
            var otherResult = await Body(await anonymous.PostAsJsonAsync("/api/v1/officecalls/pair/complete", new { sessionId = otherPair["sessionId"]!.GetValue<string>(), secret = new Uri(otherPair["qr"]!.GetValue<string>()).Query.Split("secret=")[1], name = "Second office agent" }));
            Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsync($"/api/v1/officecalls/admin/devices/{otherResult["deviceId"]}/approve", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await windows.PostAsJsonAsync("/api/v1/officecalls/agent/ingest", new { deviceId = p["deviceId"]!.GetValue<string>(), payload = (string?)null, signature = (string?)null })).StatusCode);
            var health = await Body(await phone.GetAsync("/api/v1/officecalls/health")); Assert.Equal(p["officeId"]!.ToString(), health["officeId"]!.ToString());
            var call = new { eventId = Guid.NewGuid().ToString(), phone = "+972\u200b59\u00a0123 4567", sourcePackage = "com.whatsapp.w4b", timestamp = DateTimeOffset.UtcNow };
            foreach (var invalid in new[] {
                (new OfficeEventInput("invalid/id", "0591234567", "com.whatsapp.w4b", DateTimeOffset.UtcNow), "EVENT_ID_INVALID"),
                (new OfficeEventInput(Guid.NewGuid().ToString(), "+12", "com.whatsapp.w4b", DateTimeOffset.UtcNow), "PHONE_INVALID"),
                (new OfficeEventInput(Guid.NewGuid().ToString(), "0591234567", "other.app", DateTimeOffset.UtcNow), "SOURCE_PACKAGE_INVALID"),
                (new OfficeEventInput(Guid.NewGuid().ToString(), "0591234567", "com.whatsapp.w4b", DateTimeOffset.UtcNow.AddDays(-2)), "EVENT_TOO_OLD"),
                (new OfficeEventInput(Guid.NewGuid().ToString(), "0591234567", "com.whatsapp.w4b", DateTimeOffset.UtcNow.AddMinutes(10)), "EVENT_TIMESTAMP_FUTURE") }) {
                var rejected = await phone.PostAsJsonAsync("/api/v1/officecalls/events", invalid.Item1);
                Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
                Assert.Equal(invalid.Item2, JsonNode.Parse(await rejected.Content.ReadAsStringAsync())!["code"]!.GetValue<string>());
            }
            var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => phone.PostAsJsonAsync("/api/v1/officecalls/events", call)));
            foreach (var response in responses) Assert.True((await Body(response))["serverAcknowledged"]!.GetValue<bool>());
            Assert.Equal(HttpStatusCode.Conflict, (await phone.PostAsJsonAsync("/api/v1/officecalls/events", new { call.eventId, phone = "0561234567", call.sourcePackage, call.timestamp })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await phone.PostAsJsonAsync("/api/v1/officecalls/events", new { eventId = Guid.NewGuid().ToString(), phone = "+12", call.sourcePackage, call.timestamp })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await windows.PostAsJsonAsync("/api/v1/officecalls/events", call)).StatusCode);
            // WhatsApp reception feature is disabled: GRID consumer still sees this accepted event.
            var grid = JsonNode.Parse(await windows.GetStringAsync("/api/v1/officecalls/agent/events"))!.AsArray(); Assert.Single(grid); Assert.Equal("+972591234567", grid[0]!["phone"]!.GetValue<string>());
            await Body(await windows.PostAsJsonAsync($"/api/v1/officecalls/agent/events/{call.eventId}/ack", new { status = "RECEIVER_ACK" }));
            var firstStatus = await Body(await phone.GetAsync("/api/v1/officecalls/events/" + call.eventId)); Assert.Equal("RECEIVER_ACK", firstStatus["gridCms"]!.GetValue<string>()); Assert.False(firstStatus["gridVisibleConfirmed"]!.GetValue<bool>());
            Assert.Equal(HttpStatusCode.OK, (await a.PutAsync("/api/v1/features/WhatsApp?enabled=true", null)).StatusCode);
            JsonObject status = firstStatus;
            for (var i = 0; i < 30 && status["dispatchPro"]!.GetValue<string>() != "DELIVERED"; i++) { await Task.Delay(200); status = await Body(await phone.GetAsync("/api/v1/officecalls/events/" + call.eventId)); }
            Assert.Equal("DELIVERED", status["dispatchPro"]!.GetValue<string>());
            var reception = await Body(await a.GetAsync("/api/v1/reception/snapshot")); Assert.Single(reception["rides"]!.AsArray()); Assert.Equal("0591234567", reception["rides"]![0]!["passengerPhone"]!.GetValue<string>());
            var old = new { eventId = Guid.NewGuid().ToString(), phone = "0591234567", call.sourcePackage, timestamp = DateTimeOffset.UtcNow.AddHours(-1) };
            Assert.Equal("EXPIRED", (await Body(await phone.PostAsJsonAsync("/api/v1/officecalls/events", old)))["dispatchPro"]!.GetValue<string>());
            var second = new { eventId = Guid.NewGuid().ToString(), phone = "0591234567", call.sourcePackage, timestamp = DateTimeOffset.UtcNow };
            await Body(await phone.PostAsJsonAsync("/api/v1/officecalls/events", second));
            for (var i = 0; i < 30; i++) { reception = await Body(await a.GetAsync("/api/v1/reception/snapshot")); if (reception["rides"]!.AsArray().Count == 2) break; await Task.Delay(200); }
            Assert.Equal(2, reception["rides"]!.AsArray().Count);
            // Signed local and cloud events keep the same ID and phone identity.
            var payload = System.Text.Json.JsonSerializer.Serialize(second);
            var envelope = new { deviceId = p["deviceId"]!.GetValue<string>(), payload, signature = Convert.ToBase64String(rsa.SignData(Encoding.UTF8.GetBytes(payload), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) };
            await Body(await windows.PostAsJsonAsync("/api/v1/officecalls/agent/ingest", envelope));
            Assert.Equal(HttpStatusCode.Unauthorized, (await windows.PostAsJsonAsync("/api/v1/officecalls/agent/ingest", new { envelope.deviceId, envelope.payload, signature = Convert.ToBase64String(new byte[256]) })).StatusCode);
            Assert.Empty((await Body(await b.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray());
            await a.DeleteAsync($"/api/v1/officecalls/admin/devices/{p["deviceId"]}");
            Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/api/v1/officecalls/health")).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await windows.PostAsJsonAsync("/api/v1/officecalls/agent/ingest", envelope)).StatusCode);
        } finally {
            NpgsqlConnection.ClearAllPools(); await using var drop = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", adminDb); await drop.ExecuteNonQueryAsync();
        }
    }
}
