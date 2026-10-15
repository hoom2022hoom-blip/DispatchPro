using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Http;
using Npgsql;
using System.Text.Json;

namespace DispatchPro.Api.Services;

// Opt-in QA runtime only. The operational runtime keeps its existing registrations.
public static class DriverQaSafety
{
    public static bool Enabled(IHostEnvironment environment) => environment.IsEnvironment("DriverQa");
    public static void Validate(IConfiguration config)
    {
        var db = new NpgsqlConnectionStringBuilder(config.GetConnectionString("Taxi"));
        if (db.Host is not ("127.0.0.1" or "localhost" or "::1") || db.Database?.StartsWith("dispatchpro_driverqa_", StringComparison.Ordinal) != true
            || db.Username?.StartsWith("driverqa_", StringComparison.Ordinal) != true || config.GetValue<bool>("CustomerPush:Enabled")
            || config["CustomerSms:Provider"] != "QA_DISABLED" || config["Qa:TenantSlug"] != "driver-qa")
            throw new InvalidOperationException("QA isolation configuration rejected");
    }
    public static void Configure(WebApplicationBuilder builder)
    {
        if (!Enabled(builder.Environment)) return;
        Validate(builder.Configuration);
        builder.Services.AddScoped<QaOfficeConversation>();
        var excluded = new[] {typeof(OfficeCallsWorker), typeof(FirebasePushStartup), typeof(CustomerPushWorker), typeof(DispatchPushWorker)};
        foreach (var service in builder.Services.Where(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType is { } type && excluded.Contains(type)).ToArray()) builder.Services.Remove(service);
        builder.Services.RemoveAll<ICustomerSmsSender>();
        builder.Services.AddSingleton<ICustomerSmsSender, UnconfiguredCustomerSmsSender>();
        builder.Services.AddSingleton<IHttpMessageHandlerBuilderFilter, QaOutboundFilter>();
    }
    public static void Attach(WebApplication app)
    {
        if (!Enabled(app.Environment)) return;
        app.Use(async (http, next) => {
            http.Response.Headers["X-DispatchPro-Environment"] = "DriverQa";
            var path = http.Request.Path.Value ?? "";
            if (path.Contains("officecalls", StringComparison.OrdinalIgnoreCase) || path.Contains("/bridge/", StringComparison.OrdinalIgnoreCase)
                || path.Contains("push-device", StringComparison.OrdinalIgnoreCase) || path.Contains("/otp", StringComparison.OrdinalIgnoreCase)) {
                http.Response.StatusCode = 403; await http.Response.WriteAsJsonAsync(new {code="QA_EXTERNAL_DISABLED"}); return;
            }
            if (http.User.Identity?.IsAuthenticated == true && http.User.FindFirst("tenant")?.Value != app.Configuration["Qa:TenantId"]) {
                http.Response.StatusCode = 403; return;
            }
            if (http.Request.Method is "POST" or "PUT" or "PATCH" && http.Request.ContentType?.StartsWith("application/json",StringComparison.OrdinalIgnoreCase)==true && http.Request.ContentLength != 0) {
                http.Request.EnableBuffering();
                try {using var body=await JsonDocument.ParseAsync(http.Request.Body,cancellationToken:http.RequestAborted);if(RealPhone(body.RootElement)){http.Response.StatusCode=403;await http.Response.WriteAsJsonAsync(new{code="QA_REAL_PHONE_REJECTED"});return;}}
                catch(JsonException){http.Response.StatusCode=400;return;}
                finally{http.Request.Body.Position=0;}
            }
            await next();
        });
        app.MapGet("/qa/status", (IServiceProvider services) => new {environment="DriverQa",database=app.Configuration.GetConnectionString("Taxi") is { } c ? new NpgsqlConnectionStringBuilder(c).Database : "",externalPush=services.GetRequiredService<ICustomerPushSender>().Enabled,externalSms=services.GetRequiredService<ICustomerSmsSender>().Enabled,hostedWorkers=services.GetServices<IHostedService>().Select(s=>s.GetType().Name).ToArray(),outboundBlockInstalled=services.GetServices<IHttpMessageHandlerBuilderFilter>().Any(s=>s is QaOutboundFilter),blockedHttp=QaOutboundFilter.Blocked});
        app.MapGet("/qa/outbound-probe", async (IHttpClientFactory clients) => {
            try {await clients.CreateClient("qa-probe").GetAsync("https://example.invalid/never-send");return Results.Problem("QA outbound block failed");}
            catch (HttpRequestException) {return Results.Ok(new {blocked=true,networkRequestSent=false});}
        }).RequireAuthorization("users.write");
    }
    public static bool RealPhone(JsonElement value) {
        if(value.ValueKind==JsonValueKind.Array)return value.EnumerateArray().Any(RealPhone);
        if(value.ValueKind!=JsonValueKind.Object)return false;
        foreach(var p in value.EnumerateObject()){
            if(new[]{"phone","passengerphone","callernumber","whatsappphone","phonenumber","secondaryphone"}.Contains(p.Name.ToLowerInvariant())&&p.Value.ValueKind==JsonValueKind.String){var phone=p.Value.GetString();if(!string.IsNullOrWhiteSpace(phone)&&!phone.StartsWith("QA-",StringComparison.Ordinal))return true;}
            if(RealPhone(p.Value))return true;
        }return false;
    }
}
public sealed class QaOutboundFilter : IHttpMessageHandlerBuilderFilter
{
    public static long Blocked;
    public Action<HttpMessageHandlerBuilder> Configure(Action<HttpMessageHandlerBuilder> next) => builder => {
        next(builder);builder.PrimaryHandler = new DenyOutbound();
    };
    private sealed class DenyOutbound : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            Interlocked.Increment(ref Blocked);return Task.FromException<HttpResponseMessage>(new HttpRequestException("QA_EXTERNAL_HTTP_DISABLED"));
        }
    }
}
