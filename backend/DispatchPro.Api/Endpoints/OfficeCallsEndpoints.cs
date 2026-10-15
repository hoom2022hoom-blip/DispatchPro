using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Endpoints;

public sealed record OfficePairComplete(Guid SessionId, string Secret, string Name, string? PublicKey = null);
public sealed record OfficeEventInput(string EventId, string Phone, string SourcePackage, DateTimeOffset Timestamp);
public sealed record OfficeSignedEvent(Guid DeviceId, string Payload, string Signature);
public sealed record OfficeGridAck(string Status, string? Error = null);
public static class OfficeCallsEndpoints
{
    internal static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string Secret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    internal static bool Fresh(DateTimeOffset time, DateTimeOffset now) => time <= now.AddMinutes(2) && time >= now.AddMinutes(-5);
    private static object Status(OfficeCallEvent e) => new { e.EventId, serverAcknowledged = true, dispatchPro = e.DispatchStatus, gridCms = e.GridStatus, e.GridVisibleConfirmed, e.DispatchError, e.GridError, expiresAt = e.Timestamp.AddMinutes(5), expiryReason = e.DispatchStatus == "EXPIRED" || e.GridStatus == "EXPIRED" ? "DELIVERY_WINDOW_EXCEEDED" : null };
    private static string? ValidationError(OfficeEventInput input, string phone, DateTimeOffset now) =>
        input.EventId is null || !Regex.IsMatch(input.EventId, @"^[A-Za-z0-9._:-]{1,160}$") ? "EVENT_ID_INVALID" :
        phone == "" ? "PHONE_INVALID" : input.SourcePackage is not ("com.whatsapp.w4b" or "com.whatsapp") ? "SOURCE_PACKAGE_INVALID" :
        input.Timestamp < now.AddDays(-1) ? "EVENT_TOO_OLD" : input.Timestamp > now.AddMinutes(2) ? "EVENT_TIMESTAMP_FUTURE" : null;
    private static async Task<OfficeCallDevice?> Device(HttpContext http, TaxiDb db, TenantContext tenant, string? kind = null)
    {
        var auth = http.Request.Headers.Authorization.ToString();
        if (!auth.StartsWith("Bearer oc3_", StringComparison.Ordinal) || auth.Length > 100) return null;
        var hash = Hash(auth[7..]);
        var device = await db.Set<OfficeCallDevice>().IgnoreQueryFilters().SingleOrDefaultAsync(d => d.TokenHash == hash && !d.Revoked && d.Approved);
        if (device is null || (kind is not null && device.Kind != kind)) return null;
        tenant.TenantId = device.TenantId; tenant.ActorId = device.Id;
        device.LastSeen = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return device;
    }
    public static void MapOfficeCalls(this WebApplication app)
    {
        var admin = app.MapGroup("/api/v1/officecalls/admin").RequireAuthorization("settings.write");
        admin.MapPost("/pairings", async (string kind, TaxiDb db, TenantContext tenant) => {
            if (kind is not ("ANDROID" or "WINDOWS")) return Results.BadRequest();
            var secret = Secret();
            var pairing = new OfficeCallPairing { SecretHash = Hash(secret), Kind = kind, ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5) };
            db.Add(pairing); db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = pairing.Id, Action = "officecalls.pairing-created" });
            await db.SaveChangesAsync();
            return Results.Ok(new { sessionId = pairing.Id, pairing.ExpiresAt, qr = $"officecalls://pair?sessionId={pairing.Id}&secret={secret}" });
        });
        admin.MapGet("/devices", async (TaxiDb db) => Results.Ok(await db.Set<OfficeCallDevice>().Select(d => new { d.Id, d.Name, d.Kind, d.Approved, d.Revoked, d.LastSeen }).ToArrayAsync()));
        admin.MapPost("/devices/{id:guid}/approve", async (Guid id, TaxiDb db, TenantContext tenant) => {
            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId + ":officecalls-agent-approval"}, 0))");
            var d = await db.Set<OfficeCallDevice>().SingleOrDefaultAsync(d => d.Id == id && !d.Revoked);
            if (d is null) return Results.NotFound();
            if (d.Kind == "WINDOWS" && await db.Set<OfficeCallDevice>().AnyAsync(x => x.Id != id && x.Kind == "WINDOWS" && x.Approved && !x.Revoked)) return Results.Conflict(new { code = "OFFICE_AGENT_ALREADY_APPROVED" });
            d.Approved = true;
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = id, Action = "officecalls.device-approved" }); await db.SaveChangesAsync(); await transaction.CommitAsync(); return Results.Ok();
        });
        admin.MapDelete("/devices/{id:guid}", async (Guid id, TaxiDb db, TenantContext tenant) => {
            var d = await db.Set<OfficeCallDevice>().SingleOrDefaultAsync(d => d.Id == id);
            if (d is null) return Results.NotFound(); d.Revoked = true;
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = id, Action = "officecalls.device-revoked" }); await db.SaveChangesAsync(); return Results.Ok();
        });
        var deviceApi = app.MapGroup("/api/v1/officecalls").AllowAnonymous().RequireRateLimiting("officecalls");
        deviceApi.MapPost("/pair/complete", async (OfficePairComplete input, TaxiDb db, TenantContext tenant) => {
            if (input.Secret?.Length != 64 || string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 100) return Results.BadRequest();
            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({input.SessionId.ToString()}, 0))");
            var pair = await db.Set<OfficeCallPairing>().IgnoreQueryFilters().SingleOrDefaultAsync(p => p.Id == input.SessionId && p.SecretHash == Hash(input.Secret) && p.ExpiresAt > DateTimeOffset.UtcNow && p.DeviceId == null);
            if (pair is null) return Results.Unauthorized();
            tenant.TenantId = pair.TenantId;
            if (input.PublicKey is not null) {
                if (input.PublicKey.Length > 4096) return Results.BadRequest();
                try { using var rsa = RSA.Create(); rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(input.PublicKey), out _); if (rsa.KeySize != 2048) return Results.BadRequest(); }
                catch (Exception) { return Results.BadRequest(); }
            }
            var token = "oc3_" + Secret(); var device = new OfficeCallDevice { Kind = pair.Kind, Name = input.Name, TokenHash = Hash(token), PublicKey = input.PublicKey ?? "" };
            db.Add(device); pair.DeviceId = device.Id;
            db.Add(new AuditLog { EntityId = device.Id, ActorId = device.Id, Action = "officecalls.device-pending" });
            await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Results.Ok(new { deviceId = device.Id, officeId = pair.TenantId, token, approved = false });
        }).RequireRateLimiting("auth");
        deviceApi.MapGet("/health", async (HttpContext http, TaxiDb db, TenantContext tenant) => {
            var d = await Device(http, db, tenant); if (d is null) return Results.Unauthorized();
            var lastAgent = await db.Set<OfficeCallDevice>().Where(x => x.Kind == "WINDOWS" && x.Approved && !x.Revoked).MaxAsync(x => x.LastSeen);
            return Results.Ok(new { officeId = d.TenantId, deviceId = d.Id, approved = true, serverTime = DateTimeOffset.UtcNow, windowsAgentLastSeen = lastAgent,
                localAuthorizationExpiresAt = DateTimeOffset.UtcNow.AddMinutes(5), localAgentKeys = await db.Set<OfficeCallDevice>().Where(x => x.Kind == "WINDOWS" && x.Approved && !x.Revoked && x.PublicKey != "").Select(x => x.PublicKey).ToArrayAsync() });
        });
        deviceApi.MapPost("/events", async (OfficeEventInput input, HttpContext http, TaxiDb db, TenantContext tenant) => {
            var d = await Device(http, db, tenant, "ANDROID"); if (d is null) return Results.Unauthorized();
            input = input with { Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(input.Timestamp.ToUnixTimeMilliseconds()) };
            var phone = OfficePhoneNormalizer.Normalize(input.Phone); var now = DateTimeOffset.UtcNow;
            if (ValidationError(input, phone, now) is { } code) return Results.BadRequest(new { code, serverTime = now });
            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId + ":" + input.EventId}, 0))");
            var previous = await db.Set<OfficeCallEvent>().SingleOrDefaultAsync(e => e.EventId == input.EventId);
            if (previous is not null) {
                if (previous.DeviceId != d.Id || previous.Phone != phone || previous.SourcePackage != input.SourcePackage || previous.Timestamp != input.Timestamp) return Results.Conflict(new { code = "EVENT_ID_CONFLICT" });
                return Results.Ok(Status(previous));
            }
            var e = new OfficeCallEvent { DeviceId = d.Id, EventId = input.EventId, Phone = phone, SourcePackage = input.SourcePackage, Timestamp = input.Timestamp };
            if (!Fresh(input.Timestamp, now)) { e.DispatchStatus = "EXPIRED"; e.GridStatus = "EXPIRED"; }
            db.Add(e); db.Add(new AuditLog { ActorId = d.Id, EntityId = e.Id, Action = "officecalls.accepted", Detail = input.EventId });
            await db.SaveChangesAsync(); await transaction.CommitAsync(); return Results.Ok(Status(e));
        });
        deviceApi.MapGet("/events/{eventId}", async (string eventId, HttpContext http, TaxiDb db, TenantContext tenant) => {
            var d = await Device(http, db, tenant); if (d is null) return Results.Unauthorized();
            var e = await db.Set<OfficeCallEvent>().SingleOrDefaultAsync(e => e.EventId == eventId && (d.Kind == "WINDOWS" || e.DeviceId == d.Id));
            return e is null ? Results.NotFound() : Results.Ok(Status(e));
        });
        deviceApi.MapGet("/agent/events", async (HttpContext http, TaxiDb db, TenantContext tenant) => {
            if (await Device(http, db, tenant, "WINDOWS") is null) return Results.Unauthorized();
            var cutoff = DateTimeOffset.UtcNow.AddMinutes(-5);
            return Results.Ok(await db.Set<OfficeCallEvent>().Where(e => e.GridStatus == "PENDING" && e.Timestamp >= cutoff).OrderBy(e => e.Timestamp).Take(50).Select(e => new { e.EventId, e.Phone, e.Timestamp, e.SourcePackage }).ToArrayAsync());
        });
        deviceApi.MapGet("/agent/devices", async (HttpContext http, TaxiDb db, TenantContext tenant) => {
            if (await Device(http, db, tenant, "WINDOWS") is null) return Results.Unauthorized();
            return Results.Ok(new { officeId = tenant.TenantId, validUntil = DateTimeOffset.UtcNow.AddMinutes(5), devices = await db.Set<OfficeCallDevice>().Where(d => d.Kind == "ANDROID" && d.Approved && !d.Revoked && d.PublicKey != "").Select(d => new { d.Id, d.PublicKey }).ToArrayAsync() });
        });
        deviceApi.MapPost("/agent/ingest", async (OfficeSignedEvent input, HttpContext http, TaxiDb db, TenantContext tenant) => {
            if (await Device(http, db, tenant, "WINDOWS") is null) return Results.Unauthorized();
            var phoneDevice = await db.Set<OfficeCallDevice>().SingleOrDefaultAsync(d => d.Id == input.DeviceId && d.Kind == "ANDROID" && d.Approved && !d.Revoked);
            if (phoneDevice is null || string.IsNullOrEmpty(input.Payload) || string.IsNullOrEmpty(input.Signature) || input.Payload.Length > 4096 || input.Signature.Length > 1024) return Results.Unauthorized();
            OfficeEventInput? call;
            try {
                using var rsa = RSA.Create(); rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(phoneDevice.PublicKey), out _);
                if (!rsa.VerifyData(Encoding.UTF8.GetBytes(input.Payload), Convert.FromBase64String(input.Signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) return Results.Unauthorized();
                call = System.Text.Json.JsonSerializer.Deserialize<OfficeEventInput>(input.Payload, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
            } catch (Exception) { return Results.BadRequest(); }
            if (call is null) return Results.BadRequest(new { code = "EVENT_PAYLOAD_INVALID" });
            var now = DateTimeOffset.UtcNow;
            var phone = OfficePhoneNormalizer.Normalize(call.Phone);
            if (ValidationError(call, phone, now) is { } code) return Results.BadRequest(new { code, serverTime = now });
            if (phone != call.Phone) return Results.BadRequest(new { code = "PHONE_NOT_CANONICAL" });
            call = call with { Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(call.Timestamp.ToUnixTimeMilliseconds()) };
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId + ":" + call.EventId}, 0))");
            var e = await db.Set<OfficeCallEvent>().SingleOrDefaultAsync(e => e.EventId == call.EventId);
            if (e is not null && (e.DeviceId != phoneDevice.Id || e.Phone != call.Phone || e.Timestamp != call.Timestamp || e.SourcePackage != call.SourcePackage)) return Results.Conflict();
            if (e is null) { e = new OfficeCallEvent { DeviceId = phoneDevice.Id, EventId = call.EventId, Phone = call.Phone, SourcePackage = call.SourcePackage, Timestamp = call.Timestamp }; if (!Fresh(call.Timestamp, DateTimeOffset.UtcNow)) { e.DispatchStatus = "EXPIRED"; e.GridStatus = "EXPIRED"; } db.Add(e); db.Add(new AuditLog { ActorId = phoneDevice.Id, EntityId = e.Id, Action = "officecalls.local-event-accepted", Detail = call.EventId }); }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(Status(e));
        });
        deviceApi.MapPost("/agent/events/{eventId}/ack", async (string eventId, OfficeGridAck input, HttpContext http, TaxiDb db, TenantContext tenant) => {
            var d = await Device(http, db, tenant, "WINDOWS"); if (d is null) return Results.Unauthorized();
            if (input.Status is not ("RECEIVER_ACK" or "UDP_SENT" or "FAILED")) return Results.BadRequest();
            var e = await db.Set<OfficeCallEvent>().SingleOrDefaultAsync(e => e.EventId == eventId); if (e is null) return Results.NotFound();
            if (e.GridStatus == "PENDING") {
                e.GridStatus = input.Status == "FAILED" ? "PENDING" : input.Status;
                e.GridError = input.Status == "FAILED" ? (input.Error ?? "AGENT_DELIVERY_FAILED")[..Math.Min(200, (input.Error ?? "AGENT_DELIVERY_FAILED").Length)] : "";
                db.Add(new AuditLog { ActorId = d.Id, EntityId = e.Id, Action = "officecalls.grid-" + input.Status.ToLowerInvariant() }); await db.SaveChangesAsync();
            }
            return Results.Ok(Status(e));
        });
    }
}
