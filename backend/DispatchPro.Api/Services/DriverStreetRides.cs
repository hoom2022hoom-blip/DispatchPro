using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed record DriverStreetRideInput(Guid Id, LocationInput Destination, LocationInput? Pickup = null, string? Notes = null, string FareMode = "DRIVER_MANUAL", Guid? DestinationPlaceId = null, Guid? DriverId = null, Guid? TenantId = null, Guid? OfficeId = null, Guid? PickupPlaceId = null);

public sealed partial class ReceptionService
{
    public static void ValidateStreetRide(DriverStreetRideInput input)
    {
        if (input.Id == Guid.Empty || input.DriverId.HasValue || input.TenantId.HasValue || input.OfficeId.HasValue)
            throw new ArgumentException("السائق والمكتب يحددهما تسجيل الدخول فقط");
        Locations.RequiredDestination(input.Destination?.AddressText);
        if (input.Destination is null || input.Notes?.Length > 4000 || input.FareMode is not ("DRIVER_MANUAL" or "GPS_METER"))
            throw new ArgumentException("بيانات الرحلة غير صالحة");
        Locations.Validate(input.Destination);
        if (input.Pickup is not null)
        {
            Locations.Validate(input.Pickup);
            if (input.Pickup.LocationSource != "MAP_PIN" || !input.Pickup.Latitude.HasValue || string.IsNullOrWhiteSpace(input.Pickup.AddressText))
                throw new ArgumentException("يرجى تحديد موقع الانطلاق");
        }
    }

    public async Task<IResult> CreateStreetRide(DriverStreetRideInput input)
    {
        ValidateStreetRide(input);
        await using var tx = await db.Database.BeginTransactionAsync(); await Lock();
        var driver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.UserId == tenant.ActorId && d.Active && d.Status != DriverStatus.Suspended);
        if (driver is null) return Results.Forbid();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(input))));
        var existing = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == input.Id);
        if (existing is not null)
        {
            var original = await db.Set<AuditLog>().SingleOrDefaultAsync(a => a.EntityId == existing.Id && a.Action == "driver.street-created" && a.ActorId == tenant.ActorId && a.Detail == hash);
            if (existing.DriverId != driver.Id || original is null) return Results.Conflict();
            await tx.CommitAsync(); return Results.Ok(new { existing.Id, existing.Status, existing.Version });
        }
        if (await IsBusy(driver.Id) || await db.Set<Ride>().AnyAsync(r => r.DriverId == driver.Id && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving)))
            return Results.Conflict(new { error = "أكمل الطلب الحالي قبل تسجيل رحلة مباشرة" });
        var pickup = input.Pickup;
        if (input.PickupPlaceId.HasValue)
        {
            var place = await db.Set<SuggestedPlace>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == input.PickupPlaceId && p.IsActive && !p.IsDeleted);
            if (place is null) return Results.NotFound();
            pickup = new(place.Name + (place.AddressText == "" ? "" : " · " + place.AddressText), Latitude: place.Latitude, Longitude: place.Longitude, LocationSource: "MAP_PIN");
            Locations.Validate(pickup);
        }
        if (pickup is null)
        {
            var location = await db.Set<DriverLocation>().AsNoTracking().SingleOrDefaultAsync(l => l.DriverId == driver.Id);
            if (location is null || location.UpdatedAt < DateTimeOffset.UtcNow.AddSeconds(-120) || location.Accuracy > 200)
                return Results.Conflict(new { error = "يرجى تحديد موقع الانطلاق" });
            pickup = new("موقع الانطلاق GPS", Latitude: location.Position.Y, Longitude: location.Position.X, LocationSource: "MAP_PIN");
            Locations.Validate(pickup);
        }
        var destination = input.Destination;
        if (input.DestinationPlaceId.HasValue)
        {
            var place = await db.Set<SuggestedPlace>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == input.DestinationPlaceId && p.IsActive && !p.IsDeleted);
            if (place is null) return Results.NotFound();
            destination = new(place.Name + (place.AddressText == "" ? "" : " · " + place.AddressText), Latitude: place.Latitude, Longitude: place.Longitude, LocationSource: "MAP_PIN");
        }
        var request = new RideRequest { Source = "DRIVER_STREET", Destination = destination.AddressText.Trim(), DestinationLatitude = destination.Latitude, DestinationLongitude = destination.Longitude, Notes = input.Notes?.Trim() ?? "" };
        Locations.Apply(request, pickup);
        // The passenger is already on board. Arrived -> InProgress uses the existing legal start transition.
        var ride = new Ride { Id = input.Id, RideRequestId = request.Id, DriverId = driver.Id, Status = RideStatus.Arrived, DispatchMode = "MANUAL", FareMode = input.FareMode };
        db.AddRange(request, ride);
        await ProjectRequest(request, ride);
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "driver.street-created", Detail = hash });
        await db.SaveChangesAsync();
        await RideFare.Start(db, ride);
        ride.Status = RideStatus.InProgress; driver.Status = DriverStatus.Busy;
        await SyncRide(ride); await db.SaveChangesAsync();
        await tx.CommitAsync(); return Results.Ok(new { ride.Id, ride.Status, ride.Version });
    }
}
