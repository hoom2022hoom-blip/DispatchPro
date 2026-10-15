using System.Security.Claims;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Endpoints;

public sealed record VoiceAction(Guid SessionId, Guid? FloorId, string Channel = "public", Guid? DriverId = null, bool Leave = false, Guid? AttemptId = null, bool AudioStarted = false);
public sealed record VoiceJoinInput(bool Multiplexed = false);
public sealed record VoiceSignalInput(Guid SessionId, Guid To, Guid FloorId, string Kind, string Data, string Channel = "public", Guid WarmSender = default);
public sealed record VoiceMuteInput(bool Muted);
public sealed record VoiceShortcutInput(string Code);
public sealed record VoicePermissionInput(bool VoiceEnabled, bool CanListen, bool CanTalkPublic, bool CanTalkPrivate, bool IsVoiceBlocked);
public sealed class VoiceIceServer { public string[] Urls { get; set; } = []; public string? Username { get; set; } public string? Credential { get; set; } }
public static class VoiceEndpoints
{
    public static bool ValidShortcut(string? code) => code is "F1" or "F2" or "F3" or "F4" or "F8" or "F9" or "Space" or "ControlLeft" or "ControlRight" or "AltLeft" or "AltRight";
    public static VoiceAccess Access(Driver d) => new(d.VoiceEnabled, d.CanListen, d.CanTalkPublic, d.CanTalkPrivate, d.IsVoiceBlocked);
    private static bool Office(HttpContext h) => h.User.HasClaim("permission", "rides.write") && h.User.HasClaim("permission", "rides.read");
    private static async Task<VoiceAccess?> Current(HttpContext h, TaxiDb db, TenantContext tenant) => Office(h) ? VoiceAccess.Office : h.User.HasClaim("permission", "rides.drive") && await DriverEndpoints.CurrentDriver(db, tenant) is { } d ? Access(d) : null;
    private static Task<bool> Muted(TaxiDb db) => db.Set<FeatureFlag>().AnyAsync(f => f.Key == "VoicePublicMuted" && f.Enabled);
    private static async Task<VoiceAccess> SessionAccess(Guid sessionId, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms)
    {
        // Resolve the authenticated driver once per control request; Current()
        // followed by CurrentDriver() used to repeat the same database lookup.
        var office = Office(h);
        var driver = office || !h.User.HasClaim("permission", "rides.drive") ? null : await DriverEndpoints.CurrentDriver(db, tenant);
        var access = office ? VoiceAccess.Office : driver == null ? null : Access(driver);
        var peer = rooms.Find(tenant.TenantId, sessionId);
        if (access == null || peer == null || peer.ActorId != tenant.ActorId || peer.Office != office || peer.DriverId != driver?.Id)
            throw new UnauthorizedAccessException("Voice session identity changed; reconnect");
        return access;
    }
    public static void MapVoice(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/voice").RequireAuthorization();
        // Existing immutable audit settings: scoped by tenant filter and authenticated actor.
        // No schema change, no browser-only preferences and no client-supplied user identity.
        api.MapGet("/shortcut", async (HttpContext h, TaxiDb db, TenantContext tenant) => {
            if (!Office(h)) return Results.Forbid();
            var code = await db.Set<AuditLog>().AsNoTracking().Where(a => a.EntityId == tenant.ActorId && a.ActorId == tenant.ActorId && a.Action == "voice.shortcut").OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Select(a => a.Detail).FirstOrDefaultAsync();
            return Results.Ok(new { code = ValidShortcut(code) ? code : "F1" });
        });
        api.MapPut("/shortcut", async (VoiceShortcutInput input, HttpContext h, TaxiDb db, TenantContext tenant, ReceptionService reception) => {
            if (!Office(h)) return Results.Forbid();
            if (!ValidShortcut(input.Code)) return Results.BadRequest(new { error = "هذا الاختصار محجوز، اختر زرًا آخر" });
            await using var transaction = await db.Database.BeginTransactionAsync(); await reception.Lock();
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = tenant.ActorId, Action = "voice.shortcut", Detail = input.Code });
            await db.SaveChangesAsync(); await transaction.CommitAsync(); return Results.Ok(new { code = input.Code });
        });
        api.AddEndpointFilter(async (context, next) => {
            try { return await next(context); }
            catch (UnauthorizedAccessException e) { return Results.Json(new { error = e.Message }, statusCode: 403); }
            catch (VoiceBusyException e) { return Results.Conflict(new { error = e.Message }); }
            catch (ArgumentException e) { return Results.BadRequest(new { error = e.Message }); }
        });
        api.MapPost("/session", async (VoiceJoinInput? input, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal, IConfiguration config) => {
            var access = await Current(h, db, tenant); if (access == null || !access.VoiceEnabled) return Results.Forbid();
            var driver = Office(h) ? null : await DriverEndpoints.CurrentDriver(db, tenant);
            var plate = driver?.CurrentVehicleId is { } v ? await db.Set<Vehicle>().Where(x => x.Id == v).Select(x => x.Plate).SingleOrDefaultAsync() : null;
            var name = driver?.FullName ?? await db.Set<User>().Where(u => u.Id == tenant.ActorId).Select(u => u.Username).SingleAsync();
            var peer = rooms.Join(tenant.TenantId, tenant.ActorId, driver?.Id, name, plate, Office(h), h.User.FindFirstValue("mobile_app") ?? "driver", input?.Multiplexed ?? false); signal.Publish(tenant.TenantId);
            // TURN credentials are deployment configuration, never a hard-coded account.
            var ice = config.GetSection("Voice:IceServers").Get<VoiceIceServer[]>() ?? [];
            return Results.Ok(new { peer, access, publicMuted = await Muted(db), iceServers = ice, preparedTransport = true, multiplexedTransport = peer.Multiplexed, cancellableFloor = true });
        });
        api.MapGet("/updates", async (Guid sessionId, long? revision, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal) => {
            await SessionAccess(sessionId, h, db, tenant, rooms);
            using var subscription = signal.Subscribe(tenant.TenantId, sessionId);
            var view = rooms.View(tenant.TenantId, tenant.ActorId, sessionId);
            if (revision == view.Revision && view.Signals.Length == 0) {
                var untilExpiry = view.Floors.Length == 0 ? TimeSpan.FromSeconds(25) : view.Floors.Min(f => f.ExpiresAt) - DateTimeOffset.UtcNow;
                await Task.WhenAny(subscription.Changed, Task.Delay(untilExpiry > TimeSpan.Zero ? untilExpiry : TimeSpan.FromMilliseconds(1), h.RequestAborted));
                h.RequestAborted.ThrowIfCancellationRequested();
                view = rooms.View(tenant.TenantId, tenant.ActorId, sessionId);
            }
            var access = await SessionAccess(sessionId, h, db, tenant, rooms);
            var selfDriver=Office(h)?null:await DriverEndpoints.CurrentDriver(db,tenant);
            var listeningDrivers = await db.Set<Driver>().Where(d => d.Active && d.VoiceEnabled && d.CanListen).Select(d => d.Id).ToListAsync(h.RequestAborted);
            var speakers = view.Floors.Select(f => f.Speaker).ToHashSet();
            var peers = view.Peers.Where(p => p.Office || p.Id == sessionId || p.DriverId != selfDriver?.Id && (speakers.Contains(p.Id) || p.DriverId.HasValue && listeningDrivers.Contains(p.DriverId.Value)));
            return Results.Ok(new { view.Revision, view.Self, peers, view.Floors, view.Signals, view.LastPublicSpeaker, view.LastPrivateSpeaker, view.LastDriverSpeaker, access, publicMuted = await Muted(db), serverTime = DateTimeOffset.UtcNow });
        });
        api.MapPost("/floor", async (VoiceAction input, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal) => {
            var access = await SessionAccess(input.SessionId, h, db, tenant, rooms);
            if (input.Channel == "private" && Office(h)) {
                var d = await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == input.DriverId && d.Active);
                if (d == null || !d.VoiceEnabled || !d.CanListen) return Results.Forbid();
            }
            var floor = rooms.Acquire(tenant.TenantId, tenant.ActorId, input.SessionId, input.Channel, input.DriverId, access, await Muted(db), input.AttemptId); signal.Publish(tenant.TenantId); return Results.Ok(floor);
        });
        api.MapPost("/heartbeat", async (VoiceAction input, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal) => {
            var access = await SessionAccess(input.SessionId, h, db, tenant, rooms); if (input.FloorId == null) return Results.Forbid();
            var held = rooms.Heartbeat(tenant.TenantId, tenant.ActorId, input.SessionId, input.FloorId.Value, access, await Muted(db), input.AudioStarted); signal.Publish(tenant.TenantId); return Results.Ok(new { held });
        });
        api.MapPost("/release", (VoiceAction input, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal) => {
            var revision = rooms.Release(tenant.TenantId, tenant.ActorId, input.SessionId, input.FloorId, input.Leave, input.AttemptId); signal.Publish(tenant.TenantId); return Results.Ok(new { released = true, revision });
        });
        api.MapPost("/signal", async (VoiceSignalInput input, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal) => {
            var access = await SessionAccess(input.SessionId, h, db, tenant, rooms);
            var target = rooms.Find(tenant.TenantId, input.To); if (target == null) return Results.NotFound();
            var d = target.DriverId.HasValue ? await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == target.DriverId && d.Active) : null;
            var targetAccess = target.Office ? VoiceAccess.Office : d == null ? new VoiceAccess(false, false, false, false, true) : Access(d);
            rooms.Signal(tenant.TenantId, tenant.ActorId, input.SessionId, input.To, input.FloorId, input.Kind, input.Data, access, targetAccess, await Muted(db), input.Channel, input.WarmSender); signal.PublishTo(input.To); return Results.Ok(new { sent = true });
        });
        api.MapPut("/drivers/{id:guid}", async (Guid id, VoicePermissionInput input, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal) => {
            if (!Office(h)) return Results.Forbid();
            var d = await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == id); if (d == null) return Results.NotFound();
            d.VoiceEnabled = input.VoiceEnabled; d.CanListen = input.CanListen; d.CanTalkPublic = input.CanTalkPublic; d.CanTalkPrivate = input.CanTalkPrivate; d.IsVoiceBlocked = input.IsVoiceBlocked;
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = d.Id, Action = "voice.permissions", Detail = System.Text.Json.JsonSerializer.Serialize(input) });
            await db.SaveChangesAsync(); rooms.Revoke(tenant.TenantId, d.Id, Access(d)); signal.Publish(tenant.TenantId); return Results.Ok(Access(d));
        });
        api.MapPut("/settings", async (VoiceMuteInput input, HttpContext h, TaxiDb db, TenantContext tenant, VoiceRooms rooms, VoiceEvents signal, ReceptionService reception) => {
            if (!Office(h)) return Results.Forbid();
            await using var transaction = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var flag = await db.Set<FeatureFlag>().SingleOrDefaultAsync(f => f.Key == "VoicePublicMuted");
            if (flag == null) { flag = new FeatureFlag { Key = "VoicePublicMuted" }; db.Add(flag); } flag.Enabled = input.Muted;
            db.Add(new AuditLog { ActorId = tenant.ActorId, Action = "voice.publicMute", Detail = input.Muted.ToString() });
            await db.SaveChangesAsync(); await transaction.CommitAsync(); if (input.Muted) rooms.Revoke(tenant.TenantId, null, publicOnly: true); signal.Publish(tenant.TenantId); return Results.Ok(new { publicMuted = input.Muted });
        });
    }
}
