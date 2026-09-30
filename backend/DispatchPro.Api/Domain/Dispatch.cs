using NetTopologySuite.Geometries;
using System.Text.Json.Serialization;

namespace DispatchPro.Api.Domain;

public sealed class DispatchPolicy : TenantEntity
{
    public string Mode { get; set; } = "MANUAL";
    public int LocationMaxAgeSeconds { get; set; } = 120;
    public int OfferTimeoutSeconds { get; set; } = 30;
    public bool ShowDriverPhone { get; set; }
}
public sealed class DriverLocation : TenantEntity
{
    public Guid DriverId { get; set; }
    [JsonIgnore] public Point Position { get; set; } = null!;
    public double Accuracy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
public sealed class RideOffer : TenantEntity
{
    public Guid RideId { get; set; }
    public Guid DriverId { get; set; }
    public DateTimeOffset OfferedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public string Outcome { get; set; } = "OFFERED";
    public double DistanceMeters { get; set; }
}
