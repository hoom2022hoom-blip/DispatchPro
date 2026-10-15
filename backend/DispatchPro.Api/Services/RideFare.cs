using System.Text.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Endpoints;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed record MeterTariff(PricingRule Rule, PricingProfile Profile);
public static class RideFare
{
    public static readonly string[] Modes = ["OFFICE_MANUAL", "DRIVER_MANUAL", "GPS_METER"];
    public static async Task<string> ReadCurrency(TaxiDb db) => await (from rule in db.Set<PricingRule>() join profile in db.Set<PricingProfile>() on rule.PricingProfileId equals profile.Id where rule.Mode==PricingMode.GpsMeter orderby rule.Id select profile.Currency).FirstOrDefaultAsync()??"ILS";
    public static async Task Start(TaxiDb db, Ride ride)
    {
        if (ride.FareMode != "GPS_METER" || ride.MeterStartedAt.HasValue) return;
        var rule = await db.Set<PricingRule>().AsNoTracking().Where(r => r.Mode == PricingMode.GpsMeter).OrderBy(r => r.Id).FirstOrDefaultAsync()
            ?? throw new ReceptionConflictException("إعدادات عداد GPS غير مهيأة");
        var profile = await db.Set<PricingProfile>().AsNoTracking().SingleAsync(p => p.Id == rule.PricingProfileId);
        PricingEngine.Validate(rule);
        ride.MeterTariff = JsonSerializer.Serialize(new MeterTariff(rule, profile));
        ride.Currency = profile.Currency; ride.MeterStartedAt = DateTimeOffset.UtcNow;
        ride.DistanceKm = 0; ride.WaitingSeconds = 0;
        ride.MeterCalculatedFare = Calculate(ride, ride.MeterStartedAt.Value);
    }
    public static decimal Calculate(Ride ride, DateTimeOffset now)
    {
        var tariff = JsonSerializer.Deserialize<MeterTariff>(ride.MeterTariff!)!;
        return PricingEngine.Calculate(tariff.Rule, tariff.Profile,
            new MeterInput(ride.DistanceKm ?? 0, (decimal)Math.Max(0,(now-ride.MeterStartedAt!.Value).TotalMinutes), (ride.WaitingSeconds ?? 0)/60m, ride.MeterStartedAt.Value))!.Value;
    }
    public static double Meters(double lat, double lon, double lat2, double lon2)
    {
        const double rad = Math.PI/180;
        var a = Math.Pow(Math.Sin((lat2-lat)*rad/2),2)+Math.Cos(lat*rad)*Math.Cos(lat2*rad)*Math.Pow(Math.Sin((lon2-lon)*rad/2),2);
        return 6371000*2*Math.Asin(Math.Sqrt(Math.Clamp(a,0,1)));
    }
    // Unobserved gaps never generate distance or waiting fees; noise inside the uncertainty radius does not bill.
    public static bool Accept(Ride ride, DriverLocationInput point, DateTimeOffset now)
    {
        if(ride.FareMode!="GPS_METER" || ride.MeterStartedAt is null || ride.MeterStoppedAt is not null || ride.Status!=RideStatus.InProgress) return false;
        if(!double.IsFinite(point.Accuracy)||point.Accuracy is <0 or >50 || !double.IsFinite(point.Latitude)||!double.IsFinite(point.Longitude)||Math.Abs(point.Latitude)>90||Math.Abs(point.Longitude)>180||point.CapturedAt<ride.MeterStartedAt||point.CapturedAt<now.AddSeconds(-60)||point.CapturedAt>now.AddSeconds(10)) return false;
        if(ride.MeterLastAt.HasValue && point.CapturedAt<=ride.MeterLastAt.Value) return false;
        if(ride.MeterLastAt.HasValue){
            var seconds=(point.CapturedAt-ride.MeterLastAt.Value).TotalSeconds;
            var meters=Meters(ride.MeterLastLatitude!.Value,ride.MeterLastLongitude!.Value,point.Latitude,point.Longitude);
            if(seconds<10 || meters/seconds>55) return false;
            if(seconds<=60){
                if(meters>Math.Max(10,point.Accuracy+ride.MeterLastAccuracy!.Value)) ride.DistanceKm=(ride.DistanceKm??0)+(decimal)(meters/1000);
                else ride.WaitingSeconds=(ride.WaitingSeconds??0)+(int)seconds;
            }
        }
        ride.MeterLastAt=point.CapturedAt.ToUniversalTime();ride.MeterLastLatitude=point.Latitude;ride.MeterLastLongitude=point.Longitude;ride.MeterLastAccuracy=point.Accuracy;
        ride.MeterCalculatedFare=Calculate(ride,now);ride.DurationSeconds=(int)Math.Max(0,(now-ride.MeterStartedAt.Value).TotalSeconds);ride.FareCalculatedAt=now;
        return true;
    }
    public static void Audit(TaxiDb db, Guid actor, Ride ride, decimal? old, string? reason=null)
    {
        db.Add(new AuditLog{ActorId=actor,EntityId=ride.Id,Action="fare.changed",Detail=JsonSerializer.Serialize(new{rideId=ride.Id,oldFare=old,newFare=ride.FinalFare,source=ride.FareSource,changedBy=actor,timestamp=DateTimeOffset.UtcNow,reason})});
    }
    public static async Task SyncLegacy(TaxiDb db, Guid actor, Ride ride, string? reason=null)
    {
        if(!ride.FinalFare.HasValue)return;
        var price=await db.Set<RidePrice>().SingleOrDefaultAsync(p=>p.RideId==ride.Id);
        if(price is null)return;
        if(price.FinalPrice!=ride.FinalFare){
            db.Add(new PriceAdjustment{RidePriceId=price.Id,PreviousPrice=price.FinalPrice,FinalPrice=ride.FinalFare.Value,AdjustedBy=actor,Reason=reason??ride.FareSource??"fare"});
            price.FinalPrice=ride.FinalFare;price.AdjustedBy=actor;
        }
        if(ride.FareMode=="GPS_METER"&&ride.MeterCalculatedFare.HasValue)price.CalculatedPrice=ride.MeterCalculatedFare;
    }
    public static void Finish(TaxiDb db, Guid actor, Ride ride, bool finalize=true)
    {
        if(ride.FareMode!="GPS_METER"||ride.MeterStartedAt is null||ride.MeterStoppedAt.HasValue)return;
        var now=DateTimeOffset.UtcNow;ride.MeterStoppedAt=now;ride.DurationSeconds=(int)(now-ride.MeterStartedAt.Value).TotalSeconds;
        ride.MeterCalculatedFare=Calculate(ride,now);ride.FareCalculatedAt=now;
        if(finalize&&ride.FareSource!="OFFICE_OVERRIDE") {var old=ride.FinalFare;ride.FinalFare=ride.MeterCalculatedFare;ride.FareSource="GPS_METER";ride.FareUpdatedAt=now;ride.FareUpdatedBy=actor;Audit(db,actor,ride,old);}
    }
    public static void Project(JsonObject data, Ride ride)
    {
        data["fareMode"]=ride.FareMode;data["fareSource"]=ride.FareSource;data["finalFare"]=ride.FinalFare;data["meterCalculatedFare"]=ride.MeterCalculatedFare;
        data["currency"]=ride.Currency;data["distanceKm"]=ride.DistanceKm;data["durationSeconds"]=ride.DurationSeconds;data["waitingSeconds"]=ride.WaitingSeconds;data["fareUpdatedBy"]=ride.FareUpdatedBy;data["fareUpdatedAt"]=ride.FareUpdatedAt;
        data["fareCalculatedAt"]=ride.FareCalculatedAt;
        data["totalFare"]=ride.FinalFare;
    }
}
