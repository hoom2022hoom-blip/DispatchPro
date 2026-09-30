using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using DispatchPro.Api.Endpoints;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 131072);
if (string.IsNullOrWhiteSpace(builder.Configuration["urls"])) builder.WebHost.UseUrls("http://127.0.0.1:9010");
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddScoped<TenantContext>();
builder.Services.AddSingleton<NotificationSignal>();
builder.Services.AddSingleton<NotificationCommitInterceptor>();
builder.Services.AddDbContext<TaxiDb>((services, o) => o.UseNpgsql(builder.Configuration.GetConnectionString("Taxi") ?? "Host=127.0.0.1;Port=5433;Database=dispatchpro;Username=dispatchpro;Timeout=2", p => p.UseNetTopologySuite()).AddInterceptors(services.GetRequiredService<NotificationCommitInterceptor>()));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<IOtpProvider, UnconfiguredOtpProvider>();
builder.Services.AddScoped<ReceptionService>();
builder.Services.AddScoped<DriverOperations>();
builder.Services.AddScoped<AutoDispatch>();
builder.Services.AddSingleton<IArrivalEstimate, SimpleArrivalEstimate>();
builder.Services.AddHostedService<DispatchWorker>();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    var signingKey = builder.Configuration["Auth:SigningKey"]!;
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters { ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true, ValidateIssuerSigningKey = true, ValidIssuer = builder.Configuration["Auth:Issuer"] ?? "DispatchPro", ValidAudience = builder.Configuration["Auth:Audience"] ?? "DispatchPro", IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), ClockSkew = TimeSpan.FromSeconds(30) };
});
builder.Services.AddAuthorization(o => { foreach (var permission in Permissions.All) o.AddPolicy(permission, p => p.RequireClaim("permission", permission)); });
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
var app = builder.Build();
var configuredKey = app.Configuration["Auth:SigningKey"];
if (string.IsNullOrWhiteSpace(configuredKey) || Encoding.UTF8.GetByteCount(configuredKey) < 32) throw new InvalidOperationException("Auth:SigningKey must be configured with at least 32 bytes");
app.Use(async (http, next) =>
{
    try { await next(); }
    catch (ArgumentException e) { await Results.Problem(statusCode: 400, detail: e.Message).ExecuteAsync(http); }
    catch (ReceptionConflictException e) { await Results.Problem(statusCode: 409, detail: e.Message).ExecuteAsync(http); }
    catch (DbUpdateConcurrencyException) { await Results.Problem(statusCode: 409, detail: "Concurrent update; reload and retry").ExecuteAsync(http); }
    catch (DbUpdateException) { await Results.Problem(statusCode: 409, detail: "Duplicate or invalid related record").ExecuteAsync(http); }
    catch (NotSupportedException) { await Results.Problem(statusCode: 503, detail: "Provider not configured").ExecuteAsync(http); }
    catch (Npgsql.NpgsqlException) { await Results.Problem(statusCode: 503, detail: "Database unavailable").ExecuteAsync(http); }
});
app.UseRateLimiter();
app.UseAuthentication();
// Tenant identity comes exclusively from the verified token, never a request header/body.
app.Use(async (http, next) =>
{
    if (http.User.Identity?.IsAuthenticated == true)
    {
        if (!Guid.TryParse(http.User.FindFirstValue("tenant"), out var tenantId) || !Guid.TryParse(http.User.FindFirstValue("sub"), out var userId)) { http.Response.StatusCode = 401; return; }
        var context = http.RequestServices.GetRequiredService<TenantContext>();
        context.TenantId = tenantId; context.ActorId = userId;
        var db = http.RequestServices.GetRequiredService<TaxiDb>();
        var user = await db.Set<User>().SingleOrDefaultAsync(u => u.Id == userId && u.Active, http.RequestAborted);
        if (user is null) { http.Response.StatusCode = 401; return; }
        var permissions = await db.Set<Permission>().Where(p => p.RoleId == user.RoleId).Select(p => p.Code).ToListAsync(http.RequestAborted);
        http.User.AddIdentity(new ClaimsIdentity(permissions.Select(p => new Claim("permission", p))));
    }
    await next();
});
app.UseAuthorization();
app.MapGet("/health/live", () => Results.Ok(new { service = "DispatchPro.Api", status = "alive" }));
app.MapGet("/health/ready", async (TaxiDb db) =>
{
    try { return await db.Database.CanConnectAsync() && !(await db.Database.GetPendingMigrationsAsync()).Any() ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503); }
    catch { return Results.StatusCode(503); }
});
app.MapTaxiEndpoints();
app.MapDriverEndpoints();
app.MapDispatch();
app.MapCustomers();
app.MapCustomerApp();
app.MapReceptionEndpoints();
app.MapSavedAddresses();
app.MapOfficeEndpoints();
app.MapOfficeAdministration();
if (args.Contains("--migrate") || args.Contains("--seed"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
    if (args.Contains("--migrate")) await db.Database.MigrateAsync();
    if (args.Contains("--seed")) await Seed.RunAsync(db, scope.ServiceProvider.GetRequiredService<TenantContext>(), app.Configuration);
    return;
}
app.Run();
public partial class Program { }
