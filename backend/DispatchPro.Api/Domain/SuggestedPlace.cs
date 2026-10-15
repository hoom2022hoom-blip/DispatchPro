namespace DispatchPro.Api.Domain;

public sealed class SuggestedPlace : TenantEntity
{
    public string Name { get; set; } = "";
    public string AddressText { get; set; } = "";
    public string Area { get; set; } = "";
    public string Category { get; set; } = "";
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsDeleted { get; set; }
    public long Version { get; set; } = 1;
}
