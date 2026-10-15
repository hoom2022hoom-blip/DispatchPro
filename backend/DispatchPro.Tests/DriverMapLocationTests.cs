using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace DispatchPro.Tests;

public sealed class DriverMapLocationTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-02T10:00:00Z");
    private static DriverGpsPoint Point(int minutes) => new() { Latitude = 32.22, Longitude = 35.25, Accuracy = 8, Timestamp = Now.AddMinutes(-minutes) };

    [Fact]
    public void HistoryOnlyDriverRetainsRealLastKnownLocationRegardlessOfAge()
    {
        var last = DriverMapLocations.Latest(null, Point(90));
        Assert.NotNull(last);
        Assert.Equal(32.22, last.Latitude);
        Assert.Equal(35.25, last.Longitude);
        Assert.Equal("STALE", DriverMapLocations.Freshness(last, Now, 120));
        Assert.Null(DriverMapLocations.Latest(null, null));
        Assert.Equal("NO_LOCATION", DriverMapLocations.Freshness(null, Now, 120));
    }

    [Fact]
    public void NewestValidObservationWinsWithoutInventingCoordinates()
    {
        var snapshot = new DriverLocation { Position = new Point(35.3, 32.3), Accuracy = 8, UpdatedAt = Now.AddMinutes(-10) };
        Assert.Equal(32.22, DriverMapLocations.Latest(snapshot, Point(1))!.Latitude);
        Assert.Equal(32.3, DriverMapLocations.Latest(snapshot, Point(20))!.Latitude);
        snapshot.Position = new Point(double.NaN, 32.3);
        Assert.Equal(32.22, DriverMapLocations.Latest(snapshot, Point(20))!.Latitude);
        var invalid = Point(0); invalid.Latitude = 100;
        Assert.Null(DriverMapLocations.Latest(snapshot, invalid));
    }

    [Fact]
    public void FreshnessBoundaryDoesNotDeleteLocation()
    {
        var location = DriverMapLocations.Latest(null, Point(2));
        Assert.Equal("FRESH", DriverMapLocations.Freshness(location, Now, 120));
        Assert.Equal("STALE", DriverMapLocations.Freshness(location, Now.AddSeconds(1), 120));
        Assert.Equal(32.22, location!.Latitude);
    }

    [Fact]
    public void HistoryBatchTranslatesToTenantFilteredBoundedSql()
    {
        var tenant = new TenantContext { TenantId = Guid.NewGuid() };
        var options = new DbContextOptionsBuilder<TaxiDb>().UseNpgsql("Host=localhost;Database=translation_only", x => x.UseNetTopologySuite()).Options;
        using var db = new TaxiDb(options, tenant);
        var sql = DriverMapLocations.History(db).ToQueryString();
        Assert.Contains("TenantId", sql);
        Assert.Contains(tenant.TenantId.ToString(), sql);
        Assert.Contains("ROW_NUMBER()", sql);
        Assert.Contains("<= 1", sql);
        Assert.Contains("<= 2", sql);
        Assert.DoesNotContain("120", sql); // Last known has no freshness cutoff.
    }

    [PostgresFact]
    public async Task ApiRecoversHistoryOnlyOfflineGpsAndIsolatesTenantDrivers()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        await using var admin = new NpgsqlConnection(connection);
        await admin.OpenAsync();
        var name = "taxi_map_gps_" + Guid.NewGuid().ToString("N");
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await create.ExecuteNonQueryAsync();
        // Isolated test database is retained; no office data is modified.
        await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(connection) { Database = name }.ConnectionString);
        var offlineId = Guid.NewGuid(); var freshId = Guid.NewGuid(); var noGpsId = Guid.NewGuid(); var foreignId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
            var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
            await db.Database.MigrateAsync();
            foreach (var slug in new[] { "map-a", "map-b" })
            {
                await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
                    { ["Seed:TenantSlug"] = slug, ["Seed:AdminPassword"] = "Map-test-password-123!" }).Build());
                tenant.TenantId = await db.Set<Tenant>().Where(t => t.Slug == slug).Select(t => t.Id).SingleAsync();
                var role = await db.Set<Role>().Where(r => r.Name == "Driver").SingleAsync();
                foreach (var id in slug == "map-a" ? new[] { offlineId, freshId, noGpsId } : new[] { foreignId })
                {
                    var user = new User { Username = id.ToString(), RoleId = role.Id };
                    db.Add(user);
                    db.Add(new Driver { Id = id, UserId = user.Id, FullName = id == foreignId ? "Other Tenant Driver" : "Driver " + id,
                        Status = id == offlineId ? DriverStatus.Offline : DriverStatus.Available });
                    if (id != noGpsId)
                        db.Add(new DriverGpsPoint { DriverId = id, Latitude = 32.22, Longitude = 35.25, Accuracy = 8,
                            Timestamp = id == offlineId ? now.AddHours(-2) : now });
                    if (id == freshId)
                        db.Add(new DriverLocation { DriverId = id, Position = new Point(35.1, 32.1) { SRID = 4326 }, Accuracy = 8, UpdatedAt = now.AddMinutes(-20) });
                }
                await db.SaveChangesAsync();
                db.ChangeTracker.Clear();
            }
        }
        using var client = factory.CreateClient();
        async Task<JsonNode> Read(HttpResponseMessage response)
        {
            var body = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {body}");
            return JsonNode.Parse(body)!;
        }
        async Task Login(string tenant)
        {
            var login = await Read(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant, username = "admin", password = "Map-test-password-123!" }));
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login["accessToken"]!.GetValue<string>());
        }
        await Login("map-a");
        var payload = await Read(await client.GetAsync("/api/v1/office/driver-map"));
        Assert.Equal(120, payload["locationMaxAgeSeconds"]!.GetValue<int>());
        var drivers = payload["drivers"]!.AsArray();
        Assert.Equal(3, drivers.Count);
        Assert.DoesNotContain(drivers, d => d!["id"]!.GetValue<Guid>() == foreignId);
        var offline = drivers.Single(d => d!["id"]!.GetValue<Guid>() == offlineId)!;
        Assert.Equal("Offline", offline["status"]!.GetValue<string>());
        Assert.Equal("STALE", offline["locationStatus"]!.GetValue<string>());
        Assert.Equal(32.22, offline["location"]!["latitude"]!.GetValue<double>());
        var fresh = drivers.Single(d => d!["id"]!.GetValue<Guid>() == freshId)!;
        Assert.Equal("FRESH", fresh["locationStatus"]!.GetValue<string>());
        Assert.Equal(32.22, fresh["location"]!["latitude"]!.GetValue<double>());
        var noGps = drivers.Single(d => d!["id"]!.GetValue<Guid>() == noGpsId)!;
        Assert.Equal("NO_LOCATION", noGps["locationStatus"]!.GetValue<string>());
        Assert.Null(noGps["location"]);
        await Login("map-b");
        var foreignDrivers = (await Read(await client.GetAsync("/api/v1/office/driver-map")))["drivers"]!.AsArray();
        Assert.Single(foreignDrivers);
        Assert.Equal(foreignId, foreignDrivers[0]!["id"]!.GetValue<Guid>());
    }
}
