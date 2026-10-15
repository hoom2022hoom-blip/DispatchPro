using DispatchPro.Api.Services;
using Microsoft.Extensions.Configuration;
using System.Text.Json;
using Xunit;

namespace DispatchPro.Tests;
public sealed class DriverQaSafetyTests
{
    private static IConfiguration Config(string database="dispatchpro_driverqa_fixture",string user="driverqa_fixture",bool push=false) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{
        ["ConnectionStrings:Taxi"]=$"Host=127.0.0.1;Database={database};Username={user}",["CustomerPush:Enabled"]=push.ToString(),["CustomerSms:Provider"]="QA_DISABLED",["Qa:TenantSlug"]="driver-qa"}).Build();
    [Fact] public void OnlyDedicatedDatabaseRoleAndDisabledExternalPushAreAllowed(){DriverQaSafety.Validate(Config());Assert.Throws<InvalidOperationException>(()=>DriverQaSafety.Validate(Config("DispatchProTaxi")));Assert.Throws<InvalidOperationException>(()=>DriverQaSafety.Validate(Config(user:"postgres")));Assert.Throws<InvalidOperationException>(()=>DriverQaSafety.Validate(Config(push:true)));}
    [Fact] public void NestedRealPhoneFieldsAreRejectedButEmptyOrSyntheticLabelsRemainSafe(){using var good=JsonDocument.Parse("{\"phone\":\"QA-PEER\",\"passengerPhone\":\"\"}");using var bad=JsonDocument.Parse("{\"payload\":[{\"callerNumber\":\"PHONE_NUMBER_NOT_ALLOWED\"}]}");Assert.False(DriverQaSafety.RealPhone(good.RootElement));Assert.True(DriverQaSafety.RealPhone(bad.RootElement));}
}
