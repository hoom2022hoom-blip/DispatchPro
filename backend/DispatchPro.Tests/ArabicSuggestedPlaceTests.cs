using DispatchPro.Api.Endpoints;
using Xunit;
namespace DispatchPro.Tests;
public sealed class ArabicSuggestedPlaceTests
{
    [Fact]
    public void ArabicFieldsAcceptedAndEnglishRejected()
    {
        var input = new SuggestedPlaceInput("مستشفى رفيديا", "شارع الجامعة", 32.24, 35.27, 0, true, Area: "رفيديا", Category: "مستشفى");
        SuggestedPlaceEndpoints.Validate(input);
        Assert.Throws<ArgumentException>(() => SuggestedPlaceEndpoints.Validate(input with { Name = "Hospital" }));
        Assert.Throws<ArgumentException>(() => SuggestedPlaceEndpoints.Validate(input with { Name = "رفيديا Hospital" }));
        Assert.Throws<ArgumentException>(() => SuggestedPlaceEndpoints.Validate(input with { Area = "Rafidia" }));
        Assert.Throws<ArgumentException>(() => SuggestedPlaceEndpoints.Validate(input with { Category = "Hospital" }));
        Assert.Throws<ArgumentException>(() => SuggestedPlaceEndpoints.Validate(input with { Latitude = null }));
    }
}
