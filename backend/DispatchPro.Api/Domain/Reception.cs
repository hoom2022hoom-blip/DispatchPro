namespace DispatchPro.Api.Domain;

// Compatibility storage preserves reception-only fields and caller numbers (including landlines).
// These are office reception records, not mobile-app customer registrations.
public sealed class ReceptionOrder : TenantEntity
{
    public Guid? RideRequestId { get; set; }
    public string ExternalId { get; set; } = "";
    public string? EventId { get; set; }
    public string Day { get; set; } = "";
    public int Number { get; set; }
    public string Payload { get; set; } = "{}";
    public long Version { get; set; }
    public string LastWriteHash { get; set; } = "";
}
public sealed class ReceptionCall : TenantEntity
{
    public string EventId { get; set; } = "";
    public string Fingerprint { get; set; } = "";
    public string Payload { get; set; } = "{}";
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;
}
public sealed class ReceptionCounter : TenantEntity { public string Day { get; set; } = ""; public int Value { get; set; } }
public sealed class ReceptionShift : TenantEntity
{
    public Guid DriverId { get; set; }
    public Guid VehicleId { get; set; }
    public bool Active { get; set; } = true;
    public DateTimeOffset StartTime { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? EndTime { get; set; }
}
public sealed class ReceptionQueue : TenantEntity { public Guid? ShiftId { get; set; } public Guid DriverId { get; set; } public Guid? QueueLocationId { get; set; } public int Position { get; set; } public string Status { get; set; } = "WAITING"; public DateTimeOffset JoinedAt { get; set; } = DateTimeOffset.UtcNow; }
