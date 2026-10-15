using System.Collections.Concurrent;
namespace DispatchPro.Api.Services;

// Only an explicitly opted-in, isolated Development server registers this sender.
// Production uses its real SMS adapter; release APKs do not request disclosure.
public sealed class DevelopmentCustomerSms : ICustomerSmsSender
{
    private readonly ConcurrentDictionary<Guid,(string Code,DateTimeOffset Expires)> codes = new();
    public bool Enabled => true;
    public Task Send(Guid tenant,string phone,string code,Guid challenge,CancellationToken ct)
    {
        foreach(var entry in codes.Where(e=>e.Value.Expires<=DateTimeOffset.UtcNow))codes.TryRemove(entry.Key,out _);
        codes[challenge]=(code,DateTimeOffset.UtcNow.AddMinutes(5));
        return Task.CompletedTask;
    }
    public string? Code(Guid challenge) => codes.TryGetValue(challenge,out var value)&&value.Expires>DateTimeOffset.UtcNow?value.Code:null;
}
public static class DevelopmentCustomerOtp
{
    public static bool Enabled(IHostEnvironment environment,IConfiguration configuration)
    {
#if DEBUG
        return environment.IsDevelopment()&&configuration.GetValue<bool>("CustomerOtp:DevelopmentEnabled");
#else
        return false;
#endif
    }
}
