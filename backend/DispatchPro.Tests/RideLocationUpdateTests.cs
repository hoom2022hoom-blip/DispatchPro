using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Xunit;
using System.Net;
using System.Net.Http.Json;

namespace DispatchPro.Tests;
public sealed class RideLocationUpdateTests
{
    [Fact] public void OfficePlaceRequiresExplicitCoordinatesAndRejectsMissingOrInvalidPoint()
    {
        Assert.Throws<ArgumentException>(()=>SuggestedPlaceEndpoints.Validate(new("name",null,null,null,0,true)));
        Assert.Throws<ArgumentException>(()=>SuggestedPlaceEndpoints.Validate(new("name",null,32,null,0,true)));
        Assert.Throws<ArgumentException>(()=>SuggestedPlaceEndpoints.Validate(new("name",null,100,35,0,true)));
        SuggestedPlaceEndpoints.Validate(new("موقع",null,32.2,35.2,0,true));
    }
    [Theory]
    [InlineData(RideStatus.Accepted)] [InlineData(RideStatus.DriverArriving)] [InlineData(RideStatus.Arrived)]
    public void BeforeStartPickupAndDestinationEditPreservesIdentityAssignmentDispatchAndFare(RideStatus status)
    {
        var ride=new Ride { Status=status, DriverId=Guid.NewGuid(), Version=8, DispatchMode="AUTO", FinalFare=40, FareMode="OFFICE_MANUAL" };
        var request=new RideRequest { Pickup="original", Destination="original destination" };
        var id=ride.Id;var driver=ride.DriverId;var requestId=ride.RideRequestId;
        var old=RideLocationEndpoints.Apply(ride,request,new(8,new("new pickup",Latitude:32.1,Longitude:35.1,LocationSource:"MAP_PIN"),new("new destination")));
        Assert.Contains("original",System.Text.Json.JsonSerializer.Serialize(old));Assert.Equal("new pickup",request.Pickup);Assert.Equal("new destination",request.Destination);
        Assert.Equal(id,ride.Id);Assert.Equal(requestId,ride.RideRequestId);Assert.Equal(driver,ride.DriverId);Assert.Equal("AUTO",ride.DispatchMode);Assert.Equal(status,ride.Status);Assert.Equal(40,ride.FinalFare);
    }
    [Fact] public void InProgressPickupCannotChangeAndDestinationDoesNotResetMeter()
    {
        var ride=new Ride {Status=RideStatus.InProgress,Version=2,FareMode="GPS_METER",DistanceKm=4,DurationSeconds=100,MeterCalculatedFare=25,MeterStartedAt=DateTimeOffset.UtcNow,MeterLastLatitude=32.1,MeterLastLongitude=35.1};
        var request=new RideRequest {Pickup="original",Destination="old",DestinationLatitude=32.2,DestinationLongitude=35.2};
        Assert.Throws<ReceptionConflictException>(()=>RideLocationEndpoints.Apply(ride,request,new(2,Pickup:new("changed"))));Assert.Equal("original",request.Pickup);
        RideLocationEndpoints.Apply(ride,request,new(2,Destination:new("updated")));Assert.Equal("updated",request.Destination);Assert.Null(request.DestinationLatitude);Assert.Equal("original",request.Pickup);Assert.Equal(4,ride.DistanceKm);Assert.Equal(100,ride.DurationSeconds);Assert.Equal(25,ride.MeterCalculatedFare);Assert.Equal(32.1,ride.MeterLastLatitude);
    }
    [Theory] [InlineData(RideStatus.Completed)] [InlineData(RideStatus.Cancelled)] [InlineData(RideStatus.Rejected)]
    public void TerminalAndUnacceptedRejectedRidesCannotEdit(RideStatus state)=>Assert.Throws<ReceptionConflictException>(()=>RideLocationEndpoints.Apply(new(){Status=state,Version=1},new(),new(1,Destination:new("new"))));
    [Fact] public void StaleAndInvalidInputCannotPartiallyMutate()
    {
        var ride=new Ride{Status=RideStatus.Accepted,Version=2};var request=new RideRequest{Pickup="original"};
        Assert.Throws<ReceptionConflictException>(()=>RideLocationEndpoints.Apply(ride,request,new(1,Pickup:new("new"))));
        Assert.Throws<ArgumentException>(()=>RideLocationEndpoints.Apply(ride,request,new(2,Pickup:new("new"),Destination:new("bad",Latitude:100,Longitude:35))));Assert.Equal("original",request.Pickup);
    }
    [Fact] public void AssignedQueryIncludesDriverAndTenantAndAuditPreservesOldNewActorAndSource()
    {
        var tenant=new TenantContext{TenantId=Guid.NewGuid(),ActorId=Guid.NewGuid()};using var db=new TaxiDb(new DbContextOptionsBuilder<TaxiDb>().UseNpgsql("Host=127.0.0.1;Port=1;Database=translation_only",p=>p.UseNetTopologySuite()).Options,tenant);
        var driverId=Guid.NewGuid();var ride=new Ride{Status=RideStatus.Accepted,Version=1};var request=new RideRequest{Pickup="original pickup",Destination="original destination"};
        var sql=RideLocationEndpoints.AssignedRide(db,ride.Id,driverId).ToQueryString();Assert.Contains(tenant.TenantId.ToString(),sql);Assert.Contains(driverId.ToString(),sql);Assert.Contains(ride.Id.ToString(),sql);
        var customerId=Guid.NewGuid();var customerSql=CustomerAppEndpoints.OwnRides(db,customerId).ToQueryString();Assert.Contains(tenant.TenantId.ToString(),customerSql);Assert.Contains(customerId.ToString(),customerSql);Assert.Contains("EXISTS",customerSql);
        var old=RideLocationEndpoints.Apply(ride,request,new(1,Destination:new("updated destination")));var at=DateTimeOffset.UtcNow;
        using var detail=System.Text.Json.JsonDocument.Parse(RideLocationEndpoints.AuditDetail(ride,request,old,tenant.ActorId,at,"DRIVER"));var root=detail.RootElement;
        Assert.Equal("original destination",root.GetProperty("previous").GetProperty("destination").GetString());Assert.Equal("updated destination",root.GetProperty("next").GetProperty("destination").GetString());Assert.Equal(ride.Id,root.GetProperty("rideId").GetGuid());Assert.Equal(tenant.ActorId,root.GetProperty("changedBy").GetGuid());Assert.Equal(at,root.GetProperty("changedAt").GetDateTimeOffset());Assert.Equal("DRIVER",root.GetProperty("source").GetString());
    }
    [Fact] public void DestinationEditKeepsCompletionTransitionAndDriverManualFareAvailable()
    {
        var ride=new Ride{Status=RideStatus.InProgress,Version=3,FareMode="DRIVER_MANUAL",FinalFare=55};var request=new RideRequest{Pickup="original",Destination="old"};
        RideLocationEndpoints.Apply(ride,request,new(3,Destination:new("updated")));
        Assert.True(RideWorkflow.CanTransition(ride.Status,RideStatus.Completed));Assert.Equal("DRIVER_MANUAL",ride.FareMode);Assert.Equal(55,ride.FinalFare);Assert.Equal(3,ride.Version);
    }
    [Fact] public void ActiveOfficePlacesAreTenantFilteredAndBoundedAndMigrationOnlyAddsTable()
    {
        var tenant=new TenantContext{TenantId=Guid.NewGuid()};using var db=new TaxiDb(new DbContextOptionsBuilder<TaxiDb>().UseNpgsql("Host=127.0.0.1;Port=1;Database=translation_only",p=>p.UseNetTopologySuite()).Options,tenant);
        var sql=SuggestedPlaceEndpoints.Active(db).ToQueryString();Assert.Contains(tenant.TenantId.ToString(),sql);Assert.Contains("IsActive",sql);Assert.Contains("IsDeleted",sql);Assert.Contains("LIMIT",sql);Assert.Contains("SortOrder",sql);
        var previous=db.GetService<IMigrationsAssembly>().Migrations.Keys.OrderBy(x=>x).Last(x=>string.CompareOrdinal(x,"20261002090000_OfficeSuggestedPlaces")<0);
        var migrationSql=db.GetService<IMigrator>().GenerateScript(previous, "20261002090000_OfficeSuggestedPlaces");
        Assert.Contains("CREATE TABLE",migrationSql);Assert.Contains("SuggestedPlace",migrationSql);Assert.DoesNotContain("DROP",migrationSql);Assert.DoesNotContain("DELETE FROM",migrationSql);
    }
    [Fact] public async Task NewRoutesDenyAnonymousBeforeDatabaseAccess()
    {
        await using var factory=new ApiFactory("Host=127.0.0.1;Port=1;Database=not_contacted;Timeout=1");using var client=factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/v1/office/suggested-places")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/v1/driver/places")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.PutAsJsonAsync($"/api/v1/rides/{Guid.NewGuid()}/locations",new{version=1,destination=new{addressText="test"}})).StatusCode);
    }
}
