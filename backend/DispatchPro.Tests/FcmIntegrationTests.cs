using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using FirebaseAdmin.Messaging;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;

public sealed class FcmIntegrationTests
{
 [Theory]
 [InlineData("DRIVER_REQUEST",true,120)][InlineData("ARRIVED",true,120)][InlineData("RIDE_STATUS",true,120)]
 [InlineData("CHAT",true,120)][InlineData("CALL",true,40)][InlineData("CALL_END",false,120)][InlineData("ARRIVAL_ACK",false,120)]
 public void DataOnlyPriorityExpiryAndOpaqueRouting(string type,bool high,int ttl){
  var installation=Guid.NewGuid();var actor=Guid.NewGuid();var eventId=Guid.NewGuid();var ride=Guid.NewGuid();
  var message=FirebaseCustomerPushSender.EventMessage("test-token",installation,actor,eventId,type,ride);
  Assert.Null(message.Notification);Assert.Equal(high?Priority.High:Priority.Normal,message.Android.Priority);Assert.Equal(TimeSpan.FromSeconds(ttl),message.Android.TimeToLive);
  Assert.Equal(5,message.Data.Count);Assert.Equal(type,message.Data["type"]);Assert.Equal(ride.ToString(),message.Data["rideId"]);Assert.Equal(installation.ToString(),message.Data["installationId"]);Assert.Equal(actor.ToString(),message.Data["recipient"]);Assert.Equal(eventId.ToString(),message.Data["eventId"]);
 }
 [Fact] public void PushIsDisabledWithoutExplicitServerConfiguration(){Assert.False(new FirebaseCustomerPushSender(new ConfigurationBuilder().Build()).Enabled);Assert.Throws<ArgumentOutOfRangeException>(()=>FirebaseCustomerPushSender.EventMessage("x",Guid.NewGuid(),Guid.NewGuid(),Guid.NewGuid(),"PTT"));}
 [Fact] public async Task DisabledStartupDoesNotLoadCredentials(){var sender=new FirebaseCustomerPushSender(new ConfigurationBuilder().Build());var startup=new FirebasePushStartup(sender,Microsoft.Extensions.Logging.Abstractions.NullLogger<FirebasePushStartup>.Instance);await startup.StartAsync(CancellationToken.None);Assert.False(sender.Initialized);await startup.StopAsync(CancellationToken.None);}
 [Fact] public async Task HealthExposesOnlyPublicPushStatus(){await using var factory=new ApiFactory("Host=127.0.0.1;Port=1;Database=not_contacted;Timeout=1");using var client=factory.CreateClient();var health=await Json(await client.GetAsync("/health/live"));Assert.False(health["fcm"]!["enabled"]!.GetValue<bool>());Assert.False(health["fcm"]!["initialized"]!.GetValue<bool>());Assert.DoesNotContain("private_key",health.ToJsonString());Assert.DoesNotContain("GOOGLE_APPLICATION_CREDENTIALS",health.ToJsonString());}
 static async Task<JsonNode> Json(HttpResponseMessage response){var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");return string.IsNullOrWhiteSpace(body)?new JsonObject():JsonNode.Parse(body)!;}
 sealed class Sender:ICustomerPushSender{
  public bool Enabled=>false; // Registration must work before Admin credentials are installed.
  public readonly List<(Guid Installation,Guid Actor,Guid Event,string Type)> Events=[];
  public readonly List<(string Type,Guid Ride,VisiblePush Display)> Visible=[];
  public string? Invalid;
  public Task<CustomerPushResult> Send(string token,Guid installation,Guid actorId,Guid eventId,CancellationToken ct)=>SendEvent(token,installation,actorId,eventId,"ARRIVED",ct);
  public Task<CustomerPushResult> SendEvent(string token,Guid installation,Guid actorId,Guid eventId,string type,CancellationToken ct,Guid? rideId=null){Events.Add((installation,actorId,eventId,type));return Task.FromResult(token==Invalid?CustomerPushResult.InvalidToken:CustomerPushResult.Sent);}
  public Task<CustomerPushResult> SendVisibleEvent(string token,Guid installation,Guid actorId,Guid eventId,string type,Guid rideId,VisiblePush visible,CancellationToken ct){Visible.Add((type,rideId,visible));return SendEvent(token,installation,actorId,eventId,type,ct,rideId);}
 }
 [PostgresFact] public async Task DevicesRotationRemovalOwnershipResyncOutboxAndInvalidToken()
 {
  var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;var name="fcm_test_"+Guid.NewGuid().ToString("N");await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
  try{
   var sender=new Sender();await using var baseFactory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
   await using var factory=baseFactory.WithWebHostBuilder(b=>b.ConfigureTestServices(s=>{s.RemoveAll<IHostedService>();s.RemoveAll<ICustomerPushSender>();s.AddSingleton<ICustomerPushSender>(sender);}));
   const string slug="fcm-test",password="Fcm-test-only-password-123!";
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();await Seed.RunAsync(db,scope.ServiceProvider.GetRequiredService<TenantContext>(),new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Seed:TenantSlug",slug},{"Seed:AdminPassword",password}}).Build());}
   using var customer=factory.CreateClient();using var other=factory.CreateClient();using var driver=factory.CreateClient();using var anonymous=factory.CreateClient();
   var account=Guid.NewGuid();var otherAccount=Guid.NewGuid();var secret=new string('a',64);
   var auth=await Json(await customer.VerifiedRegistration(new{tenant=slug,accountId=account,deviceSecret=secret,fullName="Customer",phone="0591234567"}));customer.DefaultRequestHeaders.Authorization=new("Bearer",auth["accessToken"]!.GetValue<string>());
   var outsider=await Json(await other.VerifiedRegistration(new{tenant=slug,accountId=otherAccount,deviceSecret=secret,fullName="Other",phone="0591234568"}));other.DefaultRequestHeaders.Authorization=new("Bearer",outsider["accessToken"]!.GetValue<string>());
   Guid driverActor,driverId,tenantId;var rideId=Guid.NewGuid();
   using(var scope=factory.Services.CreateScope()){
    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenantId=tenant.TenantId=await db.Set<Tenant>().Where(t=>t.Slug==slug).Select(t=>t.Id).SingleAsync();tenant.ActorId=account;
    var role=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");var user=new User{RoleId=role.Id,Username="fcm-driver"};db.Add(user);driverActor=user.Id;var d=new Driver{UserId=user.Id,FullName="Driver",Status=DriverStatus.Available};db.Add(d);driverId=d.Id;
    var request=new RideRequest{CustomerId=account,Pickup="pickup",Destination="destination",Source="CUSTOMER_APP"};db.Add(request);var ride=new Ride{Id=rideId,RideRequestId=request.Id,Status=RideStatus.Pending,DispatchMode="AUTO"};db.Add(ride);await db.SaveChangesAsync();ride.DriverId=d.Id;ride.Status=RideStatus.Assigned;ride.OfferExpiresAt=DateTimeOffset.UtcNow.AddMinutes(1);await db.SaveChangesAsync();driver.DefaultRequestHeaders.Authorization=new("Bearer",scope.ServiceProvider.GetRequiredService<TokenService>().Issue(user));
   }
   var i1=Guid.NewGuid();var i2=Guid.NewGuid();var di=Guid.NewGuid();const string token1="test-only-customer-token-number-one",token2="test-only-customer-token-number-two",driverToken="test-only-driver-token-number-one";
   Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.PostAsJsonAsync("/api/v1/driver/push-device",new{installationId=di,token=driverToken})).StatusCode);
   Assert.Equal(HttpStatusCode.Forbidden,(await customer.PostAsJsonAsync("/api/v1/driver/push-device",new{installationId=di,token=driverToken})).StatusCode);
   Assert.Equal(HttpStatusCode.BadRequest,(await driver.PostAsJsonAsync("/api/v1/driver/push-device",new{installationId=Guid.Empty,token=driverToken})).StatusCode);
   await Json(await driver.PostAsJsonAsync("/api/v1/driver/push-device",new{installationId=di,token=driverToken}));
   await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i1,token=token1}));await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i1,token=token1}));await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i2,token=token2}));
   var worker=new DispatchPushWorker(factory.Services.GetRequiredService<IServiceScopeFactory>(),factory.Services.GetRequiredService<NotificationSignal>(),sender);await worker.Scan(CancellationToken.None);await worker.Scan(CancellationToken.None);
   Assert.Single(sender.Events,e=>e.Type=="DRIVER_REQUEST");Assert.Equal(2,sender.Events.Count(e=>e.Type=="RIDE_STATUS"));Assert.All(sender.Events.Where(e=>e.Type=="RIDE_STATUS"),e=>Assert.Equal(account,e.Actor));
   var snapshot=await Json(await customer.GetAsync("/api/v1/customer-app/mobile/updates?deviceId="+Guid.NewGuid()));Assert.Equal("Assigned",Assert.Single(snapshot["data"]!["rideEvents"]!.AsArray())!["status"]!.GetValue<string>());Assert.Empty((await Json(await other.GetAsync("/api/v1/customer-app/mobile/updates?deviceId="+Guid.NewGuid())))["data"]!["rideEvents"]!.AsArray());
   const string rotated="test-only-customer-rotated-token";await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i1,token=rotated}));
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var rows=await db.Set<AuditLog>().Where(a=>a.Action==CustomerPushStore.Registration).ToListAsync();Assert.Equal(3,rows.Count);Assert.All(rows,r=>Assert.DoesNotContain("test-only-customer",r.Detail));Assert.Equal(rotated,CustomerPushStore.Read(scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>(),rows.OrderByDescending(r=>r.CreatedAt).First())!.Token);}
   // Same physical installation changes account: old account registration is disabled.
   await Json(await other.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i1,token=rotated}));
   sender.Invalid=token2;
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=tenantId;tenant.ActorId=driverActor;var ride=await db.Set<Ride>().SingleAsync(r=>r.Id==rideId);ride.Status=RideStatus.Accepted;await db.SaveChangesAsync();}
   var before=sender.Events.Count;await worker.Scan(CancellationToken.None);await worker.Scan(CancellationToken.None);var additions=sender.Events.Skip(before).ToArray();Assert.Single(additions);Assert.Equal(i2,additions[0].Installation);Assert.Equal(account,additions[0].Actor);
   before=sender.Events.Count;
   await Json(await customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{rideId}/chat",new{id=Guid.NewGuid(),text="test message"}));await worker.Scan(CancellationToken.None);await worker.Scan(CancellationToken.None);Assert.Single(sender.Events.Skip(before),e=>e.Type=="CHAT");Assert.Equal(driverActor,sender.Events.Last(e=>e.Type=="CHAT").Actor);
   var callerDevice=Guid.NewGuid();var created=await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/calls",new{rideId,deviceId=callerDevice,requestId=Guid.NewGuid()}));var callId=created["id"]!.GetValue<Guid>();before=sender.Events.Count;await worker.Scan(CancellationToken.None);await worker.Scan(CancellationToken.None);Assert.Single(sender.Events.Skip(before),e=>e.Type=="CALL");Assert.Equal(driverActor,sender.Events.Last(e=>e.Type=="CALL").Actor);
   await Json(await driver.PostAsJsonAsync($"/api/v1/driver/calls/{callId}/reject",new{deviceId=Guid.NewGuid()}));before=sender.Events.Count;await worker.Scan(CancellationToken.None);await worker.Scan(CancellationToken.None);Assert.Single(sender.Events.Skip(before),e=>e.Type=="CALL_END");
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var id=CustomerPushStore.RegistrationId(tenantId,account,i2);Assert.Equal("",(await db.Set<AuditLog>().Where(a=>a.EntityId==id).OrderByDescending(a=>a.CreatedAt).FirstAsync()).Detail);}
   await Json(await driver.PostAsJsonAsync("/api/v1/driver/push-device/remove",new{installationId=di,token=""}));await Json(await other.PostAsJsonAsync("/api/v1/customer-app/push-device/remove",new{installationId=i1,token=""}));
   // Disabled devices can register again; limits count active devices, not history.
   await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i2,token=token2}));
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=tenantId;tenant.ActorId=driverActor;var ride=await db.Set<Ride>().SingleAsync(r=>r.Id==rideId);ride.Status=RideStatus.Arrived;await db.SaveChangesAsync();}
   snapshot=await Json(await customer.GetAsync("/api/v1/customer-app/mobile/updates?deviceId="+Guid.NewGuid()));var arrival=Assert.Single(snapshot["data"]!["rideEvents"]!.AsArray());Assert.Equal("Arrived",arrival!["status"]!.GetValue<string>());var arrivalId=arrival["id"]!.GetValue<Guid>();
   sender.Invalid=null;var arrivalWorker=new CustomerPushWorker(factory.Services.GetRequiredService<IServiceScopeFactory>(),factory.Services.GetRequiredService<NotificationSignal>(),sender,Microsoft.Extensions.Logging.Abstractions.NullLogger<CustomerPushWorker>.Instance);
   before=sender.Events.Count;await arrivalWorker.Scan(CancellationToken.None);await arrivalWorker.Scan(CancellationToken.None);
   var sentArrival=Assert.Single(sender.Events.Skip(before),e=>e.Type=="ARRIVED");Assert.Equal(account,sentArrival.Actor);Assert.Equal(i2,sentArrival.Installation);
   var display=Assert.Single(sender.Visible,e=>e.Type=="ARRIVED");Assert.Equal(rideId,display.Ride);Assert.Equal("Driver",display.Display.PeerName);
   // A delayed/reopened app still sees an unacknowledged arrival after the old two-minute window.
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;await db.Set<AuditLog>().Where(a=>a.Id==arrivalId).ExecuteUpdateAsync(s=>s.SetProperty(a=>a.CreatedAt,DateTimeOffset.UtcNow.AddMinutes(-5)));}
   snapshot=await Json(await customer.GetAsync("/api/v1/customer-app/mobile/updates?deviceId="+Guid.NewGuid()));Assert.Equal(arrivalId,Assert.Single(snapshot["data"]!["rideEvents"]!.AsArray())!["id"]!.GetValue<Guid>());
   await Json(await customer.PostAsJsonAsync($"/api/v1/customer-app/rides/{rideId}/arrival-ack",new{eventId=arrivalId}));snapshot=await Json(await customer.GetAsync("/api/v1/customer-app/mobile/updates?deviceId="+Guid.NewGuid()));Assert.True(Assert.Single(snapshot["data"]!["rideEvents"]!.AsArray())!["arrivalAcknowledged"]!.GetValue<bool>());
   // No-driver terminal transitions also resync via the existing ride.state audit.
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=tenantId;tenant.ActorId=account;var ride=await db.Set<Ride>().SingleAsync(r=>r.Id==rideId);ride.DriverId=null;ride.Status=RideStatus.NoDriverAvailable;await db.SaveChangesAsync();}
   snapshot=await Json(await customer.GetAsync("/api/v1/customer-app/mobile/updates?deviceId="+Guid.NewGuid()));Assert.Equal("NoDriverAvailable",Assert.Single(snapshot["data"]!["rideEvents"]!.AsArray())!["status"]!.GetValue<string>());
   // Binding follows the authenticated session family, including same-token renewal.
   Guid family;
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=tenantId;tenant.ActorId=driverActor;var session=new AuditLog{ActorId=driverActor,EntityId=driverActor,Action="office.session.created"};db.Add(session);await db.SaveChangesAsync();family=session.Id;driver.DefaultRequestHeaders.Authorization=new("Bearer",scope.ServiceProvider.GetRequiredService<TokenService>().Issue(await db.Set<User>().SingleAsync(u=>u.Id==driverActor),family.ToString()));}
   await Json(await driver.PostAsJsonAsync("/api/v1/driver/push-device",new{installationId=di,token=driverToken}));
   using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();tenant.TenantId=tenantId;tenant.ActorId=driverActor;var id=CustomerPushStore.RegistrationId(tenantId,driverActor,di);var row=await db.Set<AuditLog>().Where(a=>a.EntityId==id&&a.Action=="driver.push.device").OrderByDescending(a=>a.CreatedAt).FirstAsync();var device=CustomerPushStore.Read(scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>(),row)!;Assert.Equal(family,device.SessionId);Assert.True(await CustomerPushStore.IsActive(db,row,device,CancellationToken.None));db.Add(new AuditLog{ActorId=driverActor,EntityId=family,Action="office.session.revoked"});await db.SaveChangesAsync();Assert.False(await CustomerPushStore.IsActive(db,row,device,CancellationToken.None));}
   Assert.Equal(HttpStatusCode.Unauthorized,(await driver.PostAsJsonAsync("/api/v1/driver/push-device",new{installationId=di,token=driverToken})).StatusCode);
   await Json(await customer.PostAsJsonAsync("/api/v1/customer-app/logout",new{}));Assert.Equal(HttpStatusCode.Unauthorized,(await customer.PostAsJsonAsync("/api/v1/customer-app/push-device",new{installationId=i2,token=token2})).StatusCode);
  }finally{await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
 }
}
