using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;
public sealed record FareInput(string Mode, decimal? Amount, long Version, string? Reason=null);
public sealed record FareSettingsInput(PricingRule Rule, string Currency, bool AllowDriverManual);
public static class FareEndpoints
{
    public static void MapFares(this WebApplication app)
    {
        app.MapGet("/api/v1/fare/settings", async (TaxiDb db) => {
            var rule=await db.Set<PricingRule>().AsNoTracking().Where(r=>r.Mode==PricingMode.GpsMeter).OrderBy(r=>r.Id).FirstOrDefaultAsync();
            var profile=rule is null?null:await db.Set<PricingProfile>().SingleAsync(p=>p.Id==rule.PricingProfileId);
            return Results.Ok(new{rule,currency=profile?.Currency??"ILS",allowDriverManual=await db.Set<FeatureFlag>().AnyAsync(f=>f.Key=="DriverManualFare"&&f.Enabled)});
        }).RequireAuthorization("rides.read");
        app.MapPut("/api/v1/fare/settings", async (FareSettingsInput input, TaxiDb db,TenantContext tenant,ReceptionService reception) => {
            if(input.Rule is null || input.Currency is null || input.Currency.Length!=3 || !System.Text.RegularExpressions.Regex.IsMatch(input.Currency,"^[A-Z]{3}$"))return Results.BadRequest();
            input.Rule.Mode=PricingMode.GpsMeter;PricingEngine.Validate(input.Rule);
            await using var tx=await db.Database.BeginTransactionAsync();await reception.Lock();
            var rule=await db.Set<PricingRule>().Where(r=>r.Mode==PricingMode.GpsMeter).OrderBy(r=>r.Id).FirstOrDefaultAsync();
            if(rule is null){var office=await db.Set<Office>().FirstOrDefaultAsync();var profile=new PricingProfile{Name="أجرة المشوار",Currency=input.Currency,TimeZone=office?.TimeZone??"Asia/Jerusalem"};db.Add(profile);rule=new PricingRule{PricingProfileId=profile.Id,Mode=PricingMode.GpsMeter};db.Add(rule);}
            var pricingProfile=db.Set<PricingProfile>().Local.FirstOrDefault(p=>p.Id==rule.PricingProfileId)??await db.Set<PricingProfile>().SingleAsync(p=>p.Id==rule.PricingProfileId);
            pricingProfile.Currency=input.Currency;
            rule.BaseFare=input.Rule.BaseFare;rule.PerKm=input.Rule.PerKm;rule.PerMinute=input.Rule.PerMinute;rule.MinimumFare=input.Rule.MinimumFare;rule.WaitingPerMinute=input.Rule.WaitingPerMinute;
            rule.NightStartHour=input.Rule.NightStartHour;rule.NightEndHour=input.Rule.NightEndHour;rule.NightPercent=input.Rule.NightPercent;rule.NightFixed=input.Rule.NightFixed;rule.IncludedDistanceKm=input.Rule.IncludedDistanceKm;rule.ExtraFee=input.Rule.ExtraFee;
            var flag=await db.Set<FeatureFlag>().SingleOrDefaultAsync(f=>f.Key=="DriverManualFare");if(flag is null){flag=new FeatureFlag{Key="DriverManualFare"};db.Add(flag);}flag.Enabled=input.AllowDriverManual;
            db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=rule.Id,Action="fare.settings",Detail=System.Text.Json.JsonSerializer.Serialize(input)});
            await db.SaveChangesAsync();await tx.CommitAsync();return Results.Ok(new{rule,currency=input.Currency,allowDriverManual=flag.Enabled});
        }).RequireAuthorization("settings.write");
        app.MapPut("/api/v1/rides/{id:guid}/fare",async (Guid id,FareInput input,TaxiDb db,TenantContext tenant,ReceptionService reception,HttpContext http)=>{
            if(!RideFare.Modes.Contains(input.Mode)||input.Amount is <0 or >10000000||input.Reason?.Length>1000 || (input.Mode!="GPS_METER"&&!input.Amount.HasValue))return Results.BadRequest();
            if(input.Amount.HasValue&&decimal.Round(input.Amount.Value,2)!=input.Amount.Value)return Results.BadRequest();
            var office=http.User.HasClaim("permission","pricing.adjust");
            if(office&&input.Mode=="DRIVER_MANUAL")return Results.BadRequest();
            await using var tx=await db.Database.BeginTransactionAsync();await reception.Lock();
            var ride=await db.Set<Ride>().SingleOrDefaultAsync(r=>r.Id==id);if(ride is null)return Results.NotFound();
            if(!office){
                var driver=await DriverEndpoints.CurrentDriver(db,tenant);
                if(driver is null||ride.DriverId!=driver.Id||input.Mode!="DRIVER_MANUAL"||ride.Status is not (RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress)||!await db.Set<FeatureFlag>().AnyAsync(f=>f.Key=="DriverManualFare"&&f.Enabled))return Results.Forbid();
                if(ride.FareMode=="GPS_METER")return Results.Conflict(new{error="الرحلة تستخدم عداد GPS"});
            }
            if(ride.Version!=input.Version)return Results.Conflict();
            if(ride.Status==RideStatus.Cancelled)return Results.Conflict();
            if(input.Mode=="GPS_METER"){
                if(ride.MeterStartedAt.HasValue||ride.Status is RideStatus.InProgress or RideStatus.Completed)return Results.Conflict();
                if(!await db.Set<PricingRule>().AnyAsync(r=>r.Mode==PricingMode.GpsMeter))return Results.Conflict(new{error="إعدادات عداد GPS غير مهيأة"});
                var old=ride.FinalFare;ride.FareMode=input.Mode;ride.FinalFare=null;ride.FareSource=null;RideFare.Audit(db,tenant.ActorId,ride,old,input.Reason);
            }else{
                var old=ride.FinalFare;if(ride.FareUpdatedAt is null)ride.Currency=await RideFare.ReadCurrency(db);ride.FinalFare=input.Amount;ride.FareSource=office&&ride.FareMode=="GPS_METER"?"OFFICE_OVERRIDE":input.Mode;
                if(ride.FareMode!="GPS_METER")ride.FareMode=input.Mode;
                RideFare.Audit(db,tenant.ActorId,ride,old,input.Reason);
            }
            ride.FareUpdatedAt=DateTimeOffset.UtcNow;ride.FareUpdatedBy=tenant.ActorId;
            await RideFare.SyncLegacy(db,tenant.ActorId,ride,input.Reason);await reception.SyncRide(ride);await db.SaveChangesAsync();await tx.CommitAsync();return Results.Ok(ride);
        }).RequireAuthorization(p=>p.RequireAssertion(c=>c.User.HasClaim("permission","pricing.adjust")||c.User.HasClaim("permission","rides.drive")));
    }
}
