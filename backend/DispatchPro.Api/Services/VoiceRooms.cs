namespace DispatchPro.Api.Services;

public sealed record VoiceAccess(bool VoiceEnabled, bool CanListen, bool CanTalkPublic, bool CanTalkPrivate, bool IsVoiceBlocked)
{
    public static readonly VoiceAccess Office = new(true, true, true, true, false);
    public bool Talk(bool isPublic, bool publicMuted) => VoiceEnabled && !IsVoiceBlocked && (isPublic ? CanTalkPublic && !publicMuted : CanTalkPrivate);
}
public sealed record VoicePeer(Guid Id, Guid ActorId, Guid? DriverId, string Name, string? Plate, bool Office, bool Multiplexed = false);
public sealed record VoiceFloor(Guid Id, Guid Speaker, Guid? DriverId, string Name, string? Plate, string Channel, DateTimeOffset StartedAt, DateTimeOffset ExpiresAt, long Revision, bool AudioStarted = false, Guid? AttemptId = null);
public sealed record VoiceMessage(Guid From, Guid FloorId, string Kind, string Data, string Channel = "public", Guid WarmSender = default);
public sealed record VoiceSpeaker(Guid DriverId, string Name, string? Plate, DateTimeOffset StartedAt, Guid FloorId);
public sealed record VoiceView(long Revision, VoicePeer Self, VoicePeer[] Peers, VoiceFloor[] Floors, VoiceMessage[] Signals, VoiceSpeaker? LastPublicSpeaker = null, VoiceSpeaker? LastPrivateSpeaker = null, VoiceSpeaker? LastDriverSpeaker = null);

