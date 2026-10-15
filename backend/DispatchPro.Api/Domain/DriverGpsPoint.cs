namespace DispatchPro.Api.Domain;

// Sampled, accepted device observations; never inferred positions.
public sealed class DriverGpsPoint : TenantEntity
{
    public bool LocationAccepted { get; set; } = true;
    public string Source { get; set; } = "driver";
    public Guid DriverId { get; set; }
    public Guid? RideId { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public double Accuracy { get; set; }
    public DateTimeOffset Timestamp { get; set; }
}
