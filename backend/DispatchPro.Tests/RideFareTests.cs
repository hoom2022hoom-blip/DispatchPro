using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Services;
using Xunit;
namespace DispatchPro.Tests;
public sealed class RideFareTests
{
    private static Ride Session(DateTimeOffset at) => new(){Status=RideStatus.InProgress,FareMode="GPS_METER",MeterStartedAt=at,
        MeterTariff=JsonSerializer.Serialize(new MeterTariff(new PricingRule{Mode=PricingMode.GpsMeter,BaseFare=5,PerKm=2,MinimumFare=8,IncludedDistanceKm=1,ExtraFee=1},new PricingProfile()))};
    [Fact] public void FormulaIncludesDistanceAllowanceMinimumAndOptionalFees(){
        var at=DateTimeOffset.UtcNow;var ride=Session(at);
        Assert.Equal(8m,RideFare.Calculate(ride,at));ride.DistanceKm=3;
        Assert.Equal(10m,RideFare.Calculate(ride,at.AddMinutes(10)));
        var tariff=JsonSerializer.Deserialize<MeterTariff>(ride.MeterTariff!)!;tariff.Rule.PerMinute=1;tariff.Rule.WaitingPerMinute=2;ride.WaitingSeconds=60;ride.MeterTariff=JsonSerializer.Serialize(tariff);
        Assert.Equal(22m,RideFare.Calculate(ride,at.AddMinutes(10)));
    }
    [Fact] public void RealPointsAccumulateAndDuplicatesBadAccuracyStaleAndJumpsDoNotBill(){
        var start=DateTimeOffset.UtcNow.AddSeconds(-50);var ride=Session(start);
        var first=new DriverLocationInput(32,35,5,start.AddSeconds(1));
        Assert.True(RideFare.Accept(ride,first,start.AddSeconds(1)));
        Assert.False(RideFare.Accept(ride,first,start.AddSeconds(2)));
        Assert.False(RideFare.Accept(ride,new(32,35.001,150,start.AddSeconds(20)),start.AddSeconds(20)));
        Assert.False(RideFare.Accept(ride,new(33,36,5,start.AddSeconds(20)),start.AddSeconds(20)));
        Assert.False(RideFare.Accept(ride,new(32,35.001,5,start.AddSeconds(20)),start.AddSeconds(90)));
        Assert.True(RideFare.Accept(ride,new(32,35.001,5,start.AddSeconds(20)),start.AddSeconds(20)));
        Assert.InRange(ride.DistanceKm!.Value,0.09m,0.10m);
        var distance=ride.DistanceKm;
        Assert.False(RideFare.Accept(ride,new(32,35.002,5,start.AddSeconds(100)),start.AddSeconds(20)));
        Assert.Equal(distance,ride.DistanceKm);
    }
    [Fact] public void GapsAndNoiseDoNotInventDistance(){
        var start=DateTimeOffset.UtcNow;var ride=Session(start);
        RideFare.Accept(ride,new(32,35,10,start),start);
        RideFare.Accept(ride,new(32,35.00001,10,start.AddSeconds(15)),start.AddSeconds(15));
        Assert.Equal(0m,ride.DistanceKm??0);Assert.Equal(15,ride.WaitingSeconds);
        RideFare.Accept(ride,new(32,35.01,10,start.AddSeconds(120)),start.AddSeconds(120));
        Assert.Equal(0m,ride.DistanceKm??0);Assert.Equal(15,ride.WaitingSeconds);
    }
    [Fact] public void TerminalSessionsCannotAccumulate(){
        var now=DateTimeOffset.UtcNow;var ride=Session(now);ride.MeterStoppedAt=now;
        Assert.False(RideFare.Accept(ride,new(32,35,5,now),now));ride.MeterStoppedAt=null;ride.Status=RideStatus.Completed;
        Assert.False(RideFare.Accept(ride,new(32,35,5,now),now));
    }
    [Fact] public void TariffSnapshotIsUnaffectedByLaterSettings(){
        var now=DateTimeOffset.UtcNow;var rule=new PricingRule{Mode=PricingMode.GpsMeter,BaseFare=10};
        var ride=Session(now);ride.MeterTariff=JsonSerializer.Serialize(new MeterTariff(rule,new PricingProfile()));rule.BaseFare=100;
        Assert.Equal(10m,RideFare.Calculate(ride,now));
    }
}
