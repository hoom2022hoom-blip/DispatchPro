using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Services;

public sealed record DriverEligibilityRow(Guid DriverId, string? Username, bool AccountActive, bool Online, bool Available, bool VehicleReady, string LocationStatus, DateTimeOffset? LocationUpdatedAt, double? LocationAccuracy, bool Eligible, string[] Reasons, object DriverConnection, object RadioConnection, object VoiceState);
public static class DriverEligibility
{
    public static async Task<DriverEligibilityRow[]> Read(TaxiDb db, ReceptionService reception, AutoDispatch dispatch, MobilePresence presence, VoiceRooms rooms)
    {
        var cutoff=DateTimeOffset.UtcNow.AddSeconds(-(await dispatch.Policy()).LocationMaxAgeSeconds);
        var drivers=await db.Set<Driver>().AsNoTracking().ToListAsync();
        var users=await db.Set<User>().AsNoTracking().ToDictionaryAsync(u=>u.Id);
        var locations=await db.Set<DriverLocation>().AsNoTracking().ToDictionaryAsync(l=>l.DriverId);
        var vehicles=await db.Set<Vehicle>().AsNoTracking().ToListAsync();
        var linked=await db.Set<DriverVehicleAssignment>().Select(a=>a.DriverId).Distinct().ToListAsync();
        var active=await db.Set<Ride>().Where(r=>r.DriverId!=null&&(r.Status>=RideStatus.Assigned&&r.Status<=RideStatus.InProgress||r.Status==RideStatus.DriverArriving)).Select(r=>r.DriverId!.Value).ToListAsync();
        var rows=new List<DriverEligibilityRow>();
        var activeOrders=await reception.ActiveOrderDrivers();
        foreach(var d in drivers){
            locations.TryGetValue(d.Id,out var location);users.TryGetValue(d.UserId,out var user);
            var vehicleReady=vehicles.Any(v=>v.Id==d.CurrentVehicleId&&v.Active&&v.Status=="ACTIVE")||d.CurrentVehicleId==null&&!linked.Contains(d.Id)&&vehicles.Count(v=>v.DriverId==d.Id&&v.Active&&v.Status=="ACTIVE")==1;
            var reasons=new List<string>();
            if(!d.Active)reasons.Add("INACTIVE");
            if(!d.DriverAppEnabled)reasons.Add("DRIVER_APP_DISABLED");
            if(user?.Active!=true)reasons.Add("ACCOUNT_DISABLED");
            if(d.Status!=DriverStatus.Available)reasons.Add(d.Status==DriverStatus.Busy?"BUSY":"OFFLINE");
            var gps=AutoDispatch.LocationReason(location,cutoff);if(gps!="READY")reasons.Add(gps);
            if(!vehicleReady)reasons.Add(d.CurrentVehicleId==null&&(!vehicles.Any(v=>v.DriverId==d.Id)||linked.Contains(d.Id))?"NO_LINKED_VEHICLE":"NO_READY_VEHICLE");
            if(active.Contains(d.Id)||activeOrders.Contains(d.Id))reasons.Add("ACTIVE_ORDER");
            rows.Add(new(d.Id,user?.PasswordHash?.Length>0?user.Username:null,user?.Active==true,d.Active&&d.Status is DriverStatus.Available or DriverStatus.Busy,d.Active&&d.Status==DriverStatus.Available,vehicleReady,gps,location?.UpdatedAt,location?.Accuracy,reasons.Count==0,reasons.ToArray(),presence.Read(db.CurrentTenant,d.Id,"driver"),presence.Read(db.CurrentTenant,d.Id,"radio"),rooms.DriverState(db.CurrentTenant,d.Id)));
        }
        return rows.ToArray();
    }
}
