using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace DispatchPro.Tests;

public sealed class SuggestedPlaceAuthorizationTests
{
    [Fact]
    public async Task OfficeDispatcherCanManagePlacesWhileReaderAndCustomerCannotWrite()
    {
        await using var factory = new ApiFactory("Host=127.0.0.1;Port=1;Database=not_contacted;Timeout=1");
        using var client = factory.CreateClient();
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>().Where(e => e.RoutePattern.RawText?.StartsWith("/api/v1/office/suggested-places") == true).ToArray();
        Assert.Equal(4, endpoints.Length);
        using var scope = factory.Services.CreateScope();
        var authorization = scope.ServiceProvider.GetRequiredService<IAuthorizationService>();
        var policies = scope.ServiceProvider.GetRequiredService<IAuthorizationPolicyProvider>();
        ClaimsPrincipal Employee(params string[] permissions) => new(new ClaimsIdentity(permissions.Select(p => new Claim("permission", p)), "test"));
        var dispatcher = Employee("rides.read", "rides.write", "customers.read", "customers.write", "pricing.read");
        var reader = Employee("rides.read");
        var customer = Employee();
        foreach (var endpoint in endpoints)
        {
            var policy = await AuthorizationPolicy.CombineAsync(policies, endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>());
            Assert.NotNull(policy);
            var read = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Contains("GET");
            Assert.True((await authorization.AuthorizeAsync(dispatcher, null, policy)).Succeeded);
            Assert.Equal(read, (await authorization.AuthorizeAsync(reader, null, policy)).Succeeded);
            Assert.False((await authorization.AuthorizeAsync(customer, null, policy)).Succeeded);
        }
    }
}
