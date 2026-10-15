using System.Net.Http.Json;
using System.Net.Http.Headers;
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
public sealed class ReceptionDeliveryRegressionTests{
    private static async Task<JsonNode> Json(HttpResponseMessage response){response.EnsureSuccessStatusCode();return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;}
    [PostgresFact]
    public async Task LandlineWhatsAppAndManualOrdersAppearOnceAndOpenDraftsSurviveMidnight(){
        var connection=Environment.GetEnvironmentVariable("TAXI_TEST_POSTGRES")!;var name="reception_delivery_"+Guid.NewGuid().ToString("N");
        await using var admin=new NpgsqlConnection(connection);await admin.OpenAsync();await using(var create=new NpgsqlCommand($"CREATE DATABASE {name}",admin))await create.ExecuteNonQueryAsync();
        try{await using var factory=new ApiFactory(new NpgsqlConnectionStringBuilder(connection){Database=name}.ConnectionString);Guid tenantId;
            using(var scope=factory.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();await db.Database.MigrateAsync();var tenant=scope.ServiceProvider.GetRequiredService<TenantContext>();await Seed.RunAsync(db,tenant,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"Seed:TenantSlug","delivery-test"},{"Seed:AdminPassword","Delivery-test-only-123!"}}).Build());tenantId=tenant.TenantId;}
            using var client=factory.CreateClient();var login=await Json(await client.PostAsJsonAsync("/api/v1/auth/login",new{tenant="delivery-test",username="admin",password="Delivery-test-only-123!"}));client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",login["accessToken"]!.GetValue<string>());
            foreach(var feature in new[]{"CallerId","WhatsApp"})(await client.PutAsync("/api/v1/features/"+feature+"?enabled=true",null)).EnsureSuccessStatusCode();
            foreach(var source in new[]{"LANDLINE","WHATSAPP"}){
                var input=new{source,callerNumber=source=="LANDLINE"?"0590000001":"0560000002",eventId="delivery-"+source,receivedAt=DateTimeOffset.UtcNow.ToString("O"),tenantId};
                var created=await Json(await client.PostAsJsonAsync("/api/v1/reception/bridge/calls",input));Assert.False(created["duplicate"]!.GetValue<bool>());
                var repeat=await Json(await client.PostAsJsonAsync("/api/v1/reception/bridge/calls",input));Assert.True(repeat["duplicate"]!.GetValue<bool>());
                var call=await Json(await client.GetAsync("/api/v1/reception/call-updates"));Assert.Equal(input.eventId,call["data"]!["eventId"]!.GetValue<string>());Assert.Equal(source=="LANDLINE"?"LANDLINE_ICALL":"WHATSAPP",call["data"]!["source"]!.GetValue<string>());
                var snapshot=await Json(await client.GetAsync("/api/v1/reception/snapshot"));var draft=Assert.Single(snapshot["rides"]!.AsArray(),r=>r!["callEventId"]?.GetValue<string>()==input.eventId)!.AsObject();Assert.True(draft["receptionPending"]!.GetValue<bool>());Assert.Null(draft["backendRideId"]);
                draft["pickup"]=new JsonObject{["name"]="عنوان اختبار",["coords"]=new JsonObject{["x"]=0,["y"]=0}};draft["addressText"]="عنوان اختبار";draft["dropoff"]=new JsonObject{["name"]="وجهة اختبار",["coords"]=new JsonObject{["x"]=0,["y"]=0}};draft["receptionPending"]=false;
                var id=draft["id"]!.GetValue<string>();await Json(await client.PutAsJsonAsync("/api/v1/reception/rides/"+id,draft));
                var saved=await Json(await client.GetAsync("/api/v1/reception/snapshot"));Assert.Single(saved["rides"]!.AsArray(),r=>r!["id"]!.GetValue<string>()==id);
            }
            var manual=new{id=Guid.NewGuid().ToString(),source="OFFICE",passengerName="طلب مكتب",passengerPhone="0000",pickup=new{name="عنوان مكتب",coords=new{x=0,y=0}},dropoff=new{name="وجهة مكتب",coords=new{x=0,y=0}},status="pending",movingFee=false};await Json(await client.PutAsJsonAsync("/api/v1/reception/rides/"+manual.id,manual));
            using(var scope=factory.Services.CreateScope()){scope.ServiceProvider.GetRequiredService<TenantContext>().TenantId=tenantId;var db=scope.ServiceProvider.GetRequiredService<TaxiDb>();Assert.Equal(2,await db.Set<ReceptionCall>().CountAsync());Assert.Equal(3,await db.Set<ReceptionOrder>().CountAsync());Assert.Equal(3,await db.Set<RideRequest>().CountAsync());
                foreach(var order in await db.Set<ReceptionOrder>().ToListAsync())order.Day="2026-09-01";await db.SaveChangesAsync();}
            var final=await Json(await client.GetAsync("/api/v1/reception/snapshot"));Assert.Equal(3,final["rides"]!.AsArray().Count);
        }finally{NpgsqlConnection.ClearAllPools();await using var drop=new NpgsqlCommand($"DROP DATABASE {name} WITH (FORCE)",admin);await drop.ExecuteNonQueryAsync();}
    }
}

