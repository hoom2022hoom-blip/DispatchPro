using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
namespace DispatchPro.Tests;
public sealed class DriverQueueTests
{
    private static async Task<JsonObject> Body(HttpResponseMessage response) { var text=await response.Content.ReadAsStringAsync(); Assert.True(response.IsSuccessStatusCode,$"{response.StatusCode}: {text}"); return JsonNode.Parse(text)!.AsObject(); }
    private static string Id(JsonNode node) => node["id"]!.GetValue<string>();
    private static IConfiguration SeedConfig(string slug) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Seed:TenantSlug"]=slug,["Seed:AdminPassword"]="Driver-queue-test-password!" }).Build();
    [PostgresFact]
    public async Task ProfilesHistoryUnifiedQueueDispatchAuditAndIsolation()
    {
        var adminString=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;await using var admin=new NpgsqlConnection(adminString);await admin.OpenAsync();var database="taxi_test_"+Guid.NewGuid().ToString("N");
        await using(var c=new NpgsqlCommand($"CREATE DATABASE {database}",admin))await c.ExecuteNonQueryAsync();
        try {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(adminString){Database=database}.ConnectionString);
            using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();foreach(var slug in new[]{"queue-a","queue-b"})await Seed.RunAsync(db,tenant,SeedConfig(slug));}
            using var a=factory.CreateClient();using var b=factory.CreateClient();
            foreach(var (client,slug) in new[]{(a,"queue-a"),(b,"queue-b")}){var auth=await Body(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant=slug,username="admin",password="Driver-queue-test-password!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",auth["accessToken"]!.GetValue<string>());}
            var complete=new JsonObject{["fullName"]="محمد أحمد",["phoneLocal"]="0591111111",["whatsappPhone"]="0561111111",["whatsappCountryCode"]="+970",["hasWhatsApp"]=true,["whatsappEnabled"]=true,["active"]=true,["status"]="Available",["nationalId"]="ID-100",["address"]="عنوان يدوي",["dateOfBirth"]="1990-01-02",["licenseNumber"]="LIC-100",["licenseType"]="Taxi",["licenseIssueDate"]="2020-01-01",["licenseExpiryDate"]="2030-01-01",["hireDate"]="2021-02-03",["notes"]="ملاحظات"};
            var first=await Body(await a.PostAsJsonAsync("/api/v1/office/drivers",complete));var firstId=Id(first);
            Assert.Equal("0591111111", first["phoneLocal"]!.GetValue<string>()); Assert.Equal("+970", first["whatsappCountryCode"]!.GetValue<string>());
            first["whatsappCountryCode"]="+972"; first=await Body(await a.PutAsJsonAsync("/api/v1/office/drivers/"+firstId,first));
            Assert.Equal("+972", first["whatsappCountryCode"]!.GetValue<string>()); Assert.Equal("0561111111",first["whatsappPhone"]!.GetValue<string>()); Assert.Equal("0591111111",first["phoneLocal"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.OK,(await a.PutAsJsonAsync("/api/v1/office/messaging-settings",new{officeWhatsAppNumber="+970591234567"})).StatusCode);
            Assert.Equal("+970591234567",(await Body(await a.GetAsync("/api/v1/office")))["officeWhatsAppNumber"]!.GetValue<string>());
            Assert.Equal("",(await Body(await b.GetAsync("/api/v1/office")))["officeWhatsAppNumber"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.BadRequest,(await a.PostAsJsonAsync("/api/v1/office/drivers",new{fullName="invalid",phoneLocal="+972591234567"})).StatusCode);
            first["address"]=string.Concat(Enumerable.Repeat("عنوان كامل يدوي متعدد الأسطر\n",500));first["nationalId"]="ID-edited";first["licenseNumber"]="LIC-edited";
            first=await Body(await a.PutAsJsonAsync("/api/v1/office/drivers/"+firstId,first));Assert.True(first["address"]!.GetValue<string>().Length>8000);Assert.Equal("ID-edited",first["nationalId"]!.GetValue<string>());Assert.Equal("LIC-edited",first["licenseNumber"]!.GetValue<string>());Assert.Equal("1990-01-02",first["dateOfBirth"]!.GetValue<string>());
            var second=await Body(await a.PostAsJsonAsync("/api/v1/office/drivers",new{fullName="عدنان خالد",phone="0592222222",active=true,status="Available"}));var secondId=Id(second);
            var state=await Body(await a.GetAsync("/api/v1/office"));var classId=Id(state["classes"]![0]!);
            async Task<JsonObject> Vehicle(string driver,string plate) => await Body(await a.PostAsJsonAsync("/api/v1/office/vehicles",new{plate,driverId=driver,vehicleClassId=classId,make="Kia",model="Niro",color="White",year=2024,active=true,status="ACTIVE"}));
            var carA=await Vehicle(firstId,"39-123-45");var carB=await Vehicle(firstId,"39-123-46");var carC=await Vehicle(secondId,"12-456-78");
            first["currentVehicleId"]=Id(carA);first["updateVehicle"]=true;first["assignmentNotes"]="تبديل تجريبي";first=await Body(await a.PutAsJsonAsync("/api/v1/office/drivers/"+firstId,first));
            var historyResponse=await a.GetAsync($"/api/v1/office/drivers/{firstId}/assignments");Assert.True(historyResponse.IsSuccessStatusCode);var history=JsonNode.Parse(await historyResponse.Content.ReadAsStringAsync())!.AsArray();Assert.Equal(3,history.Count);Assert.Single(history,h=>h!["endedAt"] is null);Assert.All(history,h=>Assert.NotNull(h!["changedBy"]));Assert.Equal("39-123-45",history[0]!["plate"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NotFound,(await b.GetAsync($"/api/v1/office/drivers/{firstId}/assignments")).StatusCode);
            var one=Id(await Body(await a.PostAsJsonAsync("/api/v1/office/queue-locations",new{name="موقع تجريبي أول",isActive=true,sortOrder=0})));var two=Id(await Body(await a.PostAsJsonAsync("/api/v1/office/queue-locations",new{name="موقع تجريبي ثان",isActive=true,sortOrder=1})));
            async Task<HttpResponseMessage> Queue(string type,string driver,string location,bool confirmTransfer=false,string? fromLocationId=null,string? beforeDriverId=null) => await a.PostAsJsonAsync("/api/v1/office/queue",new{type,driverId=driver,queueLocationId=location,confirmTransfer,fromLocationId,beforeDriverId});
            async Task<JsonArray> Entries(){return (await Body(await a.GetAsync("/api/v1/office")))["reception"]!["queue"]!.AsArray();}
            Assert.Equal(HttpStatusCode.OK,(await Queue("add",firstId,one)).StatusCode);Assert.Equal(1,(await Entries())[0]!["position"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.OK,(await Queue("add",secondId,one)).StatusCode);
            var third=await Body(await a.PostAsJsonAsync("/api/v1/office/drivers",new{fullName="رائد",phoneLocal="0593333333",active=true,status="Offline"}));
            Assert.Equal(HttpStatusCode.OK,(await Queue("add",Id(third),two)).StatusCode);
            Assert.Equal(new[]{1,2,3},(await Entries()).Select(q=>q!["position"]!.GetValue<int>()));
            Assert.All(await Entries(),q=>Assert.Null(q!["shiftId"]));
            Assert.Empty((await Body(await a.GetAsync("/api/v1/office")))["reception"]!["shifts"]!.AsArray());
            Assert.Equal(HttpStatusCode.OK,(await Queue("remove",Id(third),two)).StatusCode);
            var rows=await Entries();Assert.Equal(new[]{1,2},rows.Select(r=>r!["position"]!.GetValue<int>()));var entered=rows.Single(r=>r!["driverId"]!.GetValue<string>()==secondId)!["enteredAt"]!.GetValue<string>();
            var duplicate=await Task.WhenAll(Enumerable.Range(0,4).Select(_=>Queue("add",secondId,one)));Assert.All(duplicate,r=>Assert.Equal(HttpStatusCode.OK,r.StatusCode));Assert.Equal(2,(await Entries()).Count);
            Assert.Equal(HttpStatusCode.Conflict,(await Queue("add",secondId,two)).StatusCode);Assert.Equal(HttpStatusCode.OK,(await Queue("transfer",secondId,two,true,one)).StatusCode);
            rows=await Entries();Assert.Equal(new[]{1,2},rows.Select(r=>r!["position"]!.GetValue<int>()));Assert.Equal(entered,rows.Single(r=>r!["driverId"]!.GetValue<string>()==secondId)!["enteredAt"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.OK,(await Queue("transfer",secondId,one,true,two)).StatusCode);Assert.Equal(HttpStatusCode.OK,(await Queue("up",secondId,one)).StatusCode);rows=await Entries();Assert.Equal(secondId,rows[0]!["driverId"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.OK,(await Queue("down",secondId,one)).StatusCode);Assert.Equal(HttpStatusCode.OK,(await Queue("move",secondId,one,beforeDriverId:firstId)).StatusCode);
            Assert.Equal(entered,(await Entries())[0]!["enteredAt"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.Conflict,(await a.PutAsJsonAsync("/api/v1/office/queue-locations/"+one,new{name="موقع تجريبي أول",isActive=false,sortOrder=0})).StatusCode);
            // Real request assignment keeps queue metadata intact, with BUSY display.
            var ride=await Body(await a.PostAsJsonAsync("/api/v1/ride-requests",new{source="MANUAL",location=new{addressText="عنوان يدوي",locationSource="MANUAL_TEXT"}}));
            state=await Body(await a.GetAsync("/api/v1/office"));var requestRow=state["reception"]!["rides"]!.AsArray().Single(r=>r!["rideRequestId"]!.GetValue<string>()==ride["rideRequestId"]!.GetValue<string>())!.DeepClone().AsObject();var firstQueue=state["reception"]!["queue"]!.AsArray().Single(q=>q!["driverId"]!.GetValue<string>()==firstId)!;
            requestRow["driverId"]=firstId;requestRow["shiftId"]=null;requestRow["status"]="assigned";
            requestRow["status"]="pending";requestRow["dispatchStatus"]="PENDING";requestRow["addressText"]="عنوان متغير يدوي";requestRow["addressType"]="VARIABLE";
            requestRow=await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(requestRow),requestRow));
            Assert.Equal(firstId,requestRow["driverId"]!.GetValue<string>());Assert.Equal("PENDING",requestRow["dispatchStatus"]!.GetValue<string>());Assert.Equal("VARIABLE",requestRow["addressType"]!.GetValue<string>());
            requestRow["status"]="assigned";requestRow["dispatchStatus"]="SENT";
            requestRow=await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(requestRow),requestRow));rows=await Entries();Assert.Equal(2,rows.Count);Assert.Equal(firstQueue["enteredAt"]!.ToJsonString(),rows.Single(r=>r!["driverId"]!.GetValue<string>()==firstId)!["enteredAt"]!.ToJsonString());Assert.Equal("BUSY",rows.Single(r=>r!["driverId"]!.GetValue<string>()==firstId)!["status"]!.GetValue<string>());
            var busyQueuedEntry=rows.Single(r=>r!["driverId"]!.GetValue<string>()==firstId)!;var busyPosition=busyQueuedEntry["position"]!.GetValue<int>();var busyEnteredAt=busyQueuedEntry["enteredAt"]!.GetValue<string>();
            Assert.Equal(HttpStatusCode.OK,(await Queue("transfer",firstId,two,true,one)).StatusCode);var transferred=(await Entries()).Single(r=>r!["driverId"]!.GetValue<string>()==firstId)!;
            Assert.Equal(two,transferred["queueLocationId"]!.GetValue<string>());Assert.Equal(busyPosition,transferred["position"]!.GetValue<int>());Assert.Equal(busyEnteredAt,transferred["enteredAt"]!.GetValue<string>());
            foreach(var (dispatch,status) in new[]{("REJECTED","waiting"),("PENDING","pending"),("SENT","assigned"),("ACCEPTED","driver-accepted"),("ARRIVED","arrived"),("STARTED","in-progress"),("COMPLETED","completed")}) {
                requestRow["dispatchStatus"]=dispatch;requestRow["status"]=status;
                requestRow=await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(requestRow),requestRow));Assert.Equal(dispatch,requestRow["dispatchStatus"]!.GetValue<string>());
            }
            using(var auditScope=factory.Services.CreateScope()) {
                var auditDb=auditScope.ServiceProvider.GetRequiredService<TaxiDb>();var context=auditScope.ServiceProvider.GetRequiredService<TenantContext>();
                context.TenantId=(await auditDb.Set<Tenant>().SingleAsync(t=>t.Slug=="queue-a")).Id;
                var log=await auditDb.Set<AuditLog>().Where(l=>l.Action=="reception.status-changed").OrderBy(l=>l.CreatedAt).ToListAsync();
                Assert.Equal(8,log.Count);Assert.All(log,l=>{Assert.NotEqual(Guid.Empty,l.ActorId);Assert.True(l.CreatedAt>DateTimeOffset.UtcNow.AddMinutes(-5));Assert.NotNull(JsonNode.Parse(l.Detail)!["previous"]);Assert.NotNull(JsonNode.Parse(l.Detail)!["next"]);});
                context.TenantId=(await auditDb.Set<Tenant>().SingleAsync(t=>t.Slug=="queue-b")).Id;Assert.Empty(await auditDb.Set<AuditLog>().Where(l=>l.Action=="reception.status-changed").ToListAsync());
            }
            foreach(var phase in new[]{"pending","waiting","assigned","driver-accepted","arrived","in-progress"}) {
                var created=await Body(await a.PostAsJsonAsync("/api/v1/ride-requests",new{source="MANUAL",location=new{addressText="reassignment test",locationSource="MANUAL_TEXT"}}));
                var snap=await Body(await a.GetAsync("/api/v1/office"));
                var item=snap["reception"]!["rides"]!.AsArray().Single(r=>r!["rideRequestId"]!.GetValue<string>()==created["rideRequestId"]!.GetValue<string>())!.DeepClone().AsObject();
                item["driverId"]=firstId;item["status"]=phase;item.Remove("dispatchStatus");if(phase=="waiting")item["dispatchStatus"]="REJECTED";
                item=await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(item),item));
                var positions=(await Entries()).Select(q=>(q!["driverId"]!.ToString(),q["position"]!.ToString(),q["enteredAt"]!.ToString())).ToArray();
                item["driverId"]=secondId;var retry=item.DeepClone();
                item=await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(item),item));
                Assert.Equal(secondId,item["driverId"]!.ToString());Assert.Equal("PENDING",item["dispatchStatus"]!.ToString());Assert.Equal("pending",item["status"]!.ToString());
                Assert.True(JsonNode.DeepEquals(item,await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(item),retry))));
                Assert.Equal(positions,(await Entries()).Select(q=>(q!["driverId"]!.ToString(),q["position"]!.ToString(),q["enteredAt"]!.ToString())).ToArray());
                item["status"]=phase=="pending"?"cancelled":"completed";item.Remove("dispatchStatus");
                item=await Body(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(item),item));item["driverId"]=firstId;
                Assert.Equal(HttpStatusCode.Conflict,(await a.PutAsJsonAsync("/api/v1/reception/rides/"+Id(item),item)).StatusCode);
            }
            using(var auditScope=factory.Services.CreateScope()) {
                var auditDb=auditScope.ServiceProvider.GetRequiredService<TaxiDb>();auditScope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=(await auditDb.Set<Tenant>().SingleAsync(t=>t.Slug=="queue-a")).Id;
                var logs=await auditDb.Set<AuditLog>().Where(l=>l.Action=="reception.driver-reassigned").ToListAsync();Assert.Equal(6,logs.Count);
                Assert.All(logs,l=>{var detail=JsonNode.Parse(l.Detail)!;Assert.Equal(firstId,detail["previousDriverId"]!.ToString());Assert.Equal(secondId,detail["newDriverId"]!.ToString());Assert.NotEqual(Guid.Empty,l.ActorId);Assert.True(l.CreatedAt>DateTimeOffset.UtcNow.AddMinutes(-5));});
            }
            Assert.Equal(HttpStatusCode.OK,(await Queue("remove",secondId,one)).StatusCode);Assert.Equal(1,(await Entries())[0]!["position"]!.GetValue<int>());
            Assert.Equal(HttpStatusCode.BadRequest,(await b.PostAsJsonAsync("/api/v1/office/queue",new{type="add",driverId=firstId,queueLocationId=one})).StatusCode);Assert.Empty((await Body(await b.GetAsync("/api/v1/office")))["reception"]!["queue"]!.AsArray());
            Assert.Equal(HttpStatusCode.NotFound,(await b.PutAsJsonAsync("/api/v1/office/queue-locations/"+one,new{name="spoof",isActive=true,sortOrder=0})).StatusCode);
        } finally {NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
    [PostgresFact]
    public async Task MigrationPreservesExistingQueueEntryAndVehicleLink()
    {
        var cs=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;await using var admin=new NpgsqlConnection(cs);await admin.OpenAsync();var database="taxi_test_"+Guid.NewGuid().ToString("N");await using(var c=new NpgsqlCommand($"CREATE DATABASE {database}",admin))await c.ExecuteNonQueryAsync();
        try {
            await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(cs){Database=database}.ConnectionString);using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();
            await db.Database.MigrateAsync();await Seed.RunAsync(db,tenant,SeedConfig("upgrade"));await db.GetService<IMigrator>().MigrateAsync("20260927151823_OfficeFleetBasics");db.ChangeTracker.Clear();var user=await db.Set<User>().SingleAsync();var vehicleClass=await db.Set<VehicleClass>().FirstAsync();
            var d=Guid.NewGuid();var v=Guid.NewGuid();var s=Guid.NewGuid();var q=Guid.NewGuid();var at=DateTimeOffset.Parse("2026-09-20T10:00:00Z");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Driver\" (\"Id\",\"TenantId\",\"UserId\",\"FullName\",\"Status\",\"Phone\",\"Active\") VALUES ({d},{tenant.TenantId},{user.Id},{"old driver"},{1},{"+972591111111"},{true})");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Vehicle\" (\"Id\",\"TenantId\",\"DriverId\",\"VehicleClassId\",\"Plate\",\"Make\",\"Model\",\"Color\",\"Status\",\"Active\") VALUES ({v},{tenant.TenantId},{d},{vehicleClass.Id},{"OLD-1"},{"Kia"},{"Niro"},{"White"},{"ACTIVE"},{true})");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"ReceptionShift\" (\"Id\",\"TenantId\",\"DriverId\",\"VehicleId\",\"Active\",\"StartTime\") VALUES ({s},{tenant.TenantId},{d},{v},{true},{at})");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"ReceptionQueue\" (\"Id\",\"TenantId\",\"ShiftId\",\"Position\",\"JoinedAt\") VALUES ({q},{tenant.TenantId},{s},{0},{at})");
            await db.Database.MigrateAsync();db.ChangeTracker.Clear();var entry=await db.Set<ReceptionQueue>().SingleAsync();Assert.Equal(d,entry.DriverId);Assert.Equal(at,entry.JoinedAt);Assert.Equal(1,entry.Position);Assert.NotNull(entry.QueueLocationId);Assert.Equal(v,(await db.Set<Driver>().SingleAsync()).CurrentVehicleId);Assert.Single(await db.Set<DriverVehicleAssignment>().ToListAsync()); Assert.Equal("0591111111",(await db.Set<Driver>().SingleAsync()).PhoneLocal); Assert.Equal("+972",(await db.Set<Driver>().SingleAsync()).WhatsappCountryCode);
        } finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {database} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}
