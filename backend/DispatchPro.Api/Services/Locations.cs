using DispatchPro.Api.Domain;
namespace DispatchPro.Api.Services;
public sealed record LocationInput(string AddressText, string? Neighborhood = null, string? Street = null, double? Latitude = null, double? Longitude = null, string LocationSource = "MANUAL_TEXT", string? Notes = null);
public static class Locations
{
    public static readonly string[] Sources = ["CUSTOMER_GPS", "WHATSAPP_LOCATION", "MAP_PIN", "ADDRESS_SEARCH", "MANUAL_TEXT", "SAVED_ADDRESS"];
    public static void Validate(LocationInput input, bool allowEmpty = false)
    {
        if (!Sources.Contains(input.LocationSource) || input.AddressText is null || input.AddressText.Length > 500 || input.Neighborhood?.Length > 150 || input.Street?.Length > 150 || input.Notes?.Length > 4000) throw new ArgumentException("Invalid location fields");
        if (input.Latitude.HasValue != input.Longitude.HasValue || input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180 || (input.Latitude.HasValue && (!double.IsFinite(input.Latitude.Value) || !double.IsFinite(input.Longitude!.Value)))) throw new ArgumentException("Invalid coordinate pair");
        if (!allowEmpty && string.IsNullOrWhiteSpace(input.AddressText) && !input.Latitude.HasValue) throw new ArgumentException("An address or a map point is required; GPS is optional");
    }
    public static void Apply(RideRequest request, LocationInput input)
    {
        request.AddressText = input.AddressText.Trim(); request.Pickup = request.AddressText;
        request.Neighborhood = input.Neighborhood?.Trim() ?? ""; request.Street = input.Street?.Trim() ?? "";
        request.Latitude = input.Latitude; request.Longitude = input.Longitude; request.LocationSource = input.LocationSource;
        if (input.Notes is not null) request.Notes = input.Notes;
    }
    public static LocationInput From(SavedAddress address) => new(address.AddressText, address.Neighborhood, address.Street, address.Latitude, address.Longitude, "SAVED_ADDRESS", address.Notes);
    public static string OrderSource(string source) => source == "LANDLINE_ICALL" ? "LANDLINE" : source;
}
