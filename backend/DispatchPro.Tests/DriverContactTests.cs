using DispatchPro.Api.Domain;
using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;
public sealed class DriverContactTests
{
    [Theory]
    [InlineData("+970", "+970591234567")]
    [InlineData("+972", "+972591234567")]
    public void InternationalRecipientDoesNotChangeLocalPhone(string code, string expected)
    {
        var driver = new Driver { PhoneLocal = "0561111111", WhatsappPhone = "0591234567", WhatsappCountryCode = code, HasWhatsApp = true, WhatsappEnabled = true };
        Assert.Equal(expected, DriverContact.WhatsAppRecipient(driver));
        Assert.Equal("0561111111", driver.PhoneLocal);
        driver.WhatsappEnabled = false; Assert.Null(DriverContact.WhatsAppRecipient(driver));
        driver.WhatsappEnabled = true; driver.HasWhatsApp = false; Assert.Null(DriverContact.WhatsAppRecipient(driver));
    }
    [Theory]
    [InlineData("+970591234567")]
    [InlineData("+972591234567")]
    [InlineData("591234567")]
    public void LocalPhoneRejectsInternationalInput(string number) => Assert.Throws<ArgumentException>(() => DriverContact.Local(number));
}
