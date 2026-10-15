namespace DispatchPro.Api.Domain;

// Reserved future work is separate from both active rides and the driver stand queue.
public sealed class DriverJob : TenantEntity
{
    public Guid DriverId { get; set; }
    public Guid RideId { get; set; }
    public int Position { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
