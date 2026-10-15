using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace DispatchPro.Tests;

public sealed class DriverJobTests
{
    private static async Task<JsonNode> Read(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {text}");
        return string.IsNullOrEmpty(text) ? new JsonObject() : JsonNode.Parse(text)!;
    }

    [PostgresFact]
    public async Task QueueIsPersistentOrderedVersionedScopedAndPromotesOnlyAfterRelease()
    {
        var connection = Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;
        var name = "jobs_test_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(connection); await admin.OpenAsync();
        await using (var cmd = new NpgsqlCommand($"CREATE DATABASE {name}", admin)) await cmd.ExecuteNonQueryAsync();
        try
        {
            await using var factory = new ApiFactory(new NpgsqlConnectionStringBuilder(connection) { Database = name }.ConnectionString);
            Guid tenantId;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TaxiDb>(); await db.Database.MigrateAsync();
                var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
                await Seed.RunAsync(db, tenant, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"]="jobs", ["Seed:AdminPassword"]="Jobs-password-123!" }).Build());
                tenantId = tenant.TenantId;
            }
            using var office = factory.CreateClient(); using var driver = factory.CreateClient();
            async Task Login(HttpClient client, string username)
            {
                var login = await Read(await client.PostAsJsonAsync("/api/v1/auth/login", new { tenant="jobs", username, password="Jobs-password-123!" }));
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login["accessToken"]!.GetValue<string>());
            }
            await Login(office,"admin");
            // Office refresh credentials survive expired access and are tenant-scoped/revocable.
            using(var refreshClient=factory.CreateClient())
            {
                var session=await Read(await refreshClient.PostAsJsonAsync("/api/v1/auth/login",new {tenant="jobs",username="admin",password="Jobs-password-123!"}));
                var credential=session["refreshToken"]!.GetValue<string>();
                var tokenReader=new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
                var issued=tokenReader.ReadJwtToken(session["accessToken"]!.GetValue<string>());
                var signing=new Microsoft.IdentityModel.Tokens.SigningCredentials(new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes("integration-test-only-signing-key-0123456789")),Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256);
                var expired=tokenReader.WriteToken(new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(issued.Issuer,issued.Audiences.First(),issued.Claims,expires:DateTime.UtcNow.AddMinutes(-5),signingCredentials:signing));
                refreshClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",expired);
                Assert.Equal(HttpStatusCode.Unauthorized,(await refreshClient.GetAsync("/api/v1/office")).StatusCode);
                refreshClient.DefaultRequestHeaders.Authorization=null;
                var refreshed=await Read(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=credential}));
                var nextCredential=refreshed["refreshToken"]!.GetValue<string>();Assert.NotEqual(credential,nextCredential);
                // Response-lost retry obtains the same replacement, without creating a competing family.
                var replay=await Read(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=credential}));
                Assert.Equal(nextCredential,replay["refreshToken"]!.GetValue<string>());
                Assert.Equal(HttpStatusCode.Unauthorized,(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=Guid.NewGuid().ToString("N")+credential[32..]})).StatusCode);
                refreshed=await Read(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=nextCredential}));
                Assert.Equal(HttpStatusCode.Unauthorized,(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=credential})).StatusCode);
                refreshClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",refreshed["accessToken"]!.GetValue<string>());
                await Read(await refreshClient.GetAsync("/api/v1/office"));
                refreshClient.DefaultRequestHeaders.Authorization=null;
                credential=refreshed["refreshToken"]!.GetValue<string>();
                await Read(await refreshClient.PostAsJsonAsync("/api/v1/auth/logout",new {refreshToken=credential}));
                Assert.Equal(HttpStatusCode.Unauthorized,(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=credential})).StatusCode);
                refreshClient.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",refreshed["accessToken"]!.GetValue<string>());
                Assert.Equal(HttpStatusCode.Unauthorized,(await refreshClient.GetAsync("/api/v1/office")).StatusCode);
                refreshClient.DefaultRequestHeaders.Authorization=null;
                session=await Read(await refreshClient.PostAsJsonAsync("/api/v1/auth/login",new {tenant="jobs",username="admin",password="Jobs-password-123!"}));
                using(var scope=factory.Services.CreateScope()){
                    scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;
                    var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var user=await db.Set<User>().SingleAsync(u=>u.Username=="admin");var original=user.PasswordHash;
                    user.PasswordHash=original+"changed";await db.SaveChangesAsync();
                    Assert.Equal(HttpStatusCode.Unauthorized,(await refreshClient.PostAsJsonAsync("/api/v1/auth/refresh",new {refreshToken=session["refreshToken"]!.GetValue<string>()})).StatusCode);
                    user.PasswordHash=original;await db.SaveChangesAsync();
                }
            }
            var roles = (await Read(await office.GetAsync("/api/v1/roles"))).AsArray();
            var roleId = roles.Single(r=>r!["name"]!.GetValue<string>()=="Driver")!["id"]!.GetValue<Guid>();
            var ids = new List<Guid>();
            foreach (var username in new[] { "driver-a", "driver-b" })
            {
                var user = await Read(await office.PostAsJsonAsync("/api/v1/users",new {username,password="Jobs-password-123!",roleId}));
                var d = await Read(await office.PostAsJsonAsync("/api/v1/drivers",new {userId=user["id"]!.GetValue<Guid>(),fullName=username,status="Available"}));
                ids.Add(d["id"]!.GetValue<Guid>());
            }
            await Login(driver,"driver-a");
            async Task<JsonNode> NewRide(string pickup) => await Read(await office.PostAsJsonAsync("/api/v1/ride-requests",new {pickup,destination="الجامعة",notes="PRIVATE_NOTE",source="MANUAL"}));
            async Task<JsonArray> Jobs() => (await Read(await office.GetAsync("/api/v1/reception/jobs"))).AsArray();
            async Task<JsonNode> Job(Guid rideId) => (await Jobs()).Single(j=>j!["rideId"]!.GetValue<Guid>()==rideId)!;
            // Empty pickup/fare remains a real independent order; privacy is enforced after acceptance.
            var blankId = Guid.NewGuid().ToString();
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{blankId}", new {
                id=blankId, source="MANUAL", status="pending", passengerName="زبون", passengerPhone="0599123456",
                pickup=new {name="",coords=(object?)null}, totalFare=(decimal?)null, movingFee=false
            }));
            var blank = (await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray().Single(r=>r!["id"]!.GetValue<string>()==blankId)!;
            var blankRideId=blank["backendRideId"]!.GetValue<Guid>();
            Assert.Equal("",blank["pickup"]!["name"]!.GetValue<string>()); Assert.Null(blank["totalFare"]);
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="send",rideId=blankRideId,version=blank["rideVersion"]!.GetValue<long>(),driverId=ids[0],shareCustomerPhone=false}));
            blank=await Read(await driver.GetAsync($"/api/v1/driver/rides/{blankRideId}"));
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="withdraw",rideId=blankRideId,version=blank["version"]!.GetValue<long>()}));
            Assert.Equal(HttpStatusCode.NotFound,(await driver.GetAsync($"/api/v1/driver/rides/{blankRideId}")).StatusCode);
            blank=(await Read(await office.GetAsync("/api/v1/reception/snapshot")))["rides"]!.AsArray().Single(r=>r!["id"]!.GetValue<string>()==blankId)!;
            Assert.Equal("pending",blank["status"]!.GetValue<string>()); Assert.Equal("0599123456",blank["passengerPhone"]!.GetValue<string>());
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="send",rideId=blankRideId,version=blank["rideVersion"]!.GetValue<long>(),driverId=ids[0],shareCustomerPhone=false}));
            blank=await Read(await driver.GetAsync($"/api/v1/driver/rides/{blankRideId}"));
            blank=await Read(await driver.PutAsJsonAsync($"/api/v1/rides/{blankRideId}/status",new {status="Accepted",version=blank["version"]!.GetValue<long>()}));
            var privateDetail=await Read(await driver.GetAsync($"/api/v1/driver/rides/{blankRideId}"));
            Assert.Null(privateDetail["phone"]); Assert.DoesNotContain("0599123456",privateDetail.ToJsonString());
            Assert.Equal(HttpStatusCode.Conflict,(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="withdraw",rideId=blankRideId,version=privateDetail["version"]!.GetValue<long>()})).StatusCode);
            await Read(await office.PutAsJsonAsync($"/api/v1/rides/{blankRideId}/status",new {status="Cancelled",version=privateDetail["version"]!.GetValue<long>()}));
            var active = await NewRide("الحالي"); var activeId = active["id"]!.GetValue<Guid>();
            var sendActive = new {type="send",rideId=activeId,driverId=ids[0],version=active["version"]!.GetValue<long>()};
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",sendActive));
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",sendActive));
            active = (await Read(await driver.GetAsync("/api/v1/driver/updates")))["data"]!["rides"]!.AsArray().Single()!;
            Assert.Equal("Assigned",active["status"]!.GetValue<string>());
            Assert.Empty(await Jobs());
            active = await Read(await driver.PutAsJsonAsync($"/api/v1/rides/{activeId}/status",new {status="Accepted",version=active["version"]!.GetValue<long>()}));
            var first = await NewRide("الأول"); var second = await NewRide("الثاني"); var third = await NewRide("الثالث");
            var firstId = first["id"]!.GetValue<Guid>(); var secondId = second["id"]!.GetValue<Guid>(); var thirdId = third["id"]!.GetValue<Guid>();
            foreach(var ride in new[]{first,second,third}) {
                var reception = await Read(await office.GetAsync("/api/v1/reception/snapshot"));
                var projected = reception["rides"]!.AsArray().Single(r=>r!["backendRideId"]!.GetValue<Guid>()==ride["id"]!.GetValue<Guid>())!;
                Assert.Equal(ride["version"]!.GetValue<long>(),projected["rideVersion"]!.GetValue<long>());
                var send = new {type="send",rideId=ride["id"]!.GetValue<Guid>(),version=projected["rideVersion"]!.GetValue<long>(),driverId=ids[0]};
                var responses = await Task.WhenAll(office.PostAsJsonAsync("/api/v1/reception/jobs",send),office.PostAsJsonAsync("/api/v1/reception/jobs",send));
                foreach(var response in responses) await Read(response);
            }
            Assert.Equal(3,(await Jobs()).Count);
            Assert.Equal(1,(await Job(firstId))["position"]!.GetValue<int>());
            Assert.Equal(2,(await Job(secondId))["position"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.Conflict,(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="send",rideId=firstId,version=first["version"]!.GetValue<long>(),driverId=ids[1]})).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="add",rideId=firstId,version=1,driverId=ids[0]})).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.GetAsync("/api/v1/reception/jobs")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden,(await driver.PostAsJsonAsync("/api/v1/reception/jobs",new {type="remove",rideId=firstId,version=1})).StatusCode);
            var snapshot = await Read(await driver.GetAsync("/api/v1/driver/updates"));
            Assert.Single(snapshot["data"]!["rides"]!.AsArray()); Assert.Equal(3,snapshot["data"]!["jobs"]!.AsArray().Count);
            Assert.DoesNotContain("PRIVATE_NOTE",snapshot["data"]!["jobs"]!.ToJsonString());
            Assert.Equal(HttpStatusCode.NotFound,(await driver.GetAsync($"/api/v1/driver/rides/{firstId}")).StatusCode);
            var secondJob = await Job(secondId); var oldVersion = secondJob["version"]!.GetValue<long>();
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="move",rideId=secondId,version=oldVersion,driverId=ids[0],position=1}));
            Assert.Equal(secondId,(await Jobs())[0]!["rideId"]!.GetValue<Guid>());
            Assert.Equal(HttpStatusCode.Conflict,(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="remove",rideId=secondId,version=oldVersion})).StatusCode);
            // Another driver's active ride keeps a transferred job waiting too.
            var other = await NewRide("حالي آخر");
            await Read(await office.PutAsJsonAsync($"/api/v1/rides/{other["id"]}/assignment",new {driverId=ids[1],version=other["version"]!.GetValue<long>()}));
            var thirdJob = await Job(thirdId);
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="move",rideId=thirdId,version=thirdJob["version"]!.GetValue<long>(),driverId=ids[1]}));
            Assert.Equal(ids[1],(await Job(thirdId))["driverId"]!.GetValue<Guid>());
            thirdJob = await Job(thirdId);
            await Read(await office.PostAsJsonAsync("/api/v1/reception/jobs",new {type="remove",rideId=thirdId,version=thirdJob["version"]!.GetValue<long>()}));
            Assert.Equal(2,(await Jobs()).Count);
            Assert.Equal(HttpStatusCode.Conflict,(await office.PutAsJsonAsync($"/api/v1/dispatch/rides/{firstId}/mode",new {mode="AUTO_NEAREST",version=2})).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await office.PutAsJsonAsync($"/api/v1/rides/{firstId}/assignment",new {driverId=ids[1],version=2})).StatusCode);
            using(var scope=factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;
                var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();
                Assert.Equal(2,await db.Set<DriverJob>().CountAsync());
                Assert.Equal(RideStatus.Pending,(await db.Set<Ride>().SingleAsync(r=>r.Id==thirdId)).Status);
                scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=Guid.NewGuid();
                Assert.Empty(await db.Set<DriverJob>().ToListAsync());
            }
            foreach(var status in new[]{"DriverArriving","Arrived","InProgress","Completed"})
                active=await Read(await driver.PutAsJsonAsync($"/api/v1/rides/{activeId}/status",new {status,version=active["version"]!.GetValue<long>(),collectedFare=status=="Completed"?(decimal?)30:null}));
            snapshot=await Read(await driver.GetAsync("/api/v1/driver/updates"));
            var promoted=Assert.Single(snapshot["data"]!["rides"]!.AsArray())!;
            Assert.Equal(secondId,promoted["id"]!.GetValue<Guid>()); Assert.Equal("Assigned",promoted["status"]!.GetValue<string>());
            Assert.Single(snapshot["data"]!["jobs"]!.AsArray());
            await Read(await driver.PutAsJsonAsync($"/api/v1/driver/rides/{secondId}/reject",new {version=promoted["version"]!.GetValue<long>()}));
            snapshot=await Read(await driver.GetAsync("/api/v1/driver/updates"));
            Assert.Equal(firstId,Assert.Single(snapshot["data"]!["rides"]!.AsArray())!["id"]!.GetValue<Guid>());
            Assert.Empty(snapshot["data"]!["jobs"]!.AsArray());
            // Removing and re-adding a manual pending job keeps ride versions usable;
            // two simultaneous reception operators cannot reserve it twice.
            var receptionSnapshot=await Read(await office.GetAsync("/api/v1/reception/snapshot"));
            var thirdOrder=receptionSnapshot["rides"]!.AsArray().Single(r=>r!["backendRideId"]?.GetValue<Guid>()==thirdId)!;
            var addAgain=new {type="add",rideId=thirdId,version=thirdOrder["rideVersion"]!.GetValue<long>(),driverId=ids[0]};
            var attempts=await Task.WhenAll(office.PostAsJsonAsync("/api/v1/reception/jobs",addAgain),office.PostAsJsonAsync("/api/v1/reception/jobs",addAgain));
            Assert.Single(attempts,r=>r.StatusCode==HttpStatusCode.NoContent);
            Assert.Single(attempts,r=>r.StatusCode==HttpStatusCode.Conflict);
            receptionSnapshot=await Read(await office.GetAsync("/api/v1/reception/snapshot"));
            var queuedProjection=receptionSnapshot["rides"]!.AsArray().Single(r=>r!["backendRideId"]?.GetValue<Guid>()==thirdId)!;
            Assert.Equal(ids[0],queuedProjection["queuedDriverId"]!.GetValue<Guid>());
            var current=receptionSnapshot["rides"]!.AsArray().Single(r=>r!["backendRideId"]?.GetValue<Guid>()==firstId)!.DeepClone();
            current["status"]="cancelled";current["dispatchStatus"]="CANCELLED";current["driverId"]=null;
            await Read(await office.PutAsJsonAsync($"/api/v1/reception/rides/{current["id"]}",current));
            snapshot=await Read(await driver.GetAsync("/api/v1/driver/updates"));
            Assert.Equal(thirdId,Assert.Single(snapshot["data"]!["rides"]!.AsArray())!["id"]!.GetValue<Guid>());
            Assert.Empty(await Jobs());
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS {name} WITH (FORCE)",admin); await drop.ExecuteNonQueryAsync();
        }
    }
}
