namespace DispatchPro.Api.Domain;
public sealed class SavedAddress : TenantEntity
{
    public Guid CustomerId { get; set; }
    public string Label { get; set; } = "HOME";
    public string Icon { get; set; } = "HOME";
    public string AddressText { get; set; } = "";
    public string Neighborhood { get; set; } = "";
    public string Street { get; set; } = "";
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string Notes { get; set; } = "";
    public bool IsDefault { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public long Version { get; set; } = 1;
}
