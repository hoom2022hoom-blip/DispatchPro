using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;
public sealed class ReceptionTests
{
    private static async Task<JsonObject> Body(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
        return JsonNode.Parse(body)!.AsObject();
    }
    [Theory]
    [InlineData("2026-09-24T20:59:59Z", "2026-09-24")]
    [InlineData("2026-09-24T21:00:00Z", "2026-09-25")]
    [InlineData("2026-01-24T22:00:00Z", "2026-01-25")]
    public void ReceptionDayMatchesLegacy(string time, string day) => Assert.Equal(day, ReceptionService.Day(DateTimeOffset.Parse(time)));

    [PostgresFact]
    public async Task ReceptionTransactionsAndLiveWorkerBridge()
    {
        var adminConnection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var database = "taxi_test_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(adminConnection); await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {database}", admin)) await create.ExecuteNonQueryAsync();
        var connection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = database }.ConnectionString;
        try
        {
            await using var factory = new ApiFactory(connection);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); await db.Database.MigrateAsync();
                foreach (var slug in new[] { "reception-a", "reception-b" }) await Seed.RunAsync(db, scope.ServiceProvider.GetRequiredService<TenantContext>(), new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "Reception-test-password!" }).Build());
            }
            using var a = factory.CreateClient(); using var b = factory.CreateClient();
            foreach (var pair in new[] { (a, "reception-a"), (b, "reception-b") })
            {
                var login = await Body(await pair.Item1.PostAsJsonAsync("/api/v1/auth/login", new { tenant = pair.Item2, username = "admin", password = "Reception-test-password!" }));
                pair.Item1.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login["accessToken"]!.GetValue<string>());
                Assert.Equal(HttpStatusCode.OK, (await pair.Item1.PutAsync("/api/v1/features/CallerId?enabled=true", null)).StatusCode);
                Assert.Equal(HttpStatusCode.OK, (await pair.Item1.PutAsync("/api/v1/features/WhatsApp?enabled=true", null)).StatusCode);
            }
            var call = new ReceptionEvent("same-event", "LANDLINE_ICALL", "0000", "2026-09-27T12:00:00Z", "line1");
            var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => a.PostAsJsonAsync("/api/v1/reception/calls", call)));
            foreach (var result in results) Assert.Equal(HttpStatusCode.OK, result.StatusCode);
            var snapshot = await Body(await a.GetAsync("/api/v1/reception/snapshot"));
            Assert.Single(snapshot["rides"]!.AsArray());
            var ride = snapshot["rides"]![0]!.AsObject().DeepClone().AsObject(); var id = ride["id"]!.GetValue<string>();
            Assert.True(ride["receptionPending"]!.GetValue<bool>()); Assert.Equal(1, ride["orderNumber"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/v1/reception/calls", call with { Phone = "0591234567" })).StatusCode);
            await Body(await b.PostAsJsonAsync("/api/v1/reception/calls", call));
            var foreign = await Body(await b.GetAsync("/api/v1/reception/snapshot")); Assert.Equal(1, foreign["rides"]![0]!["orderNumber"]!.GetValue<int>());
            ride["pickup"]!["name"] = "عنوان محفوظ"; ride["passengerName"] = "زبون المكتب"; ride["receptionPending"] = false; ride["status"] = "waiting";
            var edited = await Body(await a.PutAsJsonAsync($"/api/v1/reception/rides/{id}", ride));
            Assert.Equal(edited.ToJsonString(), (await Body(await a.PutAsJsonAsync($"/api/v1/reception/rides/{id}", ride))).ToJsonString());
            ride["notes"] = "stale overwrite";
            Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync($"/api/v1/reception/rides/{id}", ride)).StatusCode);
            await Body(await a.PostAsJsonAsync("/api/v1/reception/calls", call));
            Assert.Equal("زبون المكتب", (await Body(await a.GetAsync("/api/v1/reception/snapshot")))["rides"]![0]!["passengerName"]!.GetValue<string>());
            Assert.Equal("", (await Body(await b.GetAsync("/api/v1/reception/snapshot")))["rides"]![0]!["passengerName"]!.GetValue<string>());
            var calls = await Task.WhenAll(Enumerable.Range(0, 8).Select(i => a.PostAsJsonAsync("/api/v1/reception/calls", call with { EventId = "batch-" + i })));
            foreach (var result in calls) Assert.Equal(HttpStatusCode.OK, result.StatusCode);
            snapshot = await Body(await a.GetAsync("/api/v1/reception/snapshot"));
            Assert.Equal(Enumerable.Range(1, 9), snapshot["rides"]!.AsArray().Select(r => r!["orderNumber"]!.GetValue<int>()).Order());
            var roles = JsonNode.Parse(await (await a.GetAsync("/api/v1/roles")).Content.ReadAsStringAsync())!.AsArray();
            var role = roles.Single(r => r!["name"]!.GetValue<string>() == "Driver")!["id"]!.GetValue<string>();
            var driverUser = await Body(await a.PostAsJsonAsync("/api/v1/users", new { username = "driver", password = "Driver-reception-test!", roleId = role }));
            var driver = await Body(await a.PostAsJsonAsync("/api/v1/drivers", new { userId = driverUser["id"]!.GetValue<string>(), fullName = "Driver", status = "Available" }));
            var classes = JsonNode.Parse(await (await a.GetAsync("/api/v1/vehicle-classes")).Content.ReadAsStringAsync())!.AsArray();
            var vehicle = await Body(await a.PostAsJsonAsync("/api/v1/vehicles", new { driverId = driver["id"]!.GetValue<string>(), vehicleClassId = classes[0]!["id"]!.GetValue<string>(), plate = "TEST-1" }));
            Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsJsonAsync("/api/v1/reception/shifts", new { driverId = driver["id"]!.GetValue<string>(), vehicleId = vehicle["id"]!.GetValue<string>() })).StatusCode);
            snapshot = await Body(await a.GetAsync("/api/v1/reception/snapshot")); var shift = snapshot["shifts"]![0]!["id"]!.GetValue<string>();
            Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsJsonAsync("/api/v1/reception/queue", new { type = "add", shiftId = shift })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await b.PostAsJsonAsync("/api/v1/reception/queue", new { type = "add", shiftId = shift })).StatusCode);
            edited["status"] = "assigned"; edited["driverId"] = driver["id"]!.DeepClone(); edited["shiftId"] = shift;
            edited = await Body(await a.PutAsJsonAsync($"/api/v1/reception/rides/{id}", edited));
            snapshot = await Body(await a.GetAsync("/api/v1/reception/snapshot")); Assert.Single(snapshot["queue"]!.AsArray());
            Assert.Equal("BUSY", snapshot["queue"]![0]!["status"]!.GetValue<string>()); // Assignment preserves the queue until an explicit office action.
            Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/v1/reception/shifts/" + shift + "/end", new { })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync("/api/v1/reception/queue", new { type = "add", shiftId = shift })).StatusCode);
            var pending = snapshot["rides"]!.AsArray()[1]!.DeepClone().AsObject();
            pending["status"] = "assigned"; pending["driverId"] = driver["id"]!.DeepClone(); pending["shiftId"] = shift;
            // Optional-address reception permits empty pickups; this assignment conflicts with the busy driver.
            Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync("/api/v1/reception/rides/" + pending["id"]!.GetValue<string>(), pending)).StatusCode);
            pending["receptionPending"] = false; pending["pickup"]!["name"] = "Other";
            Assert.Equal(HttpStatusCode.Conflict, (await a.PutAsJsonAsync("/api/v1/reception/rides/" + pending["id"]!.GetValue<string>(), pending)).StatusCode);
            edited["status"] = "completed";
            await Body(await a.PutAsJsonAsync($"/api/v1/reception/rides/{id}", edited));
            Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsJsonAsync("/api/v1/reception/shifts/" + shift + "/end", new { })).StatusCode);
            var response = await a.GetAsync("/api/v1/reception/snapshot");
            using var conditional = new HttpRequestMessage(HttpMethod.Get, "/api/v1/reception/snapshot"); conditional.Headers.IfNoneMatch.Add(response.Headers.ETag!);
            Assert.Equal(HttpStatusCode.NotModified, (await a.SendAsync(conditional)).StatusCode);
            using var restricted = factory.CreateClient();
            var driverLogin = await Body(await restricted.PostAsJsonAsync("/api/v1/auth/login", new { tenant = "reception-a", username = "driver", password = "Driver-reception-test!" }));
            restricted.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", driverLogin["accessToken"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.Forbidden, (await restricted.GetAsync("/api/v1/reception/snapshot")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await restricted.PostAsJsonAsync("/api/v1/reception/calls", call)).StatusCode);
            await LiveWorker(connection);
        }
        finally { NpgsqlConnection.ClearAllPools(); await using var drop = new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)", admin); await drop.ExecuteNonQueryAsync(); }
    }
    private static async Task LiveWorker(string connection)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "package.json"))) root = root.Parent;
        Assert.NotNull(root);
        var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start(); var port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
        var start = new ProcessStartInfo("dotnet") { WorkingDirectory = root.FullName, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(typeof(TaxiDb).Assembly.Location);
        start.Environment["Auth__SigningKey"] = "integration-test-only-signing-key-0123456789";
        start.Environment["ConnectionStrings__Taxi"] = connection; start.Environment["ASPNETCORE_URLS"] = $"http://127.0.0.1:{port}";
        using var api = Process.Start(start)!;
        var output = api.StandardOutput.ReadToEndAsync(); var errors = api.StandardError.ReadToEndAsync();
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(1) };
            bool ready = false;
            for (int i = 0; i < 50 && !api.HasExited; i++) { try { ready = (await http.GetAsync($"http://127.0.0.1:{port}/health/ready")).IsSuccessStatusCode; if (ready) break; } catch (HttpRequestException) { } catch (TaskCanceledException) { } await Task.Delay(100); }
            Assert.True(ready, "Live API failed to start");
            var nodeStart = new ProcessStartInfo("node") { WorkingDirectory = root.FullName, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            nodeStart.ArgumentList.Add("--experimental-strip-types"); nodeStart.ArgumentList.Add("backend/reception-live.mjs"); nodeStart.Environment["RECEPTION_TEST_URL"] = $"http://127.0.0.1:{port}";
            using var node = Process.Start(nodeStart)!;
            var nodeOutput = node.StandardOutput.ReadToEndAsync(); var nodeErrors = node.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
            try { await node.WaitForExitAsync(timeout.Token); } finally { if (!node.HasExited) node.Kill(true); }
            Assert.True(node.ExitCode == 0, await nodeOutput + await nodeErrors);
        }
        finally { if (!api.HasExited) api.Kill(true); await api.WaitForExitAsync(); await output; await errors; }
    }
}
