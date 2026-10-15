using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DispatchPro.Api.Endpoints;
public sealed record RideLocationUpdate(long Version, LocationInput? Pickup = null, LocationInput? Destination = null);
public static class RideLocationEndpoints
{
    public static IQueryable<Ride> AssignedRide(TaxiDb db, Guid id, Guid driverId) => db.Set<Ride>().Where(r => r.Id == id && r.DriverId == driverId);
    public static string AuditDetail(Ride ride, RideRequest request, object previous, Guid actorId, DateTimeOffset changedAt, string source) => JsonSerializer.Serialize(new { rideId = ride.Id, previous, next = new { pickup = request.Pickup, latitude = request.Latitude, longitude = request.Longitude, destination = request.Destination, destinationLatitude = request.DestinationLatitude, destinationLongitude = request.DestinationLongitude, locationSource = request.LocationSource }, changedBy = actorId, changedAt, source });
    public static bool CanEdit(RideStatus status) => status is RideStatus.Pending or RideStatus.Assigned or RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress;
    public static bool CanEditPickup(RideStatus status) => CanEdit(status) && status != RideStatus.InProgress;
    public static object Apply(Ride ride, RideRequest request, RideLocationUpdate input)
    {
        if (ride.Version != input.Version || !CanEdit(ride.Status)) throw new ReceptionConflictException("تغيّرت حالة الرحلة؛ حدّث البيانات قبل التعديل");
        if (input.Pickup is null && input.Destination is null) throw new ArgumentException("اختر الحقل المراد تعديله");
        if (input.Pickup is not null && (!CanEditPickup(ride.Status) || ride.MeterStartedAt.HasValue)) throw new ReceptionConflictException("لا يمكن تغيير نقطة الانطلاق بعد بدء الرحلة");
        foreach (var location in new[] { input.Pickup, input.Destination }.OfType<LocationInput>())
        {
            Locations.Validate(location);
            if (string.IsNullOrWhiteSpace(location.AddressText)) throw new ArgumentException("اكتب وصف المكان");
            if (location.Notes is not null) throw new ArgumentException("تعديل الموقع لا يغيّر ملاحظات الرحلة");
        }
        var previous = new { pickup = request.Pickup, latitude = request.Latitude, longitude = request.Longitude, destination = request.Destination, destinationLatitude = request.DestinationLatitude, destinationLongitude = request.DestinationLongitude, locationSource = request.LocationSource };
        if (input.Pickup is not null) { Locations.Apply(request, input.Pickup); request.SavedAddressId = null; }
        if (input.Destination is not null) { request.Destination = input.Destination.AddressText.Trim(); request.DestinationLatitude = input.Destination.Latitude; request.DestinationLongitude = input.Destination.Longitude; }
        return previous;
    }
    public static void MapRideLocations(this WebApplication app)
    {
        app.MapPut("/api/v1/rides/{id:guid}/locations", async (Guid id, RideLocationUpdate input, TaxiDb db, TenantContext tenant, ReceptionService reception, HttpContext http) => {
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var office = http.User.HasClaim("permission", "rides.write");
            var driver = office ? null : await DriverEndpoints.CurrentDriver(db, tenant);
            if (!office && driver is null) return Results.Forbid();
            var query = office ? db.Set<Ride>().Where(r => r.Id == id) : AssignedRide(db, id, driver!.Id);
            var ride = await query.SingleOrDefaultAsync();
            if (ride is null) return Results.NotFound();
            var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == ride.RideRequestId);
            var previous = Apply(ride, request, input);
            // Bump the existing ride's concurrency version without changing assignment, workflow, meter or fare.
            db.Entry(ride).Property(r => r.Version).IsModified = true;
            var changedAt = DateTimeOffset.UtcNow;
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "ride.locations-updated", CreatedAt = changedAt, Detail = AuditDetail(ride, request, previous, tenant.ActorId, changedAt, office ? "OFFICE" : "DRIVER") });
            var order = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(o => o.RideRequestId == request.Id);
            if (order is not null)
            {
                var data = JsonNode.Parse(order.Payload)!.AsObject();
                static JsonObject Point(string name, double? latitude, double? longitude) => new() { ["name"] = name, ["coords"] = latitude.HasValue && longitude.HasValue ? new JsonObject { ["x"] = latitude.Value, ["y"] = longitude.Value } : null };
                data["pickup"] = Point(request.Pickup, request.Latitude, request.Longitude); data["dropoff"] = Point(request.Destination, request.DestinationLatitude, request.DestinationLongitude);
                data["destination"] = request.Destination; data["addressText"] = request.AddressText; data["latitude"] = request.Latitude; data["longitude"] = request.Longitude; data["locationSource"] = request.LocationSource; data["savedAddressId"] = request.SavedAddressId; data["neighborhood"] = request.Neighborhood; data["street"] = request.Street;
                data["rideVersion"] = ride.Version + 1; data["receptionVersion"] = ++order.Version; data["updatedAt"] = changedAt; order.Payload = data.ToJsonString(); order.LastWriteHash = "";
            }
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { ride.Id, ride.Version });
        }).RequireAuthorization(p => p.RequireAssertion(c => c.User.HasClaim("permission", "rides.write") || c.User.HasClaim("permission", "rides.drive")));
    }
}
