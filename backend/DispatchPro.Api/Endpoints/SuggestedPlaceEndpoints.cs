using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace DispatchPro.Api.Endpoints;
public sealed record SuggestedPlaceInput(string Name, string? AddressText, double? Latitude, double? Longitude, int SortOrder, bool IsActive, long Version = 0, string? Area = null, string? Category = null);
public static class SuggestedPlaceEndpoints
{
    public static void Validate(SuggestedPlaceInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || input.AddressText?.Length > 500 || input.SortOrder is < 0 or > 100000 || !input.Latitude.HasValue || !input.Longitude.HasValue) throw new ArgumentException("حدد اسم الموقع ونقطة صحيحة على الخريطة");
        if (!ArabicPlaceText.Valid(input.Name, true) || !ArabicPlaceText.Valid(input.AddressText) || !ArabicPlaceText.Valid(input.Area) || !ArabicPlaceText.Valid(input.Category) || input.Area?.Length > 150 || input.Category?.Length > 100) throw new ArgumentException("استخدم اسمًا وعنوانًا ومنطقة وتصنيفًا بالعربية فقط");
        Locations.Validate(new(input.Name, Latitude: input.Latitude, Longitude: input.Longitude, LocationSource: "MAP_PIN"));
    }
    public static IQueryable<SuggestedPlace> Active(TaxiDb db) => db.Set<SuggestedPlace>().AsNoTracking().Where(p => p.IsActive && !p.IsDeleted).OrderBy(p => p.SortOrder).ThenBy(p => p.Name).ThenBy(p => p.Id).Take(200);
    public static void MapSuggestedPlaces(this WebApplication app)
    {
        // Match the office workspace: readers can list, office writers can manage.
        var office = app.MapGroup("/api/v1/office/suggested-places").RequireAuthorization("rides.read");
        office.MapGet("", async (TaxiDb db) => Results.Ok(await db.Set<SuggestedPlace>().AsNoTracking().Where(p => !p.IsDeleted).OrderBy(p => p.SortOrder).ThenBy(p => p.Name).Take(200).ToListAsync()));
        office.MapPost("", async (SuggestedPlaceInput input, TaxiDb db, TenantContext tenant, ReceptionService reception) => await Save(null, input, db, tenant, reception)).RequireAuthorization("rides.write");
        office.MapPut("/{id:guid}", async (Guid id, SuggestedPlaceInput input, TaxiDb db, TenantContext tenant, ReceptionService reception) => await Save(id, input, db, tenant, reception)).RequireAuthorization("rides.write");
        office.MapDelete("/{id:guid}", async (Guid id, long version, TaxiDb db, TenantContext tenant, ReceptionService reception) => {
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var place = await db.Set<SuggestedPlace>().SingleOrDefaultAsync(p => p.Id == id && !p.IsDeleted);
            if (place is null) return Results.NotFound();
            if (place.Version != version) return Results.Conflict();
            place.IsDeleted = true; place.IsActive = false; place.Version++;
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = id, Action = "suggested-place.deleted" });
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { id });
        }).RequireAuthorization("rides.write");
        app.MapGet("/api/v1/driver/places", async (TaxiDb db, TenantContext tenant) => await DriverEndpoints.CurrentDriver(db, tenant) is null ? Results.Forbid() : Results.Ok(await Active(db).ToListAsync())).RequireAuthorization("rides.drive");
    }
    private static async Task<IResult> Save(Guid? id, SuggestedPlaceInput input, TaxiDb db, TenantContext tenant, ReceptionService reception)
    {
        Validate(input);
        await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
        var place = id.HasValue ? await db.Set<SuggestedPlace>().SingleOrDefaultAsync(p => p.Id == id && !p.IsDeleted) : new SuggestedPlace();
        if (place is null) return Results.NotFound();
        if (id.HasValue && input.Version != place.Version) return Results.Conflict();
        if (!id.HasValue && await db.Set<SuggestedPlace>().CountAsync(p => !p.IsDeleted) >= 200) return Results.Conflict(new { detail = "الحد الأقصى 200 موقع؛ عدّل المواقع الموجودة" });
        if (await db.Set<SuggestedPlace>().AnyAsync(p => !p.IsDeleted && p.Id != (id ?? Guid.Empty) && p.Name == input.Name.Trim() && p.Latitude == input.Latitude && p.Longitude == input.Longitude)) return Results.Conflict(new { detail = "الموقع موجود بالفعل" });
        var previous = id.HasValue ? JsonSerializer.Serialize(place) : null;
        place.Name = input.Name.Trim(); place.AddressText = input.AddressText?.Trim() ?? ""; place.Area = input.Area?.Trim() ?? ""; place.Category = input.Category?.Trim() ?? ""; place.Latitude = input.Latitude!.Value; place.Longitude = input.Longitude!.Value; place.SortOrder = input.SortOrder; place.IsActive = input.IsActive;
        if (id.HasValue) place.Version++; else db.Add(place);
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = place.Id, Action = "suggested-place." + (id.HasValue ? "updated" : "created"), Detail = JsonSerializer.Serialize(new { previous, next = place }) });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(place);
    }
}
