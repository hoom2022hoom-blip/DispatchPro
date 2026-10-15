using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;
public sealed class NotificationSignalTests
{
 [Fact]
 public void TenantWritesDoNotWakeOtherOfficesAndSubscriptionsReleaseSafely()
 {
  var signal=new NotificationSignal();var first=Guid.NewGuid();var second=Guid.NewGuid();
  using var a=signal.Subscribe(first);using var b=signal.Subscribe(second);
  signal.Publish(first);Assert.True(a.Changed.IsCompletedSuccessfully);Assert.False(b.Changed.IsCompleted);
  using var next=signal.Subscribe(first);Assert.False(next.Changed.IsCompleted);
  a.Dispose();a.Dispose();signal.Publish(first);Assert.True(next.Changed.IsCompletedSuccessfully);Assert.False(b.Changed.IsCompleted);
  signal.Publish(second);Assert.True(b.Changed.IsCompletedSuccessfully);
 }
 [Fact]
 public async Task ConcurrentSubscribersReceiveCommittedPulseWithoutCrossTenantFanout()
 {
  var signal=new NotificationSignal();var office=Guid.NewGuid();
  var subscriptions=Enumerable.Range(0,1000).Select(_=>signal.Subscribe(Guid.NewGuid())).ToArray();
  var sameOffice=Enumerable.Range(0,100).Select(_=>signal.Subscribe(office)).ToArray();
  try{await Task.Run(()=>signal.Publish(office));Assert.All(sameOffice,s=>Assert.True(s.Changed.IsCompletedSuccessfully));Assert.All(subscriptions,s=>Assert.False(s.Changed.IsCompleted));}
  finally{foreach(var s in subscriptions.Concat(sameOffice))s.Dispose();}
  signal.Publish(office);using var fresh=signal.Subscribe(office);Assert.False(fresh.Changed.IsCompleted);
 }
}
