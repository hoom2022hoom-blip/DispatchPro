using System.Diagnostics;
using System.Text.Json;
using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;

public sealed class VoiceLoadTests
{
 [Fact] public async Task FiftyDriversConcurrentFloorsPrivateIsolationAndChurn()
 {
  var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();
  var office=rooms.Join(tenant,Guid.NewGuid(),null,"المكتب",null,true);
  var drivers=Enumerable.Range(0,50).Select(i=>rooms.Join(tenant,Guid.NewGuid(),Guid.NewGuid(),"Driver "+i,i.ToString(),false)).ToArray();
  var timings=new List<double>();var cpu=Process.GetCurrentProcess().TotalProcessorTime;var began=Stopwatch.StartNew();
  for(var round=0;round<50;round++) {
   var attempts=await Task.WhenAll(drivers.Select(p=>Task.Run(()=>{var watch=Stopwatch.StartNew();VoiceFloor? floor=null;try{floor=rooms.Acquire(tenant,p.ActorId,p.Id,"public",null,VoiceAccess.Office,false,Guid.NewGuid());}catch(VoiceBusyException){}return (Floor:floor,Ms:watch.Elapsed.TotalMilliseconds);}))); 
   Assert.Single(attempts,x=>x.Floor!=null);var winner=attempts.Single(x=>x.Floor!=null).Floor!;
   timings.AddRange(attempts.Select(x=>x.Ms));Assert.Single(rooms.View(tenant,office.ActorId,office.Id).Floors);
   var priority=rooms.Acquire(tenant,office.ActorId,office.Id,"public",null,VoiceAccess.Office,false);
   Assert.False(rooms.Heartbeat(tenant,drivers.Single(p=>p.Id==winner.Speaker).ActorId,winner.Speaker,winner.Id,VoiceAccess.Office,false));
   rooms.Release(tenant,office.ActorId,office.Id,priority.Id);
   var d=drivers[round%50];var privateFloor=rooms.Acquire(tenant,d.ActorId,d.Id,"private",null,VoiceAccess.Office,false);
   Assert.True(rooms.Heartbeat(tenant,d.ActorId,d.Id,privateFloor.Id,VoiceAccess.Office,false,true));
   Assert.Empty(rooms.View(tenant,drivers[(round+1)%50].ActorId,drivers[(round+1)%50].Id).Floors);
   rooms.Release(tenant,d.ActorId,d.Id,privateFloor.Id);
  }
  var active=rooms.Acquire(tenant,drivers[0].ActorId,drivers[0].Id,"public",null,VoiceAccess.Office,false);
  rooms.Release(tenant,drivers[1].ActorId,drivers[1].Id,null,true);
  Assert.Equal(active.Id,Assert.Single(rooms.View(tenant,office.ActorId,office.Id).Floors).Id);
  rooms.Release(tenant,drivers[0].ActorId,drivers[0].Id,null,true);Assert.Empty(rooms.View(tenant,office.ActorId,office.Id).Floors);
  timings.Sort();var report=new {kind="in-process floor service simulation; not HTTP or media",drivers=50,simultaneousRounds=50,attempts=timings.Count,p50Ms=timings[timings.Count/2],p95Ms=timings[(int)(timings.Count*.95)],maxMs=timings[^1],elapsedMs=began.Elapsed.TotalMilliseconds,cpuMs=(Process.GetCurrentProcess().TotalProcessorTime-cpu).TotalMilliseconds,workingSetBytes=Process.GetCurrentProcess().WorkingSet64};
  var output=Environment.GetEnvironmentVariable("DISPATCHPRO_VOICE_LOAD_REPORT");if(output!=null)File.WriteAllText(output,JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
 }
 [Fact] public void AttemptReplayAndCrossAppMicrophonesAreRejectedAndHistoryIsAuthorized()
 {
  var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();var actor=Guid.NewGuid();var driver=Guid.NewGuid();
  var d=rooms.Join(tenant,actor,driver,"أحمد",null,false,"driver");var radio=rooms.Join(tenant,actor,driver,"أحمد",null,false,"radio");var office=rooms.Join(tenant,Guid.NewGuid(),null,"المكتب",null,true);var attempt=Guid.NewGuid();
  var floor=rooms.Acquire(tenant,actor,d.Id,"public",null,VoiceAccess.Office,false,attempt);
  Assert.Null(rooms.View(tenant,office.ActorId,office.Id).LastPublicSpeaker);
  Assert.Equal(floor.Id,rooms.Acquire(tenant,actor,d.Id,"public",null,VoiceAccess.Office,false,attempt).Id);
  Assert.Throws<VoiceBusyException>(()=>rooms.Acquire(tenant,actor,radio.Id,"private",null,VoiceAccess.Office,false));
  Assert.True(rooms.Heartbeat(tenant,actor,d.Id,floor.Id,VoiceAccess.Office,false,true));
  Assert.Equal(driver,rooms.View(tenant,office.ActorId,office.Id).LastPublicSpeaker!.DriverId);
  Assert.Null(rooms.View(tenant,actor,d.Id).LastPublicSpeaker);
  rooms.Release(tenant,actor,d.Id,floor.Id);
  Assert.Throws<ArgumentException>(()=>rooms.Acquire(tenant,actor,d.Id,"public",null,VoiceAccess.Office,false,attempt));
  Assert.False(rooms.Heartbeat(tenant,actor,d.Id,floor.Id,VoiceAccess.Office,false,true));
 }
 [Fact] public void OfficePrivateConversationsDoNotOverlapAndPublicOfficePreemptsPrivate()
 {
  var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();var office=rooms.Join(tenant,Guid.NewGuid(),null,"المكتب",null,true);
  var a=rooms.Join(tenant,Guid.NewGuid(),Guid.NewGuid(),"أحمد",null,false);var b=rooms.Join(tenant,Guid.NewGuid(),Guid.NewGuid(),"علي",null,false);
  var first=rooms.Acquire(tenant,a.ActorId,a.Id,"private",null,VoiceAccess.Office,false);
  Assert.Throws<VoiceBusyException>(()=>rooms.Acquire(tenant,b.ActorId,b.Id,"private",null,VoiceAccess.Office,false));
  var own=rooms.Acquire(tenant,office.ActorId,office.Id,"private",b.DriverId,VoiceAccess.Office,false);Assert.Single(rooms.View(tenant,office.ActorId,office.Id).Floors);
  Assert.False(rooms.Heartbeat(tenant,a.ActorId,a.Id,first.Id,VoiceAccess.Office,false));
  Assert.True(rooms.Heartbeat(tenant,office.ActorId,office.Id,own.Id,VoiceAccess.Office,false,true));Assert.Equal(b.DriverId,rooms.View(tenant,office.ActorId,office.Id).LastPrivateSpeaker!.DriverId);
  var publicFloor=rooms.Acquire(tenant,office.ActorId,office.Id,"public",null,VoiceAccess.Office,false);Assert.Equal(publicFloor.Id,Assert.Single(rooms.View(tenant,office.ActorId,office.Id).Floors).Id);
  Assert.Throws<VoiceBusyException>(()=>rooms.Acquire(tenant,a.ActorId,a.Id,"private",null,VoiceAccess.Office,false));
 }
 [Fact] public async Task DirectedSignalsWakeOnlyRecipientWhileFloorsWakeRoom()
 {
  var events=new VoiceEvents();var tenant=Guid.NewGuid();var a=Guid.NewGuid();var b=Guid.NewGuid();
  using var first=events.Subscribe(tenant,a);using var second=events.Subscribe(tenant,b);
  events.PublishTo(a);await first.Changed;Assert.False(second.Changed.IsCompleted);events.Publish(tenant);await second.Changed;
 }
 [Fact] public void LeavingIdleSiblingAppKeepsPrivateConversationUntilLastListenerLeaves()
 {
  var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();var actor=Guid.NewGuid();var driver=Guid.NewGuid();
  var office=rooms.Join(tenant,Guid.NewGuid(),null,"office",null,true);
  var app=rooms.Join(tenant,actor,driver,"driver",null,false,"driver");var radio=rooms.Join(tenant,actor,driver,"driver",null,false,"radio");
  var floor=rooms.Acquire(tenant,office.ActorId,office.Id,"private",driver,VoiceAccess.Office,false);
  rooms.Release(tenant,actor,app.Id,null,true);Assert.Equal(floor.Id,Assert.Single(rooms.View(tenant,actor,radio.Id).Floors).Id);
  rooms.Release(tenant,actor,radio.Id,null,true);Assert.Empty(rooms.View(tenant,office.ActorId,office.Id).Floors);
 }
}
