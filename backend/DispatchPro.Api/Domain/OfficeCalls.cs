namespace DispatchPro.Api.Domain;

public sealed class OfficeCallDevice : TenantEntity
{
    public string TokenHash { get; set; } = "";
    public string PublicKey { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "ANDROID";
    public bool Approved { get; set; }
    public bool Revoked { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeen { get; set; }
}
public sealed class OfficeCallPairing : TenantEntity
{
    public string SecretHash { get; set; } = "";
    public string Kind { get; set; } = "ANDROID";
    public DateTimeOffset ExpiresAt { get; set; }
    public Guid? DeviceId { get; set; }
}
public sealed class OfficeCallEvent : TenantEntity
{
    public Guid DeviceId { get; set; }
    public string EventId { get; set; } = "";
    public string Phone { get; set; } = "";
    public string SourcePackage { get; set; } = "";
    public DateTimeOffset Timestamp { get; set; }
    public DateTimeOffset AcceptedAt { get; set; } = DateTimeOffset.UtcNow;
    public string DispatchStatus { get; set; } = "PENDING";
    public string GridStatus { get; set; } = "PENDING";
    public string DispatchError { get; set; } = "";
    public string GridError { get; set; } = "";
    public bool GridVisibleConfirmed { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset NextAttempt { get; set; } = DateTimeOffset.UtcNow;
}
