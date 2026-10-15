using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Endpoints;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
namespace DispatchPro.Api.Services;
// Existing committed assignment/message audit records form the durable outbox.
public sealed class DispatchPushWorker(IServiceScopeFactory scopes,NotificationSignal signal,ICustomerPushSender sender):BackgroundService
{
 protected override async Task ExecuteAsync(CancellationToken ct){while(!ct.IsCancellationRequested){var wake=signal.AnyChange;if(sender.Enabled)try{await Scan(ct);}catch(OperationCanceledException)when(ct.IsCancellationRequested){break;}catch{/* Retry without credential-bearing SDK diagnostics. */}try{await wake.WaitAsync(TimeSpan.FromSeconds(10),ct);}catch(TimeoutException){}catch(OperationCanceledException){break;}}}
 public async Task Scan(CancellationToken ct){using var inventory=scopes.CreateScope();var tenants=await inventory.ServiceProvider.GetRequiredService<TaxiDb>().Set<Tenant>().Select(t=>t.Id).ToListAsync(ct);foreach(var tenant in tenants){using var scope=scopes.CreateScope();var context=scope.ServiceProvider.GetRequiredService<TenantContext>();context.TenantId=tenant;var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var protection=scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>();await using var tx=await db.Database.BeginTransactionAsync(ct);await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant+":customer-push"},0))",ct);
 var cutoff=DateTimeOffset.UtcNow.AddMinutes(-2);var events=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.CreatedAt>=cutoff&&(a.Action=="ride.state"||a.Action=="ride.notification.Assigned"||a.Action.StartsWith("ride.chat.message:"))).OrderBy(a=>a.CreatedAt).Take(100).ToListAsync(ct);
 var callStore=scope.ServiceProvider.GetRequiredService<RideCalls>();var callEvents=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.CreatedAt>=cutoff&&a.Action==RideCalls.Action).OrderBy(a=>a.CreatedAt).Take(200).ToListAsync(ct);
 if(events.Count==0&&callEvents.Count==0){await tx.CommitAsync(ct);continue;}
 var registrations=await db.Set<AuditLog>().AsNoTracking().Where(a=>a.Action=="driver.push.device"||a.Action==CustomerPushStore.Registration).GroupBy(a=>a.EntityId).Select(g=>g.OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).First()).ToListAsync(ct);
 foreach(var e in events){var ride=await db.Set<Ride>().AsNoTracking().SingleOrDefaultAsync(r=>r.Id==e.EntityId,ct);if(ride is null)continue;
 if(e.Action=="ride.state"){await SendCustomerStatus(e,ride,registrations,db,context,protection,ct);continue;}
 if(ride.DriverId is null)continue;var driver=await db.Set<Driver>().SingleOrDefaultAsync(d=>d.Id==ride.DriverId&&d.Active&&d.Status!=DriverStatus.Suspended,ct);if(driver is null)continue;var assignment=e.Action=="ride.notification.Assigned";if(e.Action.StartsWith("ride.notification.")&&!assignment)continue;if(assignment&&(ride.Status!=RideStatus.Assigned||e.Detail!=driver.Id.ToString()||ride.OfferExpiresAt<=DateTimeOffset.UtcNow))continue;
 if(!assignment&&ride.Status is not (RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress))continue;if(!assignment&&e.Action!="ride.chat.message:"+driver.Id)continue;var recipient=assignment?driver.UserId:RideChatEndpoints.Read(protection,tenant,e.Detail).Recipient;
 // Recheck both sides against the CURRENT assigned driver/customer after reassignment.
 var customer=await db.Set<RideRequest>().Where(q=>q.Id==ride.RideRequestId).Select(q=>q.CustomerId).SingleAsync(ct);if(!assignment&&recipient!=driver.UserId&&(recipient!=customer||e.ActorId!=driver.UserId))continue;
 foreach(var r in registrations.Where(r=>r.Detail!=""&&(r.ActorId==recipient||!assignment&&recipient!=driver.UserId&&r.Action==CustomerPushStore.Registration))){if(r.ActorId!=recipient){context.ActorId=r.ActorId;var own=await CustomerAppEndpoints.Own(db,context);if(own?.Id!=customer)continue;}var receipt=r.EntityId+":"+e.Id;if(await db.Set<AuditLog>().AnyAsync(a=>a.Action=="dispatch.push.sent"&&a.EntityId==e.Id&&a.Detail==receipt,ct))continue;var target=CustomerPushStore.Read(protection,r);if(target is null||!await CustomerPushStore.IsActive(db,r,target,ct))continue;var result=await sender.SendEvent(target.Token,target.InstallationId,r.ActorId,e.Id,assignment?"DRIVER_REQUEST":"CHAT",ct,e.EntityId);if(result==CustomerPushResult.Sent)db.Add(new AuditLog{ActorId=r.ActorId,EntityId=e.Id,Action="dispatch.push.sent",Detail=receipt});if(result==CustomerPushResult.InvalidToken)db.Add(new AuditLog{ActorId=r.ActorId,EntityId=r.EntityId,Action=r.Action,Detail=""});}}
 foreach(var e in callEvents){var call=callStore.Read(e);if(!RideCalls.NotifyTransition(call))continue;if(call.State=="ringing"){var current=await callStore.Find(call.Id,ct);if(current is null||current.State!="ringing"||!RideCalls.Live(current,DateTimeOffset.UtcNow))continue;}
 foreach(var r in registrations.Where(r=>r.Detail!="")){
 context.ActorId=r.ActorId;var p=await callStore.Access(call.RideId,ct);if(p is null||p.DriverId!=call.DriverId||p.CustomerId!=call.CustomerId)continue;
 if(call.Revision==1&&(p.IsDriver==call.CallerIsDriver||!RideCalls.Live(call,DateTimeOffset.UtcNow)))continue;
 var receipt=r.EntityId+":"+e.Id;if(await db.Set<AuditLog>().AnyAsync(a=>a.Action=="dispatch.push.sent"&&a.EntityId==e.Id&&a.Detail==receipt,ct))continue;
 var target=CustomerPushStore.Read(protection,r);if(target is null||!await CustomerPushStore.IsActive(db,r,target,ct))continue;
 var type=call.State=="ringing"?"CALL":"CALL_END";
 var result=await sender.SendVisibleEvent(target.Token,target.InstallationId,r.ActorId,call.Id,type,call.RideId,new(p.IsDriver?p.CustomerName:p.DriverName,call.CreatedAt,call.ExpiresAt,call.Revision),ct);
 if(result==CustomerPushResult.Sent)db.Add(new AuditLog{ActorId=r.ActorId,EntityId=e.Id,Action="dispatch.push.sent",Detail=receipt});if(result==CustomerPushResult.InvalidToken)db.Add(new AuditLog{ActorId=r.ActorId,EntityId=r.EntityId,Action=r.Action,Detail=""});}}
 await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);}}
 private async Task SendCustomerStatus(AuditLog e,Ride ride,List<AuditLog> registrations,TaxiDb db,TenantContext context,IDataProtectionProvider protection,CancellationToken ct){
  // Older transitions are wake hints only; only the current committed state is shown.
  if(ride.Status is RideStatus.Pending or RideStatus.Rejected or RideStatus.Arrived)return;
  if(await db.Set<AuditLog>().Where(a=>a.EntityId==ride.Id&&a.Action=="ride.state").OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Select(a=>a.Id).FirstOrDefaultAsync(ct)!=e.Id)return;
  using var detail=JsonDocument.Parse(e.Detail);if(detail.RootElement.GetProperty("status").GetString()!=RideWorkflow.CustomerState(ride))return;
  var customer=await db.Set<RideRequest>().Where(q=>q.Id==ride.RideRequestId).Select(q=>q.CustomerId).SingleOrDefaultAsync(ct);if(customer is null)return;
  foreach(var r in registrations.Where(r=>r.Action==CustomerPushStore.Registration&&r.Detail!="")){
   context.ActorId=r.ActorId;if((await CustomerAppEndpoints.Own(db,context))?.Id!=customer)continue;
   var receipt=r.EntityId+":"+e.Id;if(await db.Set<AuditLog>().AnyAsync(a=>a.Action=="dispatch.push.status.sent"&&a.EntityId==e.Id&&a.Detail==receipt,ct))continue;
   var device=CustomerPushStore.Read(protection,r);if(device is null||!await CustomerPushStore.IsActive(db,r,device,ct))continue;
   var result=await sender.SendEvent(device.Token,device.InstallationId,r.ActorId,e.Id,"RIDE_STATUS",ct,ride.Id);
   if(result==CustomerPushResult.Sent)db.Add(new AuditLog{ActorId=r.ActorId,EntityId=e.Id,Action="dispatch.push.status.sent",Detail=receipt});
   if(result==CustomerPushResult.InvalidToken)db.Add(new AuditLog{ActorId=r.ActorId,EntityId=r.EntityId,Action=r.Action,Detail=""});
  }
 }
}
