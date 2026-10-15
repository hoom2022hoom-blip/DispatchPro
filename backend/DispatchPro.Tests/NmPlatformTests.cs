using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;
public sealed class NmPlatformTests
{
    [Fact] public void RecentAccurateFixWinsAndStaleLocationCanBeReplaced() {
        var now=DateTimeOffset.UtcNow;
        var current=new DriverLocation{Accuracy=8,UpdatedAt=now.AddSeconds(-5),Position=new Point(35.25,32.22)};
        Assert.False(MobileAppAccess.Prefer(current,new(32.23,35.26,150,now),now));
        Assert.True(MobileAppAccess.Prefer(current,new(32.23,35.26,4,now),now));
        Assert.False(MobileAppAccess.Prefer(current,new(32.23,35.26,4,now.AddSeconds(-6)),now));
        Assert.True(MobileAppAccess.Prefer(current,new(32.23,35.26,150,now.AddSeconds(40)),now.AddSeconds(40)));
    }
    [Fact] public void SameAccountVoiceSessionsCoexistAndOfficePreempts() {
        var rooms=new VoiceRooms(TimeProvider.System);var tenant=Guid.NewGuid();var actor=Guid.NewGuid();var driver=Guid.NewGuid();
        var a=rooms.Join(tenant,actor,driver,"السائق",null,false,"driver");var b=rooms.Join(tenant,actor,driver,"السائق",null,false,"radio");
        Assert.Equal(2,rooms.View(tenant,actor,a.Id).Peers.Length);
        rooms.Acquire(tenant,actor,b.Id,"public",null,VoiceAccess.Office,false);
        var office=rooms.Join(tenant,Guid.NewGuid(),null,"المكتب",null,true);
        var floor=rooms.Acquire(tenant,office.ActorId,office.Id,"public",null,VoiceAccess.Office,false);
        Assert.Equal(floor.Id,Assert.Single(rooms.View(tenant,actor,a.Id).Floors).Id);
        rooms.Release(tenant,office.ActorId,office.Id,floor.Id);
        rooms.Acquire(tenant,actor,b.Id,"private",driver,VoiceAccess.Office,false);
        var privateFloor=rooms.Acquire(tenant,office.ActorId,office.Id,"private",driver,VoiceAccess.Office,false);
        Assert.Equal(privateFloor.Id,Assert.Single(rooms.View(tenant,actor,b.Id).Floors).Id);
        rooms.Release(tenant,office.ActorId,office.Id,privateFloor.Id);
        rooms.Acquire(tenant,actor,b.Id,"private",driver,VoiceAccess.Office,false);
        rooms.Revoke(tenant,driver,new(false,false,false,false,true));
        Assert.Empty(rooms.View(tenant,actor,b.Id).Floors);
    }
    static async Task<JsonNode> Read(HttpResponseMessage response) {
        var body=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {body}");return JsonNode.Parse(body)!;
    }
    [PostgresFact] public async Task IndependentAppsPermissionsGpsPasswordsAndRestoration() {
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name="nm_platform_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();
        await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);
            Guid driverId;
            using(var scope=factory.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();await db.Database.MigrateAsync();
                var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();
                await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Seed:TenantSlug"]="nm-test",["Seed:AdminPassword"]="Nm-old-password-123!"}).Build());
                var role=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");
                var user=new User{Username="driver",RoleId=role.Id};user.PasswordHash=new PasswordHasher<User>().HashPassword(user,"Nm-old-password-123!");
                var d=new Driver{UserId=user.Id,FullName="سائق اختبار",Status=DriverStatus.Available};driverId=d.Id;db.Add(user);db.Add(d);await db.SaveChangesAsync();
            }
            using var office=factory.CreateClient();using var driver=factory.CreateClient();using var radio=factory.CreateClient();using var anonymous=factory.CreateClient();
            async Task<JsonNode> Login(HttpClient client,string app,string password="Nm-old-password-123!",string username="driver") {
                client.DefaultRequestHeaders.Authorization=null;
                var r=await Read(await client.PostAsJsonAsync("/api/v1/auth/"+app+"-login",new{tenant="nm-test",username,password,deviceId=Guid.NewGuid().ToString()}));
                client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",r["accessToken"]!.GetValue<string>());return r;
            }
            var staff=await Read(await office.PostAsJsonAsync("/api/v1/auth/login",new{tenant="nm-test",username="admin",password="Nm-old-password-123!"}));office.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",staff["accessToken"]!.GetValue<string>());
            var ds=await Login(driver,"driver");var rs=await Login(radio,"radio");
            await Read(await driver.GetAsync("/api/v1/driver/me"));await Read(await radio.GetAsync("/api/v1/radio/me"));
            Assert.Equal(HttpStatusCode.Forbidden,(await radio.GetAsync("/api/v1/driver/me")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await radio.PutAsJsonAsync("/api/v1/driver/availability",new{status="Available"})).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/radio/me")).StatusCode);
            var first=DateTimeOffset.UtcNow.AddSeconds(-15);
            await Read(await driver.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.25,accuracy=25,capturedAt=first}));
            var gps=await Read(await radio.PutAsJsonAsync("/api/v1/radio/location",new{latitude=32.221,longitude=35.251,accuracy=5,capturedAt=DateTimeOffset.UtcNow.AddSeconds(-5)}));Assert.True(gps["stored"]!.GetValue<bool>());
            Assert.Equal(HttpStatusCode.BadRequest,(await radio.PutAsJsonAsync("/api/v1/radio/location",new{latitude=32.22,longitude=35.25,accuracy=999,capturedAt=DateTimeOffset.UtcNow})).StatusCode);
            var map=await Read(await office.GetAsync("/api/v1/office/driver-map"));Assert.Single(map["drivers"]!.AsArray());Assert.Equal("radio",map["drivers"]![0]!["locationSource"]!.GetValue<string>());
            Assert.True(map["drivers"]![0]!["driverConnection"]!["connected"]!.GetValue<bool>());Assert.True(map["drivers"]![0]!["radioConnection"]!["connected"]!.GetValue<bool>());
            // RADIO's better map fix must not starve DRIVER's independent fare meter.
            Guid meterId;
            using(var scope=factory.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                var request=new RideRequest{Pickup="نابلس",Destination="الجامعة",Source="MANUAL"};db.Add(request);
                var meter=new Ride{RideRequestId=request.Id,DriverId=driverId,Status=RideStatus.InProgress,FareMode="GPS_METER"};meterId=meter.Id;db.Add(meter);await RideFare.Start(db,meter);await db.SaveChangesAsync();
            }
            var sample=await Read(await driver.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.221,longitude=35.251,accuracy=15,capturedAt=DateTimeOffset.UtcNow}));
            Assert.False(sample["stored"]!.GetValue<bool>());Assert.True(sample["meterAccepted"]!.GetValue<bool>());
            map=await Read(await office.GetAsync("/api/v1/office/driver-map"));Assert.Equal("radio",map["drivers"]![0]!["locationSource"]!.GetValue<string>());
            using(var scope=factory.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                Assert.Contains(await db.Set<DriverGpsPoint>().ToListAsync(),p=>p.RideId==meterId&&!p.LocationAccepted&&p.Source=="driver");
                var meter=await db.Set<Ride>().SingleAsync(r=>r.Id==meterId);Assert.NotNull(meter.MeterLastAt);meter.Status=RideStatus.Completed;await db.SaveChangesAsync();
            }
            var renewed=await Read(await anonymous.PostAsJsonAsync("/api/v1/auth/refresh",new{refreshToken=rs["refreshToken"]!.GetValue<string>()}));radio.DefaultRequestHeaders.Authorization=new("Bearer",renewed["accessToken"]!.GetValue<string>());
            await Read(await driver.GetAsync("/api/v1/driver/me"));await Read(await radio.GetAsync("/api/v1/radio/me"));
            var join=await Read(await radio.PostAsJsonAsync("/api/v1/voice/session",new{}));var voice=join["peer"]!["id"]!.GetValue<string>();
            await Read(await radio.PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=voice,channel="public"}));
            await Read(await office.PutAsJsonAsync($"/api/v1/voice/drivers/{driverId}",new{voiceEnabled=true,canListen=true,canTalkPublic=false,canTalkPrivate=true,isVoiceBlocked=false}));
            var updates=await Read(await radio.GetAsync("/api/v1/voice/updates?sessionId="+voice));Assert.Empty(updates["floors"]!.AsArray());
            Assert.Equal(HttpStatusCode.Forbidden,(await radio.PostAsJsonAsync("/api/v1/voice/floor",new{sessionId=voice,channel="public"})).StatusCode);
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/app-access",new{driverAppEnabled=false,radioEnabled=true,gpsEnabled=true}));
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/driver/me")).StatusCode);await Read(await radio.GetAsync("/api/v1/radio/me"));
            Assert.Equal(HttpStatusCode.Forbidden,(await anonymous.PostAsJsonAsync("/api/v1/auth/driver-login",new{tenant="nm-test",username="driver",password="Nm-old-password-123!"})).StatusCode);
            var snapshot=await Read(await office.GetAsync("/api/v1/office"));Assert.Contains("DRIVER_APP_DISABLED",snapshot["driverEligibility"]![0]!["reasons"]!.AsArray().Select(x=>x!.GetValue<string>()));
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/app-access",new{driverAppEnabled=true,radioEnabled=false,gpsEnabled=false}));
            Assert.Equal(HttpStatusCode.Forbidden,(await radio.GetAsync("/api/v1/radio/me")).StatusCode);await Login(driver,"driver");
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.PutAsJsonAsync("/api/v1/driver/location",new{latitude=32.22,longitude=35.25,accuracy=5,capturedAt=DateTimeOffset.UtcNow})).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/app-access",new{driverAppEnabled=true,radioEnabled=true,gpsEnabled=true})).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/account",new{username="driver",active=true,password="1234567"})).StatusCode);
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/account",new{username="driver",active=true,password="12345678"}));
            Assert.Equal(HttpStatusCode.Unauthorized,(await driver.GetAsync("/api/v1/driver/me")).StatusCode);await Login(driver,"driver","12345678");
            var temporary=await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/account",new{username="driver",active=true,generateTemporary=true}));var secret=temporary["temporaryPassword"]!.GetValue<string>();Assert.True(secret.Length>=8);
            await Login(driver,"driver",secret);
            var next=await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/account",new{username="driver",active=true}));Assert.Null(next["temporaryPassword"]);
            using(var scope=factory.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=await db.Set<Tenant>().Select(t=>t.Id).SingleAsync();
                var user=await db.Set<User>().SingleAsync(u=>u.Username=="driver");Assert.NotEqual(secret,user.PasswordHash);Assert.DoesNotContain(await db.Set<AuditLog>().ToListAsync(),a=>a.Detail.Contains(secret));
                Assert.Single(await db.Set<DriverLocation>().ToListAsync());Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            }
            await Read(await office.PutAsJsonAsync($"/api/v1/office/drivers/{driverId}/app-access",new{driverAppEnabled=false,radioEnabled=false,gpsEnabled=false}));
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/driver/me")).StatusCode);
        } finally {NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);if(Environment.GetEnvironmentVariable("DISPATCHPRO_KEEP_TEST_DATABASES")!="true") await drop.ExecuteNonQueryAsync();}
    }
}