// One process owns the floor for the existing single-office API deployment.
// Each request is authenticated by the API before reaching this service.
public sealed class VoiceRooms(TimeProvider clock, ILogger<VoiceRooms>? logger = null)
{
    private readonly object gate = new();
    private readonly Dictionary<Guid, Room> rooms = new();
    private sealed class Session(VoicePeer peer, DateTimeOffset at, string application)
    {
        public string Application = application;
        public VoicePeer Peer = peer;
        public DateTimeOffset Seen = at;
        public List<VoiceMessage> Messages = new();
        public Dictionary<Guid, Guid> Attempts = new();
    }
    private sealed class Room
    {
        public long Revision;
        public Dictionary<Guid, Session> Sessions = new();
        public Dictionary<string, VoiceFloor> Floors = new();
        public VoiceSpeaker? LastPublicSpeaker;
        public VoiceSpeaker? LastPrivateSpeaker;
        public VoiceSpeaker? LastDriverSpeaker;
    }
    private Room Get(Guid tenant)
    {
        // Bound transient state, including offices that close every client.
        var now = clock.GetUtcNow();
        foreach (var key in rooms.Where(r => r.Value.Sessions.Values.All(s => now - s.Seen > TimeSpan.FromSeconds(35))).Select(r => r.Key).ToArray()) rooms.Remove(key);
        if (!rooms.TryGetValue(tenant, out var room)) rooms[tenant] = room = new();
        Sweep(room);
        return room;
    }
    private void Sweep(Room r)
    {
        var now = clock.GetUtcNow();
        foreach (var id in r.Sessions.Where(s => now - s.Value.Seen > TimeSpan.FromSeconds(35)).Select(s => s.Key).ToArray()) Remove(r, id);
        foreach (var key in r.Floors.Where(f => f.Value.ExpiresAt <= now || !r.Sessions.ContainsKey(f.Value.Speaker)).Select(f => f.Key).ToArray()) { r.Floors.Remove(key); r.Revision++; }
    }
    private static void Remove(Room r, Guid id)
    {
        var leaving = r.Sessions.GetValueOrDefault(id)?.Peer;
        r.Sessions.Remove(id);
        var driverLeft = leaving?.DriverId != null && !r.Sessions.Values.Any(s => s.Peer.DriverId == leaving.DriverId);
        foreach (var key in r.Floors.Where(f => f.Value.Speaker == id || f.Value.Channel != "public" && driverLeft && f.Value.DriverId == leaving!.DriverId).Select(f => f.Key).ToArray()) r.Floors.Remove(key);
        r.Revision++;
    }
    private static Session Owned(Room r, Guid actor, Guid session) => r.Sessions.TryGetValue(session, out var s) && s.Peer.ActorId == actor ? s : throw new UnauthorizedAccessException("Voice session expired");
    public VoicePeer Join(Guid tenant, Guid actor, Guid? driver, string name, string? plate, bool office, string application = "driver", bool multiplexed = false)
    {
        lock (gate)
        {
            var r = Get(tenant);
            // Office tabs and devices keep independent sessions; drivers still replace their previous app session.
            foreach (var id in r.Sessions.Where(s => !office && s.Value.Peer.ActorId == actor && s.Value.Application == application).Select(s => s.Key).ToArray()) Remove(r, id);
            var peer = new VoicePeer(Guid.NewGuid(), actor, driver, name, plate, office, multiplexed);
            r.Sessions[peer.Id] = new(peer, clock.GetUtcNow(), application); r.Revision++; return peer;
        }
    }
    public object DriverState(Guid tenant, Guid driver) {
        lock(gate) {
            var r=Get(tenant);
            var peers=r.Sessions.Values.Where(s=>s.Peer.DriverId==driver).Select(s=>s.Peer.Id).ToHashSet();
            return new { connected=peers.Count>0, talking=r.Floors.Values.Any(f=>peers.Contains(f.Speaker)), channels=r.Floors.Values.Where(f=>peers.Contains(f.Speaker)).Select(f=>f.Channel).ToArray() };
        }
    }
    public VoiceView View(Guid tenant, Guid actor, Guid session)
    {
        lock (gate)
        {
            var r = Get(tenant); var s = Owned(r, actor, session); s.Seen = clock.GetUtcNow();
            var messages = s.Messages.ToArray(); s.Messages.Clear();
            return new(r.Revision, s.Peer, r.Sessions.Values.Select(p => p.Peer).ToArray(), r.Floors.Values.Where(f => f.Channel == "public" || s.Peer.Office || f.DriverId == s.Peer.DriverId).ToArray(), messages, s.Peer.Office ? r.LastPublicSpeaker : null, s.Peer.Office ? r.LastPrivateSpeaker : null, s.Peer.Office ? r.LastDriverSpeaker : null);
        }
    }
    public VoicePeer? Find(Guid tenant, Guid session) { lock (gate) return Get(tenant).Sessions.GetValueOrDefault(session)?.Peer; }
    public VoiceFloor Acquire(Guid tenant, Guid actor, Guid session, string channel, Guid? target, VoiceAccess access, bool muted, Guid? attemptId = null)
    {
        lock (gate)
        {
            var r = Get(tenant); var s = Owned(r, actor, session);
            var isPublic = channel == "public";
            if (channel != "public" && channel != "private") throw new ArgumentException("Invalid voice channel");
            if (!s.Peer.Office && !access.Talk(isPublic, muted)) throw new UnauthorizedAccessException("لا تملك صلاحية الكلام");
            if (attemptId is { } attempt && s.Attempts.TryGetValue(attempt, out var previous))
                return r.Floors.Values.FirstOrDefault(f => f.Id == previous && f.Speaker == session) ?? throw new ArgumentException("محاولة إرسال منتهية؛ حرر الزر واضغط مجددًا");
            // Driver and independent radio share one physical microphone owner.
            if (!s.Peer.Office && r.Floors.Values.Any(f => f.Speaker != session && r.Sessions[f.Speaker].Peer.DriverId == s.Peer.DriverId))
                throw new VoiceBusyException("تطبيقك الآخر");
            var driver = isPublic ? null : s.Peer.Office ? target : s.Peer.DriverId;
            if (!isPublic && (!driver.HasValue || !r.Sessions.Values.Any(p => p.Peer.DriverId == driver && !p.Peer.Office) || !r.Sessions.Values.Any(p => p.Peer.Office))) throw new ArgumentException("الطرف الآخر غير متصل بالمخشيرة");
            var key = isPublic ? "public" : "private:" + driver;
            if (isPublic && !s.Peer.Office && r.Floors.Values.FirstOrDefault(f => f.Channel != "public" && f.Speaker != session) is { } privateBusy)
                throw new VoiceBusyException(privateBusy.Name + " على الخاص");
            if (!isPublic && s.Peer.Office && r.Floors.TryGetValue("public", out var publicBusy) && publicBusy.Speaker != session && r.Sessions[publicBusy.Speaker].Peer.Office) throw new VoiceBusyException(publicBusy.Name);
            if (!isPublic && !s.Peer.Office && r.Floors.TryGetValue("public", out var publicFloor) && publicFloor.Speaker != session)
                throw new VoiceBusyException(publicFloor.Name + " على العام");
            if (!isPublic) {
                var otherPrivate = r.Floors.Values.FirstOrDefault(f => f.Channel != "public" && f.DriverId != driver);
                if (otherPrivate != null && !s.Peer.Office) throw new VoiceBusyException("المكتب في محادثة خاصة");
                if (s.Peer.Office) foreach (var old in r.Floors.Where(f => f.Value.Channel != "public" && f.Value.DriverId != driver).Select(f => f.Key).ToArray()) r.Floors.Remove(old);
            }
            if (r.Floors.TryGetValue(key, out var held) && held.Speaker != session && (!s.Peer.Office || r.Sessions[held.Speaker].Peer.Office)) throw new VoiceBusyException(held.Name);
            if (r.Floors.TryGetValue(key, out held) && held.Speaker == session && (!attemptId.HasValue || held.AttemptId == attemptId)) return held;
            if (!isPublic && s.Peer.Office) r.Floors.Remove("public");
            if (isPublic && s.Peer.Office) foreach (var old in r.Floors.Where(f => f.Value.Channel != "public").Select(f => f.Key).ToArray()) r.Floors.Remove(old);
            // A participant has one microphone and cannot hold two floors.
            foreach (var old in r.Floors.Where(f => f.Value.Speaker == session).Select(f => f.Key).ToArray()) r.Floors.Remove(old);
            var now = clock.GetUtcNow();
            var floor = new VoiceFloor(Guid.NewGuid(), session, driver, s.Peer.Name, s.Peer.Plate, key, now, now.AddSeconds(6), r.Revision + 1, AttemptId: attemptId);
            r.Floors[key] = floor; s.Seen = now; r.Revision++;
            if (attemptId is { } id) { if (s.Attempts.Count >= 128) s.Attempts.Remove(s.Attempts.Keys.First()); s.Attempts[id] = floor.Id; }
            logger?.LogInformation("PTT FloorGranted session={SessionId} attempt={AttemptId} floor={FloorId} utc={Utc}", session, attemptId, floor.Id, now);
            return floor;
        }
    }
    public bool Heartbeat(Guid tenant, Guid actor, Guid session, Guid floor, VoiceAccess access, bool muted, bool audioStarted = false)
    {
        lock (gate)
        {
            var r = Get(tenant); var s = Owned(r, actor, session); s.Seen = clock.GetUtcNow();
            var found = r.Floors.Values.FirstOrDefault(f => f.Id == floor && f.Speaker == session);
            if (found == null) return false;
            if (audioStarted && !found.AudioStarted) logger?.LogInformation("PTT AudioStarted session={SessionId} attempt={AttemptId} floor={FloorId} utc={Utc}", session, found.AttemptId, floor, clock.GetUtcNow());
            if (!s.Peer.Office && !access.Talk(found.Channel == "public", muted)) { r.Floors.Remove(found.Channel); r.Revision++; return false; }
            var conversationDriver = s.Peer.Office ? found.Channel != "public" ? r.Sessions.Values.Select(x => x.Peer).FirstOrDefault(p => p.DriverId == found.DriverId && !p.Office) : null : s.Peer;
            if (audioStarted && conversationDriver?.DriverId is { } driverId) {
                var last = found.Channel == "public" ? r.LastPublicSpeaker : r.LastPrivateSpeaker;
                if (last?.FloorId != found.Id) {
                    var speaker = new VoiceSpeaker(driverId, conversationDriver.Name, conversationDriver.Plate, clock.GetUtcNow(), found.Id);
                    if (!s.Peer.Office) r.LastDriverSpeaker = speaker;
                    if (found.Channel == "public") r.LastPublicSpeaker = speaker; else r.LastPrivateSpeaker = speaker;
                    r.Revision++;
                }
            }
            r.Floors[found.Channel] = found with { ExpiresAt = clock.GetUtcNow().AddSeconds(6), AudioStarted = found.AudioStarted || audioStarted }; return true;
        }
    }
    public long Release(Guid tenant, Guid actor, Guid session, Guid? floor, bool leave = false, Guid? attemptId = null)
    {
        lock (gate)
        {
            var r = Get(tenant); var s = Owned(r, actor, session);
            if (attemptId is { } attempt) {
                floor = s.Attempts.GetValueOrDefault(attempt, Guid.Empty);
                if (s.Attempts.Count >= 128 && !s.Attempts.ContainsKey(attempt)) s.Attempts.Remove(s.Attempts.Keys.First());
                s.Attempts[attempt] = Guid.Empty;
            }
            foreach (var key in r.Floors.Where(f => f.Value.Speaker == session && (!floor.HasValue || f.Value.Id == floor)).Select(f => f.Key).ToArray()) { var released = r.Floors[key]; r.Floors.Remove(key); r.Revision++; logger?.LogInformation("PTT FloorReleased session={SessionId} attempt={AttemptId} floor={FloorId} utc={Utc}", session, released.AttemptId, released.Id, clock.GetUtcNow()); }
            if (attemptId.HasValue) logger?.LogInformation("PTT PressCancelled session={SessionId} attempt={AttemptId} utc={Utc}", session, attemptId, clock.GetUtcNow());
            if (leave) Remove(r, session);
            return r.Revision;
        }
    }
    public void Revoke(Guid tenant, Guid? driver, VoiceAccess? access = null, bool publicOnly = false)
    {
        lock (gate)
        {
            var r = Get(tenant);
            foreach (var key in r.Floors.Where(f => r.Sessions.TryGetValue(f.Value.Speaker, out var s) && !s.Peer.Office && (!driver.HasValue || s.Peer.DriverId == driver) && (publicOnly ? f.Value.Channel == "public" : access == null || !access.Talk(f.Value.Channel == "public", false))).Select(f => f.Key).ToArray()) r.Floors.Remove(key);
            r.Revision++;
        }
    }
    public void Signal(Guid tenant, Guid actor, Guid session, Guid to, Guid floorId, string kind, string data, VoiceAccess fromAccess, VoiceAccess toAccess, bool muted, string channel = "public", Guid warmSender = default)
    {
        lock (gate)
        {
            var r = Get(tenant); var from = Owned(r, actor, session);
            if (!r.Sessions.TryGetValue(to, out var target)) throw new ArgumentException("Voice recipient disconnected");
            if (floorId == Guid.Empty) {
                // Silent transport preparation does not acquire a floor. Old clients
                // ignore empty-floor signals; actual media still requires Acquire.
                if (channel is not ("public" or "private") || kind is not ("offer" or "answer" or "ice") || data.Length > 24000 || target.Messages.Count >= 512)
                    throw new ArgumentException("Invalid prepared voice signal");
                if (warmSender != session && warmSender != to || kind == "offer" && warmSender != session || kind == "answer" && warmSender != to)
                    throw new UnauthorizedAccessException("Invalid preparation sender");
                var sending = warmSender == session ? from : target;
                var listening = warmSender == session ? target : from;
                var talkAccess = warmSender == session ? fromAccess : toAccess;
                var listenAccess = warmSender == session ? toAccess : fromAccess;
                if (!sending.Peer.Office && !talkAccess.Talk(channel == "public", muted) || !listening.Peer.Office && (!listenAccess.VoiceEnabled || !listenAccess.CanListen))
                    throw new UnauthorizedAccessException("Voice preparation permission denied");
                if (channel == "private" && from.Peer.Office == target.Peer.Office)
                    throw new UnauthorizedAccessException("Private preparation requires office and driver");
                target.Messages.Add(new(session, floorId, kind, data, channel, warmSender)); return;
            }
            var f = r.Floors.Values.SingleOrDefault(f => f.Id == floorId) ?? throw new UnauthorizedAccessException("Floor released");
            var speaker = r.Sessions[f.Speaker]; var listener = f.Speaker == session ? target : from;
            var speakerAccess = f.Speaker == session ? fromAccess : toAccess;
            var listenerAccess = f.Speaker == session ? toAccess : fromAccess;
            if (f.Speaker != session && f.Speaker != to || !speaker.Peer.Office && !speakerAccess.Talk(f.Channel == "public", muted) || !listener.Peer.Office && (!listenerAccess.VoiceEnabled || !listenerAccess.CanListen)) throw new UnauthorizedAccessException("Voice permission denied");
            if (f.Channel != "public" && !listener.Peer.Office && listener.Peer.DriverId != f.DriverId) throw new UnauthorizedAccessException("Private recipient mismatch");
            if (kind is not ("offer" or "answer" or "ice") || kind == "offer" && f.Speaker != session || kind == "answer" && f.Speaker == session || data.Length > 24000 || target.Messages.Count >= 512) throw new ArgumentException("Invalid voice signal");
            target.Messages.Add(new(session, floorId, kind, data));
        }
    }
}
public sealed class VoiceBusyException(string name) : Exception("الموجة مشغولة - " + name + " يتحدث");
public sealed class VoiceEvents
{
    private readonly NotificationSignal changes = new();
    private readonly NotificationSignal targeted = new();
    public NotificationSignal.Subscription Subscribe(Guid tenant) => changes.Subscribe(tenant);
    public NotificationSignal.Subscription Subscribe(Guid tenant, Guid session) {
        var room = changes.Subscribe(tenant); var direct = targeted.Subscribe(session);
        return new NotificationSignal.Subscription(Task.WhenAny(room.Changed, direct.Changed), () => { room.Dispose(); direct.Dispose(); });
    }
    public void Publish(Guid tenant) => changes.Publish(tenant);
    public void PublishTo(Guid session) => targeted.Publish(session);
}
