using System.Text.RegularExpressions;
using DispatchPro.Api.Domain;

namespace DispatchPro.Api.Services;

// Data preparation only. No transport, credentials or external WhatsApp integration.
public static class DriverContact
{
    public static string Local(string? value)
    {
        var number = (value ?? "").Trim();
        if (!Regex.IsMatch(number, @"^0[0-9]{8,9}$"))
            throw new ArgumentException("أدخل الهاتف المحلي بدءًا من 0، دون رمز دولة");
        return number;
    }
    public static string? WhatsAppRecipient(Driver driver)
    {
        if (!driver.Active || !driver.HasWhatsApp || !driver.WhatsappEnabled) return null;
        if (driver.WhatsappCountryCode is not ("+970" or "+972")) throw new ArgumentException("رمز WhatsApp غير صالح");
        return driver.WhatsappCountryCode + Local(driver.WhatsappPhone)[1..];
    }
}
