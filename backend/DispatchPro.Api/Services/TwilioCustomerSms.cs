using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DispatchPro.Api.Services;

// Opt-in adapter. Provider acceptance is not proof of handset delivery.
public sealed class TwilioCustomerSms(HttpClient http, IConfiguration configuration) : ICustomerSmsSender
{
    private string Account => configuration["CustomerSms:Twilio:AccountSid"] ?? "";
    private string Secret => configuration["CustomerSms:Twilio:AuthToken"] ?? "";
    private string From => configuration["CustomerSms:Twilio:From"] ?? "";
    private string Service => configuration["CustomerSms:Twilio:MessagingServiceSid"] ?? "";
    public bool Enabled => configuration.GetValue<bool>("CustomerSms:Enabled")
        && configuration["CustomerSms:Provider"] == "Twilio"
        && Regex.IsMatch(Account, "^AC[a-fA-F0-9]{32}$") && !string.IsNullOrWhiteSpace(Secret)
        && (Regex.IsMatch(Service, "^MG[a-fA-F0-9]{32}$") || Regex.IsMatch(From, "^[A-Za-z][A-Za-z0-9 ]{0,10}$"));

    public async Task Send(Guid tenant, string phone, string code, Guid challenge, CancellationToken cancellation)
    {
        if (!Enabled || !Regex.IsMatch(code, "^[0-9]{6}$")) throw new InvalidOperationException("SMS unavailable");
        var fields = new Dictionary<string,string> {
            ["To"] = CustomerPhone.SmsInternational(phone),
            // ASCII keeps the verification text to one SMS segment.
            ["Body"] = $"NM TAXI verification code: {code}. Expires in 5 minutes. Do not share this code."
        };
        if (!string.IsNullOrEmpty(Service)) fields["MessagingServiceSid"] = Service;
        else fields["From"] = From;
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://api.twilio.com/2010-04-01/Accounts/{Account}/Messages.json");
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(Account+":"+Secret)));
        request.Content = new FormUrlEncodedContent(fields);
        // Never retry an ambiguous send automatically: it may already be billable.
        using var response = await http.SendAsync(request, cancellation);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("SMS provider rejected send");
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
        if (!payload.RootElement.TryGetProperty("sid", out var sid) || !Regex.IsMatch(sid.GetString() ?? "", "^SM[a-fA-F0-9]{32}$")
            || !payload.RootElement.TryGetProperty("status", out var status) || status.GetString() is not ("accepted" or "queued" or "sending" or "sent" or "delivered"))
            throw new InvalidOperationException("SMS provider did not accept send");
    }
}
