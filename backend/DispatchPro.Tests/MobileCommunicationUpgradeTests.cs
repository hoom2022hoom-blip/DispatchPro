using DispatchPro.Api.Services;
using FirebaseAdmin.Messaging;
using Xunit;
namespace DispatchPro.Tests;

public sealed class MobileCommunicationUpgradeTests
{
    [Theory]
    [InlineData("ARRIVED")]
    [InlineData("CALL")]
    public void BoundVisiblePushCanRenderWithoutNetworkAndContainsNoSessionSecrets(string type)
    {
        var now=DateTimeOffset.UtcNow;var ride=Guid.NewGuid();var actor=Guid.NewGuid();var installation=Guid.NewGuid();
        var message=FirebaseCustomerPushSender.EventMessage("test-token",installation,actor,Guid.NewGuid(),type,ride,new("أحمد",now,now.AddSeconds(30)));
        Assert.Null(message.Notification);Assert.Equal(Priority.High,message.Android.Priority);
        Assert.Equal("1",message.Data["displayVersion"]);Assert.Equal("أحمد",message.Data["peerName"]);
        Assert.Equal(ride.ToString(),message.Data["rideId"]);Assert.Equal(actor.ToString(),message.Data["recipient"]);
        Assert.InRange(message.Android.TimeToLive!.Value.TotalSeconds,1,30);
        Assert.DoesNotContain("token",message.Data.Keys);Assert.DoesNotContain("accessToken",message.Data.Keys);
        Assert.Equal(now.ToUnixTimeMilliseconds().ToString(),message.Data["createdAt"]);
    }
    [Fact] public void WarmSignalingDoesNotOwnFloorAndPreservesOfficePreemption()
    {
        var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();
        var driver=rooms.Join(tenant,Guid.NewGuid(),Guid.NewGuid(),"السائق",null,false);
        var office=rooms.Join(tenant,Guid.NewGuid(),null,"المكتب",null,true);
        rooms.Signal(tenant,driver.ActorId,driver.Id,office.Id,Guid.Empty,"offer","{}",VoiceAccess.Office,VoiceAccess.Office,false,"private",driver.Id);
        var view=rooms.View(tenant,office.ActorId,office.Id);
        Assert.Empty(view.Floors);Assert.Equal(driver.Id,Assert.Single(view.Signals).WarmSender);
        rooms.Signal(tenant,office.ActorId,office.Id,driver.Id,Guid.Empty,"answer","{}",VoiceAccess.Office,VoiceAccess.Office,false,"private",driver.Id);
        var held=rooms.Acquire(tenant,driver.ActorId,driver.Id,"public",null,VoiceAccess.Office,false);
        var takeover=rooms.Acquire(tenant,office.ActorId,office.Id,"public",null,VoiceAccess.Office,false);
        rooms.Release(tenant,driver.ActorId,driver.Id,held.Id);
        Assert.Equal(takeover.Id,Assert.Single(rooms.View(tenant,driver.ActorId,driver.Id).Floors).Id);
    }
    [Fact] public void PreparedPrivateChannelsCannotReachAnotherDriverOrBypassPermissions()
    {
        var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();
        var a=rooms.Join(tenant,Guid.NewGuid(),Guid.NewGuid(),"أ",null,false);
        var b=rooms.Join(tenant,Guid.NewGuid(),Guid.NewGuid(),"ب",null,false);
        var office=rooms.Join(tenant,Guid.NewGuid(),null,"المكتب",null,true);
        Assert.Throws<UnauthorizedAccessException>(()=>rooms.Signal(tenant,a.ActorId,a.Id,b.Id,Guid.Empty,"offer","{}",VoiceAccess.Office,VoiceAccess.Office,false,"private",a.Id));
        var listenOnly=VoiceAccess.Office with{CanTalkPublic=false,CanTalkPrivate=false};
        Assert.Throws<UnauthorizedAccessException>(()=>rooms.Signal(tenant,a.ActorId,a.Id,office.Id,Guid.Empty,"offer","{}",listenOnly,VoiceAccess.Office,false,"public",a.Id));
        Assert.Throws<UnauthorizedAccessException>(()=>rooms.Signal(tenant,a.ActorId,a.Id,office.Id,Guid.Empty,"ice","{}",VoiceAccess.Office,VoiceAccess.Office,false,"public",b.Id));
        Assert.Throws<UnauthorizedAccessException>(()=>rooms.Signal(tenant,office.ActorId,office.Id,a.Id,Guid.Empty,"offer","{}",VoiceAccess.Office,VoiceAccess.Office with{CanListen=false},false,"public",office.Id));
        Assert.Empty(rooms.View(tenant,b.ActorId,b.Id).Signals);
    }
}
