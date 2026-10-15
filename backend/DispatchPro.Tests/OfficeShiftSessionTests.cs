using System.IdentityModel.Tokens.Jwt;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Services;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace DispatchPro.Tests;
public sealed class OfficeShiftSessionTests
{
    [Fact]
    public void OfficeSessionIsFiniteAndOtherSessionsKeepTheirLifetime()
    {
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Auth:SigningKey"]="session-test-only-signing-key-01234567890123456789" }).Build();
        var service=new TokenService(config);var user=new User();var now=DateTime.UtcNow;
        var reader=new JwtSecurityTokenHandler();
        var office=reader.ReadJwtToken(service.Issue(user));var other=reader.ReadJwtToken(service.Issue(user));
        Assert.InRange((office.ValidTo-now).TotalMinutes,29.9,30.1);
        Assert.InRange((other.ValidTo-now).TotalMinutes,29.9,30.1);
        Assert.Equal(user.Id.ToString(),office.Subject);
    }
}
