using System.Net;
using System.Net.Http.Json;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DispatchPro.Tests;

public sealed class CustomerMobileAccessTests
{
    [Fact]
    public void SavedAndRecentQueriesRequireBothTenantAndOwnedCustomer()
    {
        var tenant = new TenantContext { TenantId = Guid.NewGuid() };
        var customerId = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<TaxiDb>().UseNpgsql("Host=127.0.0.1;Port=1;Database=translation_only", p => p.UseNetTopologySuite()).Options;
        using var db = new TaxiDb(options, tenant);
        foreach (var sql in new[] { CustomerAppEndpoints.OwnPlaces(db, customerId).ToQueryString(), CustomerAppEndpoints.RecentDestinations(db, customerId).ToQueryString() })
        {
            Assert.Contains(tenant.TenantId.ToString(), sql);
            Assert.Contains(customerId.ToString(), sql);
            Assert.Contains("\"TenantId\" =", sql);
            Assert.Contains("\"CustomerId\" =", sql);
        }
        var recentSql = CustomerAppEndpoints.RecentDestinations(db, customerId).ToQueryString();
        Assert.Contains("LIMIT", recentSql);
        Assert.Contains("20", recentSql);
        Assert.DoesNotContain("DriverGpsPoint", recentSql);
    }

    [Fact]
    public async Task PlacesRoutesRejectAnonymousAccessWithoutConnectingToDatabase()
    {
        // An unreachable connection intentionally proves authentication happens before a DB read/write.
        await using var factory = new ApiFactory("Host=127.0.0.1;Port=1;Database=not_contacted;Timeout=1");
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/customer-app/places")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/customer-app/places", new { id = Guid.NewGuid(), label = "Isolated test", addressText = "Isolated test address" })).StatusCode);
    }
}
