using System.Diagnostics;
using System.Net;
using System.Text.Json;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;

public sealed class HealthReadinessTests
{
    [Fact]
    public async Task UnavailableDatabaseDoesNotExposeConfiguration()
    {
        await using var factory = new ApiFactory("Host=127.0.0.1;Port=1;Database=not_contacted;Timeout=1;Password=must-not-be-visible");
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("READINESS_DATABASE_UNAVAILABLE", body);
        Assert.DoesNotContain("must-not-be-visible", body);
        Assert.DoesNotContain("ConnectionStrings", body);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    [PostgresFact]
    public async Task BlockedReadinessIsBoundedAndClientAbortReleasesConnections()
    {
        var name = "health_test_" + Guid.NewGuid().ToString("N");
        var app = "readiness-test-" + Guid.NewGuid();
        var adminConnection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin = new NpgsqlConnection(adminConnection);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            var connection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = name, ApplicationName = app }.ConnectionString;
            await using var baseFactory = new ApiFactory(connection);
            await using var factory = baseFactory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Health:ReadinessTimeoutMilliseconds"] = "300" })));
            using (var scope = factory.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<TaxiDb>().Database.MigrateAsync();
            using var client = factory.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
            await using var locker = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(adminConnection) { Database = name }.ConnectionString);
            await locker.OpenAsync();
            await using var tx = await locker.BeginTransactionAsync();
            await using (var held = new NpgsqlCommand("LOCK TABLE \"__EFMigrationsHistory\" IN ACCESS EXCLUSIVE MODE", locker, tx)) await held.ExecuteNonQueryAsync();
            for (var i = 0; i < 3; i++)
            {
                var id = Guid.NewGuid().ToString();
                using var request = new HttpRequestMessage(HttpMethod.Get, "/health/ready"); request.Headers.Add("X-DispatchPro-Probe-Id", id);
                var watch = Stopwatch.StartNew();
                var response = await client.SendAsync(request);
                Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
                Assert.Equal(id, response.Headers.GetValues("X-DispatchPro-Probe-Id").Single());
                var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
                Assert.Equal("READINESS_TIMEOUT", body.GetProperty("code").GetString());
                Assert.Equal("migrations", body.GetProperty("phase").GetString());
                Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3), "Health must answer before the external 10-second probe deadline");
                Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
            }
            using var cancel = new CancellationTokenSource();
            var pending = client.GetAsync("/health/ready", cancel.Token);
            await Task.Delay(100); cancel.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await pending);
            await Task.Delay(200);
            await using var count = new NpgsqlCommand("SELECT count(*) FROM pg_stat_activity WHERE application_name=@app AND wait_event_type='Lock'", admin); count.Parameters.AddWithValue("app", app);
            Assert.Equal(0L, (long)(await count.ExecuteScalarAsync())!);
            await tx.RollbackAsync();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)", admin); await drop.ExecuteNonQueryAsync();
        }
    }
}
