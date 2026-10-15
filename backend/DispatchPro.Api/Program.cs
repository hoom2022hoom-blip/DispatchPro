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
using Microsoft.AspNetCore.DataProtection;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options => { options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ "; options.UseUtcTimestamp = true; });
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 131072);
if (string.IsNullOrWhiteSpace(builder.Configuration["urls"])) builder.WebHost.UseUrls("http://127.0.0.1:9010");
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddScoped<TenantContext>();
builder.Services.AddSingleton<NotificationSignal>();
var customerProtection=builder.Services.AddDataProtection().SetApplicationName("DispatchPro.CustomerPush");
if(builder.Configuration.GetValue<bool>("CustomerPush:Enabled")||!string.IsNullOrWhiteSpace(builder.Configuration["CustomerPush:KeyRingPath"])){
    var keyRing=builder.Configuration["CustomerPush:KeyRingPath"];
    if(string.IsNullOrWhiteSpace(keyRing))throw new InvalidOperationException("Customer Push requires a persistent protected key ring");
    customerProtection.PersistKeysToFileSystem(new DirectoryInfo(keyRing));
    if(OperatingSystem.IsWindows())customerProtection.ProtectKeysWithDpapi();
}
builder.Services.AddSingleton<FirebaseCustomerPushSender>();
builder.Services.AddSingleton<ICustomerPushSender>(s=>s.GetRequiredService<FirebaseCustomerPushSender>());
builder.Services.AddHostedService<FirebasePushStartup>();
builder.Services.AddHostedService<CustomerPushWorker>();
builder.Services.AddHostedService<DispatchPushWorker>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<VoiceRooms>();
builder.Services.AddSingleton<VoiceEvents>();
builder.Services.AddSingleton<RideCallSignals>();
builder.Services.AddScoped<RideCalls>();
builder.Services.AddSingleton<NotificationCommitInterceptor>();
builder.Services.AddDbContext<TaxiDb>((services, o) => o.UseNpgsql(builder.Configuration.GetConnectionString("Taxi") ?? "Host=127.0.0.1;Port=5433;Database=dispatchpro;Username=dispatchpro;Timeout=2", p => p.UseNetTopologySuite()).AddInterceptors(services.GetRequiredService<NotificationCommitInterceptor>()));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<OfficeSessions>();
builder.Services.AddSingleton<IOtpProvider, UnconfiguredOtpProvider>();
builder.Services.AddHttpClient<TwilioCustomerSms>(http=>http.Timeout=TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(()=>new HttpClientHandler { AllowAutoRedirect=false });
builder.Services.AddTransient<ICustomerSmsSender>(services=>DevelopmentCustomerOtp.Enabled(services.GetRequiredService<IHostEnvironment>(),services.GetRequiredService<IConfiguration>())
    ? services.GetRequiredService<DevelopmentCustomerSms>() : services.GetRequiredService<IConfiguration>()["CustomerSms:Provider"]=="Twilio"
    ? services.GetRequiredService<TwilioCustomerSms>() : new UnconfiguredCustomerSmsSender());
builder.Services.AddScoped<CustomerOtp>();
builder.Services.AddScoped<CustomerSessions>();
#if DEBUG
builder.Services.AddSingleton<DevelopmentCustomerSms>();
#endif
builder.Services.AddScoped<DevelopmentTiming>();
builder.Services.AddScoped<ReceptionService>();
builder.Services.AddHostedService<OfficeCallsWorker>();
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
    o.AddPolicy("officecalls", http => RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 180, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("customer-otp", http => RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("office-refresh", http => RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.AddSingleton<MobilePresence>();
DriverQaSafety.Configure(builder);
var app = builder.Build();
if(app.Environment.IsDevelopment()&&builder.Configuration.GetValue<bool>("Diagnostics:Latency"))app.Use(async(http,next)=>{
    var timing=http.RequestServices.GetRequiredService<DevelopmentTiming>();timing.Enabled=true;timing.Mark("receive");
    http.Response.OnStarting(()=>{timing.Mark("response");http.Response.Headers["Server-Timing"]=timing.Header();return Task.CompletedTask;});await next();
});
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
DriverQaSafety.Attach(app);
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
        var isCustomer=await db.Set<Role>().AnyAsync(r=>r.Id==user.RoleId&&r.Name=="CustomerApp",http.RequestAborted);
        if(isCustomer&&(!await CustomerAppEndpoints.Verified(db,context,app.Environment,app.Configuration)||http.User.FindFirstValue("customer_session") is null)){http.Response.StatusCode=401;return;}
        var customerSession=http.User.FindFirstValue("customer_session");
        if(customerSession is not null&&(!Guid.TryParse(customerSession,out var customerSessionId)||!await db.Set<AuditLog>().AnyAsync(a=>a.Id==customerSessionId&&a.ActorId==userId&&a.Action=="customer.session.created",http.RequestAborted)||await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==customerSessionId&&a.Action=="customer.session.revoked",http.RequestAborted))){http.Response.StatusCode=401;return;}
        var officeSession=http.User.FindFirstValue("office_session");
        if(officeSession is not null&&(!Guid.TryParse(officeSession,out var sessionId)||
            !await db.Set<AuditLog>().AnyAsync(a=>a.Id==sessionId&&a.EntityId==userId&&a.Action=="office.session.created",http.RequestAborted)||
            await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==sessionId&&a.Action=="office.session.revoked",http.RequestAborted)))
        {http.Response.StatusCode=401;var replaced=await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==sessionId&&a.Action=="office.session.revoked"&&a.Detail=="SESSION_REPLACED",http.RequestAborted);await http.Response.WriteAsJsonAsync(new {code=replaced?"SESSION_REPLACED":"SESSION_INVALID"});return;}
        // Existing driver access tokens must not bypass a newly issued device session.
        if(officeSession is null&&await db.Set<Driver>().AnyAsync(d=>d.UserId==userId,http.RequestAborted)&&await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==userId&&a.Action=="office.session.created",http.RequestAborted))
        {http.Response.StatusCode=401;await http.Response.WriteAsJsonAsync(new {code="SESSION_REPLACED"});return;}
        var mobileDriver = await db.Set<Driver>().SingleOrDefaultAsync(d=>d.UserId==userId,http.RequestAborted);
        if(mobileDriver is not null) {
            var application=http.User.FindFirstValue("mobile_app")??"driver";
            if(application is not ("driver" or "radio") || !MobileAppAccess.Allowed(mobileDriver,application)){http.Response.StatusCode=403;return;}
            if(application=="radio" && !(http.Request.Path.StartsWithSegments("/api/v1/radio") || http.Request.Path.StartsWithSegments("/api/v1/voice"))){http.Response.StatusCode=403;return;}
            if(application!="radio" && http.Request.Path.StartsWithSegments("/api/v1/radio")){http.Response.StatusCode=403;return;}
            http.RequestServices.GetRequiredService<MobilePresence>().Touch(tenantId,mobileDriver.Id,application);
        }
        var permissions = await db.Set<Permission>().Where(p => p.RoleId == user.RoleId).Select(p => p.Code).ToListAsync(http.RequestAborted);
        http.User.AddIdentity(new ClaimsIdentity(permissions.Select(p => new Claim("permission", p))));
    }
    await next();
});
app.UseAuthorization();
var assemblyHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(typeof(Program).Assembly.Location)));
app.MapGet("/health/live", (FirebaseCustomerPushSender push) => Results.Ok(new { service = "DispatchPro.Api", status = "alive", assemblyHash, processId = Environment.ProcessId, fcm = new { enabled=push.Enabled, initialized=push.Initialized, projectId=push.ProjectId } }));
app.MapReadiness();
app.MapTaxiEndpoints();
app.MapFares();
app.MapDriverEndpoints();
app.MapVoice();
app.MapSuggestedPlaces();
app.MapRideLocations();
app.MapDispatch();
app.MapCustomers();
app.MapCustomerApp();
#if DEBUG
app.MapCustomerTest();
#endif
app.MapRideChat();
app.MapRideCalls();
app.MapMobileCommunication();
app.MapDriverPush();
app.MapReceptionEndpoints();
app.MapOfficeCalls();
app.MapSavedAddresses();
app.MapOfficeEndpoints();
app.MapNmAppAccess();
app.MapOfficeAdministration();
if (args.Contains("--migrate") || args.Contains("--seed") || args.Contains("--qa-seed"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
    if (args.Contains("--migrate")) await db.Database.MigrateAsync();
    if (args.Contains("--seed")) await Seed.RunAsync(db, scope.ServiceProvider.GetRequiredService<TenantContext>(), app.Configuration);
    if (args.Contains("--qa-seed")) {
        if (!DriverQaSafety.Enabled(app.Environment)) throw new InvalidOperationException("QA fixture requires DriverQa environment");
        await DriverQaFixture.Seed(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),app.Configuration);
    }
    return;
}
app.Run();
public partial class Program { }
