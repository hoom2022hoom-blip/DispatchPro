using System.Text.RegularExpressions;

namespace DispatchPro.Api.Services;

public static partial class PalestinianPhone
{
    [GeneratedRegex(@"^(?:05[0-9]{8}|\+9705[0-9]{8})$")]
    private static partial Regex Pattern();
    public static string Normalize(string? value)
    {
        value = value?.Trim();
        if (value is null || !Pattern().IsMatch(value)) throw new ArgumentException("Palestinian mobile number required: 05XXXXXXXX or +9705XXXXXXXX");
        return value.StartsWith('+') ? value : "+970" + value[1..];
    }
}
// Implement with a provider storing hashed challenges, expiry, attempt limits and atomic single use.
public interface IOtpProvider
{
    Task RequestAsync(Guid tenantId, string normalizedPhone, CancellationToken cancellationToken);
    Task<bool> VerifyAsync(Guid tenantId, string normalizedPhone, string code, CancellationToken cancellationToken);
}
public sealed class UnconfiguredOtpProvider : IOtpProvider
{
    public Task RequestAsync(Guid tenantId, string normalizedPhone, CancellationToken cancellationToken) => throw new NotSupportedException("OTP provider is not configured");
    public Task<bool> VerifyAsync(Guid tenantId, string normalizedPhone, string code, CancellationToken cancellationToken) => throw new NotSupportedException("OTP provider is not configured");
}
