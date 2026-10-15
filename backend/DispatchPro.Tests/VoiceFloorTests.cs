using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;

public sealed class VoiceFloorTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Fixture
    {
        public readonly Clock Clock = new();
        public readonly VoiceRooms Rooms;
        public readonly Guid Tenant = Guid.NewGuid();
        public readonly VoicePeer A, B, Office;
        public Fixture()
        {
            Rooms = new(Clock);
            A = Rooms.Join(Tenant, Guid.NewGuid(), Guid.NewGuid(), "أحمد", "9", false);
            B = Rooms.Join(Tenant, Guid.NewGuid(), Guid.NewGuid(), "علي", "10", false);
            Office = Rooms.Join(Tenant, Guid.NewGuid(), null, "المكتب", null, true);
        }
        public VoiceFloor Take(VoicePeer p, string channel = "public", Guid? target = null, VoiceAccess? access = null, bool muted = false) => Rooms.Acquire(Tenant, p.ActorId, p.Id, channel, target, access ?? VoiceAccess.Office, muted);
        public VoiceView View(VoicePeer p) => Rooms.View(Tenant, p.ActorId, p.Id);
    }
    [Fact] public void OfficeTabsKeepIndependentSessionsWithoutDuplicatingThePublicFloor()
    {
        var f = new Fixture();
        var held = f.Take(f.Office);
        var other = f.Rooms.Join(f.Tenant, f.Office.ActorId, null, f.Office.Name, null, true);
        Assert.Contains(f.View(f.Office).Peers, p => p.Id == other.Id);
        Assert.Contains(f.View(other).Peers, p => p.Id == f.Office.Id);
        Assert.Equal(held.Id, Assert.Single(f.View(other).Floors).Id);
        Assert.Throws<VoiceBusyException>(() => f.Take(other));
        f.Rooms.Release(f.Tenant, f.Office.ActorId, f.Office.Id, held.Id, leave: true);
        Assert.DoesNotContain(f.View(other).Peers, p => p.Id == f.Office.Id);
        Assert.NotNull(f.Take(other));
    }
    [Fact] public void OfficeIdlePollingKeepsItsSessionAcrossRepeatedLongPollIntervals()
    {
        var f = new Fixture();
        for (var i = 0; i < 20; i++)
        {
            f.Clock.Now += TimeSpan.FromSeconds(25);
            Assert.Equal(f.Office.Id, f.View(f.Office).Self.Id);
        }
    }
    [Fact] public void ExpiredOfficeSessionAndFloorDoNotBlockAnotherTabOrItsRejoin()
    {
        var f = new Fixture();
        var observer = f.Rooms.Join(f.Tenant, f.Office.ActorId, null, f.Office.Name, null, true);
        var floor = f.Take(f.Office);
        f.Clock.Now += TimeSpan.FromSeconds(7);
        Assert.DoesNotContain(f.View(observer).Floors, p => p.Id == floor.Id);
        f.Clock.Now += TimeSpan.FromSeconds(25);
        f.View(observer);
        f.Clock.Now += TimeSpan.FromSeconds(4);
        Assert.Throws<UnauthorizedAccessException>(() => f.View(f.Office));
        var next = f.Rooms.Join(f.Tenant, f.Office.ActorId, null, f.Office.Name, null, true);
        Assert.NotEqual(f.Office.Id, next.Id);
        Assert.Contains(f.View(observer).Peers, p => p.Id == next.Id);
        Assert.NotNull(f.Take(next));
    }
    [Fact] public async Task OnlyOneConcurrentPublicSpeakerWins()
    {
        var f = new Fixture();
        var outcomes = await Task.WhenAll(new[] { f.A, f.B }.Select(p => Task.Run(() => { try { return f.Take(p); } catch (VoiceBusyException) { return null; } })));
        Assert.Single(outcomes, x => x != null); Assert.Single(f.View(f.Office).Floors);
    }
    [Fact] public void OfficePreemptsDriverAndStaleReleaseCannotReleaseNewFloor()
    {
        var f = new Fixture(); var first = f.Take(f.A); var office = f.Take(f.Office);
        Assert.False(f.Rooms.Heartbeat(f.Tenant, f.A.ActorId, f.A.Id, first.Id, VoiceAccess.Office, false));
        f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, first.Id);
        Assert.Equal(office.Id, Assert.Single(f.View(f.B).Floors).Id);
        Assert.Throws<VoiceBusyException>(() => f.Take(f.B));
    }
    [Fact] public void LeaseExpiresOnInternetLossAndHeartbeatExtendsOnlyCurrentFloor()
    {
        var f = new Fixture(); var floor = f.Take(f.A); f.Clock.Now = f.Clock.Now.AddSeconds(4);
        Assert.True(f.Rooms.Heartbeat(f.Tenant, f.A.ActorId, f.A.Id, floor.Id, VoiceAccess.Office, false));
        f.Clock.Now = f.Clock.Now.AddSeconds(4); Assert.Single(f.View(f.B).Floors);
        f.Clock.Now = f.Clock.Now.AddSeconds(3); Assert.Empty(f.View(f.B).Floors);
        Assert.False(f.Rooms.Heartbeat(f.Tenant, f.A.ActorId, f.A.Id, floor.Id, VoiceAccess.Office, false));
        Assert.NotNull(f.Take(f.B));
    }
    [Fact] public void ReleaseAndAppCloseFreeFloorImmediately()
    {
        var f = new Fixture(); var floor = f.Take(f.A); f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, floor.Id);
        Assert.Empty(f.View(f.B).Floors); f.Take(f.A); f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, null, true);
        Assert.Empty(f.View(f.B).Floors); Assert.DoesNotContain(f.View(f.B).Peers, p => p.Id == f.A.Id);
    }
    [Fact] public void DuplicateLoginReplacesOldAudioSessionAndFreesFloor()
    {
        var f = new Fixture(); f.Take(f.A);
        var replacement = f.Rooms.Join(f.Tenant, f.A.ActorId, f.A.DriverId, f.A.Name, f.A.Plate, false);
        Assert.Empty(f.View(f.B).Floors); Assert.Throws<UnauthorizedAccessException>(() => f.View(f.A));
        Assert.Single(f.View(f.B).Peers, p => p.ActorId == f.A.ActorId);
        Assert.NotNull(f.Take(replacement));
    }
    [Fact] public void DriverIdentityAndTenantCannotBeForged()
    {
        var f = new Fixture();
        Assert.Throws<UnauthorizedAccessException>(() => f.Rooms.Acquire(f.Tenant, f.B.ActorId, f.A.Id, "public", null, VoiceAccess.Office, false));
        Assert.Throws<UnauthorizedAccessException>(() => f.Rooms.View(Guid.NewGuid(), f.A.ActorId, f.A.Id));
        var privateFloor = f.Take(f.A, "private", f.B.DriverId);
        Assert.Equal(f.A.DriverId, privateFloor.DriverId);
    }
    [Fact] public void PrivateAudioSignalsCannotReachAnotherDriver()
    {
        var f = new Fixture(); var floor = f.Take(f.Office, "private", f.A.DriverId);
        Assert.Empty(f.View(f.B).Floors);
        Assert.Throws<UnauthorizedAccessException>(() => f.Rooms.Signal(f.Tenant, f.Office.ActorId, f.Office.Id, f.B.Id, floor.Id, "offer", "{}", VoiceAccess.Office, VoiceAccess.Office, false));
        f.Rooms.Signal(f.Tenant, f.Office.ActorId, f.Office.Id, f.A.Id, floor.Id, "offer", "{}", VoiceAccess.Office, VoiceAccess.Office, false);
        Assert.Single(f.View(f.A).Signals); Assert.Empty(f.View(f.B).Signals);
    }
    [Fact] public void ListenOnlyPrivateOnlyFullBlockAndQuickBlockAreEnforced()
    {
        var f = new Fixture(); var listen = new VoiceAccess(true, true, false, false, false); var privateOnly = listen with { CanTalkPrivate = true };
        Assert.Throws<UnauthorizedAccessException>(() => f.Take(f.A, access: listen));
        Assert.Throws<UnauthorizedAccessException>(() => f.Take(f.A, "private", access: listen));
        Assert.Throws<UnauthorizedAccessException>(() => f.Take(f.A, access: privateOnly));
        var floor = f.Take(f.A, "private", access: privateOnly); Assert.Equal(f.A.DriverId, floor.DriverId);
        var blocked = VoiceAccess.Office with { IsVoiceBlocked = true };
        f.Rooms.Revoke(f.Tenant, f.A.DriverId, blocked); Assert.Empty(f.View(f.Office).Floors);
        Assert.Throws<UnauthorizedAccessException>(() => f.Take(f.A, access: blocked));
        var office = f.Take(f.Office); f.Rooms.Signal(f.Tenant, f.Office.ActorId, f.Office.Id, f.A.Id, office.Id, "offer", "{}", VoiceAccess.Office, blocked, false);
        Assert.Single(f.View(f.A).Signals);
        Assert.Throws<UnauthorizedAccessException>(() => f.Rooms.Signal(f.Tenant, f.Office.ActorId, f.Office.Id, f.A.Id, office.Id, "offer", "{}", VoiceAccess.Office, blocked with { VoiceEnabled = false }, false));
        f.Rooms.Release(f.Tenant, f.Office.ActorId, f.Office.Id, office.Id); Assert.NotNull(f.Take(f.A));
    }
    [Fact] public void GlobalMutePreservesPrivateAndOfficePermissions()
    {
        var f = new Fixture(); f.Take(f.A); f.Rooms.Revoke(f.Tenant, null, publicOnly: true);
        Assert.Empty(f.View(f.Office).Floors); Assert.Throws<UnauthorizedAccessException>(() => f.Take(f.A, muted: true));
        Assert.NotNull(f.Take(f.A, "private", muted: true)); Assert.NotNull(f.Take(f.Office, muted: true));
    }
    [Fact] public void BlockingDuringSpeechRevokesHeartbeatsAndSignaling()
    {
        var f = new Fixture(); var floor = f.Take(f.A); var blocked = VoiceAccess.Office with { CanTalkPublic = false };
        Assert.False(f.Rooms.Heartbeat(f.Tenant, f.A.ActorId, f.A.Id, floor.Id, blocked, false));
        Assert.Empty(f.View(f.B).Floors);
        Assert.Throws<UnauthorizedAccessException>(() => f.Rooms.Signal(f.Tenant, f.A.ActorId, f.A.Id, f.B.Id, floor.Id, "offer", "{}", blocked, VoiceAccess.Office, false));
    }
    [Fact] public void PrivateFloorEndsWhenTargetDriverClosesApp()
    {
        var f = new Fixture(); f.Take(f.Office, "private", f.A.DriverId);
        f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, null, true);
        Assert.Empty(f.View(f.Office).Floors);
    }
    [Fact] public void HundredDriversShareOneFloorAndSignalsRemainRecipientScoped()
    {
        var f = new Fixture(); var peers = Enumerable.Range(0,100).Select(i => f.Rooms.Join(f.Tenant, Guid.NewGuid(), Guid.NewGuid(), "Driver " + i, i.ToString(), false)).ToArray();
        var floor = f.Take(f.Office);
        foreach (var p in peers) f.Rooms.Signal(f.Tenant, f.Office.ActorId, f.Office.Id, p.Id, floor.Id, "offer", p.Name, VoiceAccess.Office, VoiceAccess.Office, false);
        foreach (var p in peers) { var view = f.View(p); Assert.Single(view.Floors); Assert.Equal(p.Name, Assert.Single(view.Signals).Data); }
    }
    [Fact] public void LastActualDriverRequiresAudioAndOfficeReplyCannotReplaceIt()
    {
        var f=new Fixture();var silent=f.Take(f.A);Assert.Null(f.View(f.Office).LastDriverSpeaker);
        f.Rooms.Heartbeat(f.Tenant,f.A.ActorId,f.A.Id,silent.Id,VoiceAccess.Office,false,false);Assert.Null(f.View(f.Office).LastDriverSpeaker);
        f.Rooms.Heartbeat(f.Tenant,f.A.ActorId,f.A.Id,silent.Id,VoiceAccess.Office,false,true);Assert.Equal(f.A.DriverId,f.View(f.Office).LastDriverSpeaker!.DriverId);
        f.Rooms.Release(f.Tenant,f.A.ActorId,f.A.Id,silent.Id);var reply=f.Take(f.Office,"private",f.B.DriverId);
        f.Rooms.Heartbeat(f.Tenant,f.Office.ActorId,f.Office.Id,reply.Id,VoiceAccess.Office,false,true);Assert.Equal(f.A.DriverId,f.View(f.Office).LastDriverSpeaker!.DriverId);Assert.Null(f.View(f.B).LastDriverSpeaker);
        f.Rooms.Release(f.Tenant,f.Office.ActorId,f.Office.Id,reply.Id);var privateDriver=f.Take(f.B,"private");f.Rooms.Heartbeat(f.Tenant,f.B.ActorId,f.B.Id,privateDriver.Id,VoiceAccess.Office,false,true);Assert.Equal(f.B.DriverId,f.View(f.Office).LastDriverSpeaker!.DriverId);
    }
    [Fact] public void CancellationBeforeGrantPreventsLateAcquisitionAndDoesNotReleaseNextPress()
    {
        var f = new Fixture(); var cancelled = Guid.NewGuid();
        f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, null, attemptId: cancelled);
        Assert.Throws<ArgumentException>(() => f.Rooms.Acquire(f.Tenant, f.A.ActorId, f.A.Id, "public", null, VoiceAccess.Office, false, cancelled));
        var next = f.Rooms.Acquire(f.Tenant, f.A.ActorId, f.A.Id, "private", null, VoiceAccess.Office, false, Guid.NewGuid());
        f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, null, attemptId: cancelled);
        Assert.Equal(next.Id, Assert.Single(f.View(f.Office).Floors).Id);
    }
    [Fact] public void CancelAfterGrantReleasesOnlyMatchingAttemptAndRetryCannotReacquire()
    {
        var f = new Fixture(); var attempt = Guid.NewGuid();
        var first = f.Rooms.Acquire(f.Tenant, f.A.ActorId, f.A.Id, "public", null, VoiceAccess.Office, false, attempt);
        Assert.Equal(first.Id, f.Rooms.Acquire(f.Tenant, f.A.ActorId, f.A.Id, "public", null, VoiceAccess.Office, false, attempt).Id);
        f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, null, attemptId: attempt);
        Assert.Empty(f.View(f.Office).Floors);
        Assert.Throws<ArgumentException>(() => f.Rooms.Acquire(f.Tenant, f.A.ActorId, f.A.Id, "public", null, VoiceAccess.Office, false, attempt));
    }
    [Fact] public void OfficePrivatePreemptsPublicAndOtherDriversCannotInterruptPrivate()
    {
        var f = new Fixture(); var publicFloor = f.Take(f.B);
        var privateFloor = f.Take(f.Office, "private", f.A.DriverId);
        Assert.Equal(privateFloor.Id, Assert.Single(f.View(f.Office).Floors).Id);
        Assert.False(f.Rooms.Heartbeat(f.Tenant, f.B.ActorId, f.B.Id, publicFloor.Id, VoiceAccess.Office, false));
        Assert.Throws<VoiceBusyException>(() => f.Take(f.B));
        f.Rooms.Release(f.Tenant, f.Office.ActorId, f.Office.Id, privateFloor.Id);
        Assert.NotNull(f.Take(f.B));
    }
    [Fact] public async Task ConcurrentCancellationAlwaysLeavesNoFloor()
    {
        var f = new Fixture();
        for (var i = 0; i < 20; i++) {
            var attempt = Guid.NewGuid();
            await Task.WhenAll(Task.Run(() => { try { f.Rooms.Acquire(f.Tenant, f.A.ActorId, f.A.Id, "public", null, VoiceAccess.Office, false, attempt); } catch (ArgumentException) { } }), Task.Run(() => f.Rooms.Release(f.Tenant, f.A.ActorId, f.A.Id, null, attemptId: attempt)));
            Assert.Empty(f.View(f.Office).Floors);
        }
    }
    [Fact] public void NewPressCannotInheritOldLeaseAndLateCancelCannotReleaseIt()
    {
        var f=new Fixture();var oldAttempt=Guid.NewGuid();var nextAttempt=Guid.NewGuid();
        var old=f.Rooms.Acquire(f.Tenant,f.A.ActorId,f.A.Id,"public",null,VoiceAccess.Office,false,oldAttempt);
        var next=f.Rooms.Acquire(f.Tenant,f.A.ActorId,f.A.Id,"public",null,VoiceAccess.Office,false,nextAttempt);
        Assert.NotEqual(old.Id,next.Id);Assert.Equal(nextAttempt,next.AttemptId);
        f.Rooms.Release(f.Tenant,f.A.ActorId,f.A.Id,null,attemptId:oldAttempt);
        Assert.Equal(next.Id,Assert.Single(f.View(f.Office).Floors).Id);
    }
    [Fact] public void DriverPrivateCannotSilenceOfficeReceptionOfAnotherPublicSpeaker()
    {
        var f=new Fixture();var broadcasting=f.Take(f.B);
        Assert.Throws<VoiceBusyException>(()=>f.Take(f.A,"private"));
        Assert.Equal(broadcasting.Id,Assert.Single(f.View(f.Office).Floors).Id);
        f.Rooms.Release(f.Tenant,f.B.ActorId,f.B.Id,broadcasting.Id);
        Assert.NotNull(f.Take(f.A,"private"));
    }
}
