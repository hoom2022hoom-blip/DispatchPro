using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
namespace DispatchPro.Api.Endpoints;
public sealed record SavedAddressInput(Guid CustomerId, string Label, string AddressText, string? Neighborhood, string? Street, double? Latitude, double? Longitude, string? Notes, bool IsDefault, string Icon = "OTHER", long Version = 0);
public static class SavedAddressEndpoints
{
    public static void MapSavedAddresses(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/saved-addresses").RequireAuthorization();
        api.MapGet("", async (Guid? customerId, string? search, TaxiDb db) => {
            search = search?.Trim();
            var phoneSearch = CustomerPhone.SearchKey(search ?? "");
            var query = from address in db.Set<SavedAddress>().AsNoTracking() join customer in db.Set<Customer>() on address.CustomerId equals customer.Id
                        where (!customerId.HasValue || address.CustomerId == customerId) && (search == null || customer.FullName.Contains(search) || (phoneSearch != "" && customer.Phone.Contains(phoneSearch)) || address.AddressText.Contains(search) || address.Neighborhood.Contains(search) || address.Street.Contains(search))
                        orderby address.CreatedAt
                        select new { address, customerName = customer.FullName, phone = customer.Phone };
            return Results.Ok(await query.ToListAsync());
        }).RequireAuthorization("customers.read");
        api.MapGet("/{id:guid}", async (Guid id, TaxiDb db) => await db.Set<SavedAddress>().SingleOrDefaultAsync(a => a.Id == id) is {} row ? Results.Ok(row) : Results.NotFound()).RequireAuthorization("customers.read");
        api.MapPost("", async (SavedAddressInput input, TaxiDb db, TenantContext tenant, ReceptionService reception) => await Save(null, input, db, tenant, reception)).RequireAuthorization("customers.write");
        api.MapPut("/{id:guid}", async (Guid id, SavedAddressInput input, TaxiDb db, TenantContext tenant, ReceptionService reception) => await Save(id, input, db, tenant, reception)).RequireAuthorization("customers.write");
        api.MapDelete("/{id:guid}", async (Guid id, long version, TaxiDb db, TenantContext tenant, ReceptionService reception) => {
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var row = await db.Set<SavedAddress>().SingleOrDefaultAsync(a => a.Id == id); if (row is null) return Results.NotFound();
            if (row.Version != version) return Results.Conflict();
            foreach (var request in await db.Set<RideRequest>().Where(r => r.SavedAddressId == id).ToListAsync()) {
                request.SavedAddressId = null;
                var receptionRow = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(o => o.RideRequestId == request.Id);
                if (receptionRow is not null) { var payload = JsonNode.Parse(receptionRow.Payload)!.AsObject(); payload["savedAddressId"] = null; payload["receptionVersion"] = ++receptionRow.Version; receptionRow.Payload = payload.ToJsonString(); receptionRow.LastWriteHash = ""; }
            }
            await db.SaveChangesAsync(); db.Remove(row);
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = id, Action = "saved-address.deleted" });
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.NoContent();
        }).RequireAuthorization("customers.write");
    }
    private static async Task<IResult> Save(Guid? id, SavedAddressInput input, TaxiDb db, TenantContext tenant, ReceptionService reception)
    {
        Locations.Validate(new(input.AddressText, input.Neighborhood, input.Street, input.Latitude, input.Longitude, "SAVED_ADDRESS", input.Notes));
        if (string.IsNullOrWhiteSpace(input.Label) || input.Label.Length > 100 || input.Icon is not ("HOME" or "WORK" or "OTHER")) return Results.BadRequest();
        await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
        var row = id.HasValue ? await db.Set<SavedAddress>().SingleOrDefaultAsync(a => a.Id == id) : new SavedAddress();
        if (row is null || !await db.Set<Customer>().AnyAsync(c => c.Id == input.CustomerId)) return Results.NotFound();
        if (id.HasValue && (row.Version != input.Version || row.CustomerId != input.CustomerId)) return Results.Conflict();
        if (input.IsDefault) { foreach (var other in await db.Set<SavedAddress>().Where(a => a.CustomerId == input.CustomerId && a.IsDefault && a.Id != row.Id).ToListAsync()) { other.IsDefault = false; other.Version++; other.UpdatedAt = DateTimeOffset.UtcNow; } await db.SaveChangesAsync(); }
        row.CustomerId = input.CustomerId; row.Label = input.Label.Trim(); row.Icon = input.Icon; row.AddressText = input.AddressText.Trim(); row.Neighborhood = input.Neighborhood?.Trim() ?? ""; row.Street = input.Street?.Trim() ?? "";
        row.Latitude = input.Latitude; row.Longitude = input.Longitude; row.Notes = input.Notes ?? ""; row.IsDefault = input.IsDefault; row.UpdatedAt = DateTimeOffset.UtcNow;
        if (id.HasValue) row.Version++; else db.Add(row);
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = row.Id, Action = id.HasValue ? "saved-address.updated" : "saved-address.created" });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(row);
    }
}
