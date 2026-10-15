using NetTopologySuite.Geometries;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;
using NetTopologySuite.IO;

namespace DispatchPro.Api.Domain;

public abstract class TenantEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
}
public sealed class Tenant { public Guid Id { get; set; } = Guid.NewGuid(); public string Name { get; set; } = ""; public string Slug { get; set; } = ""; }
public sealed class Office : TenantEntity { public string OfficeWhatsAppNumber { get; set; } = ""; public string Name { get; set; } = ""; public string TimeZone { get; set; } = "Asia/Jerusalem"; }
public sealed class User : TenantEntity { public string Username { get; set; } = ""; public string PasswordHash { get; set; } = ""; public Guid RoleId { get; set; } public bool Active { get; set; } = true; }
public sealed class Role : TenantEntity { public string Name { get; set; } = ""; }
public sealed class Permission : TenantEntity { public Guid RoleId { get; set; } public string Code { get; set; } = ""; }
public sealed class Customer : TenantEntity { public string FullName { get; set; } = ""; public string Phone { get; set; } = ""; public string SecondaryPhone { get; set; } = ""; public string Notes { get; set; } = ""; public bool IsActive { get; set; } = true; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; }
public enum DriverStatus { Offline, Available, Busy, Suspended }
public sealed class Driver : TenantEntity
{
    public Guid UserId { get; set; }
    public string FullName { get; set; } = "";
    public DriverStatus Status { get; set; }
    public string Phone { get; set; } = "";
    [NotMapped] public string PhoneLocal { get => Phone; set => Phone = value; }
    public string WhatsappPhone { get; set; } = "";
    public string WhatsappCountryCode { get; set; } = "+970";
    public bool HasWhatsApp { get; set; }
    public bool WhatsappEnabled { get; set; }
    public bool Active { get; set; } = true;
    [NotMapped] public bool IsActive { get => Active; set => Active = value; }
    public string NationalId { get; set; } = "";
    public string Address { get; set; } = "";
    public DateOnly? DateOfBirth { get; set; }
    public string LicenseNumber { get; set; } = "";
    public string LicenseType { get; set; } = "";
    public DateOnly? LicenseIssueDate { get; set; }
    public DateOnly? LicenseExpiryDate { get; set; }
    public DateOnly? HireDate { get; set; }
    public string Notes { get; set; } = "";
    public Guid? CurrentVehicleId { get; set; }
    public bool DriverAppEnabled { get; set; } = true;
    public bool GpsEnabled { get; set; } = true;
    public bool VoiceEnabled { get; set; } = true;
    public bool CanListen { get; set; } = true;
    public bool CanTalkPublic { get; set; } = true;
    public bool CanTalkPrivate { get; set; } = true;
    public bool IsVoiceBlocked { get; set; }
}
public sealed class DriverVehicleAssignment : TenantEntity
{
    public Guid DriverId { get; set; }
    public Guid VehicleId { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndedAt { get; set; }
    public Guid? ChangedBy { get; set; }
    public string Notes { get; set; } = "";
}
public sealed class QueueLocation : TenantEntity
{
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}
public sealed class Vehicle : TenantEntity { public Guid DriverId { get; set; } public Guid VehicleClassId { get; set; } public string Plate { get; set; } = ""; public string Make { get; set; } = ""; public string Model { get; set; } = ""; public string Color { get; set; } = ""; public int? Year { get; set; } public DateOnly? RegistrationExpiryDate { get; set; } public DateOnly? InsuranceExpiryDate { get; set; } public bool Active { get; set; } = true; public string Status { get; set; } = "ACTIVE"; }
public sealed class VehicleClass : TenantEntity { public string Name { get; set; } = ""; public decimal Multiplier { get; set; } = 1; }
// Append states: existing persisted integer values must never be renumbered.
public enum RideStatus { Pending, Assigned, Accepted, Arrived, InProgress, Completed, Cancelled, DriverArriving, Rejected, NoDriverAvailable }
public sealed class RideRequest : TenantEntity
{
    public Guid? CustomerId { get; set; }
    public string PassengerName { get; set; } = "";
    public string PassengerPhone { get; set; } = "";
    public Guid? SavedAddressId { get; set; }
    public string AddressText { get; set; } = "";
    public string AddressType { get; set; } = "FIXED";
    public string Neighborhood { get; set; } = "";
    public string Street { get; set; } = "";
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string LocationSource { get; set; } = "MANUAL_TEXT";
    public string Pickup { get; set; } = "";
    public string Destination { get; set; } = "";
    public double? DestinationLatitude { get; set; }
    public double? DestinationLongitude { get; set; }
    public string Notes { get; set; } = "";
    public string Source { get; set; } = "MANUAL";
    public DateTimeOffset? ScheduledAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed class Ride : TenantEntity { public Guid RideRequestId { get; set; } public Guid? DriverId { get; set; } public RideStatus Status { get; set; } public long Version { get; set; } public string DispatchMode { get; set; } = "MANUAL"; public DateTimeOffset? OfferExpiresAt { get; set; }
    public string FareMode { get; set; } = "OFFICE_MANUAL";
    public string? FareSource { get; set; }
    public string Currency { get; set; } = "ILS";
    public decimal? FinalFare { get; set; }
    public decimal? MeterCalculatedFare { get; set; }
    public decimal? DistanceKm { get; set; }
    public int? DurationSeconds { get; set; }
    public int? WaitingSeconds { get; set; }
    public DateTimeOffset? FareCalculatedAt { get; set; }
    public DateTimeOffset? FareUpdatedAt { get; set; }
    public Guid? FareUpdatedBy { get; set; }
    public DateTimeOffset? MeterStartedAt { get; set; }
    public DateTimeOffset? MeterStoppedAt { get; set; }
    [JsonIgnore] public string? MeterTariff { get; set; }
    [JsonIgnore] public DateTimeOffset? MeterLastAt { get; set; }
    [JsonIgnore] public double? MeterLastLatitude { get; set; }
    [JsonIgnore] public double? MeterLastLongitude { get; set; }
    [JsonIgnore] public double? MeterLastAccuracy { get; set; }
}
public sealed class FeatureFlag : TenantEntity { public string Key { get; set; } = ""; public bool Enabled { get; set; } }
public sealed class AuditLog : TenantEntity { public Guid ActorId { get; set; } public string Action { get; set; } = ""; public Guid EntityId { get; set; } public string Detail { get; set; } = ""; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; }
public enum PricingMode { Manual, FixedRoute, GpsMeter, Hybrid }
public sealed class PricingProfile : TenantEntity { public string Name { get; set; } = ""; public string Currency { get; set; } = "ILS"; public bool ShowEstimate { get; set; } = true; public string TimeZone { get; set; } = "Asia/Jerusalem"; }
public sealed class PricingRule : TenantEntity
{
    public Guid PricingProfileId { get; set; }
    public PricingMode Mode { get; set; }
    public decimal BaseFare { get; set; }
    public decimal PerKm { get; set; }
    public decimal IncludedDistanceKm { get; set; }
    public decimal ExtraFee { get; set; }
    public decimal PerMinute { get; set; }
    public decimal MinimumFare { get; set; }
    public decimal WaitingPerMinute { get; set; }
    public int NightStartHour { get; set; } = 22;
    public int NightEndHour { get; set; } = 6;
    public decimal NightPercent { get; set; }
    public decimal NightFixed { get; set; }
}
public sealed class FixedRoutePrice : TenantEntity { public Guid PricingRuleId { get; set; } public string Origin { get; set; } = ""; public string Destination { get; set; } = ""; public decimal Outbound { get; set; } public decimal Return { get; set; } }
public sealed class ZonePrice : TenantEntity
{
    public Guid PricingRuleId { get; set; }
    public string Name { get; set; } = "";
    public decimal AdditionalFare { get; set; }
    [JsonIgnore] public Geometry? Boundary { get; set; }
    [NotMapped] public string? BoundaryWkt
    {
        get => Boundary?.AsText();
        set
        {
            if (string.IsNullOrWhiteSpace(value)) { Boundary = null; return; }
            if (value.Length > 100000) throw new ArgumentException("Zone boundary too large");
            try { Boundary = new WKTReader().Read(value); Boundary.SRID = 4326; }
            catch (ParseException) { throw new ArgumentException("Invalid WKT boundary"); }
        }
    }
}
public sealed class ServiceSurcharge : TenantEntity { public string Name { get; set; } = ""; public decimal Amount { get; set; } }
public sealed class RidePrice : TenantEntity
{
    public Guid RideId { get; set; }
    public Guid PricingRuleId { get; set; }
    public PricingMode PricingMode { get; set; }
    public string Currency { get; set; } = "ILS";
    public decimal? EstimatedPrice { get; set; }
    public decimal? CalculatedPrice { get; set; }
    public decimal ManualAdjustment { get; set; }
    public decimal? FinalPrice { get; set; }
    public string? AdjustmentReason { get; set; }
    public Guid? AdjustedBy { get; set; }
    public long Version { get; set; }
}
public sealed class PriceAdjustment : TenantEntity { public Guid RidePriceId { get; set; } public decimal? PreviousPrice { get; set; } public decimal FinalPrice { get; set; } public string Reason { get; set; } = ""; public Guid AdjustedBy { get; set; } public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; }
