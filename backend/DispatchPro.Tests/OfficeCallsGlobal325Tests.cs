using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;

public sealed class OfficeCallsGlobal325Tests
{
    [Theory]
    [InlineData("+972 (52) 123-4567", "+972521234567")]
    [InlineData("+970592081197", "+970592081197")]
    [InlineData("+966501234567", "+966501234567")]
    [InlineData("+1 (202) 555-0123", "+12025550123")]
    [InlineData("0044 20 7946 0018", "+442079460018")]
    [InlineData("+٣٩ ٠٦٦٩٨٢", "+39066982")]
    [InlineData("+819012345678", "+819012345678")]
    [InlineData("052 123 4567", "0521234567")]
    [InlineData("970592081197", "970592081197")]
    [InlineData("02079460018", "02079460018")]
    [InlineData("phone 0591234567", "")]
    [InlineData("0591234567 0561234567", "")]
    [InlineData("+12", "")]
    [InlineData("0000000000", "")]
    public void RetainsCanonicalIdentityWithoutRegionGuess(string input, string expected) => Assert.Equal(expected, OfficePhoneNormalizer.Normalize(input));

    [Fact]
    public void IdenticalNationalNumbersFromDifferentCountriesRemainDistinct() =>
        Assert.NotEqual(OfficePhoneNormalizer.Normalize("+970591234567"), OfficePhoneNormalizer.Normalize("+972591234567"));
}
