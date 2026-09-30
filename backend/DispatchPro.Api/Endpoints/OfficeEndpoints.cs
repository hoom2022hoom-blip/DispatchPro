using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;

namespace DispatchPro.Api.Endpoints;
public sealed record OfficeDriverInput(string FullName, string? Phone = null, bool? Active = null, DriverStatus Status = DriverStatus.Offline, string? NationalId = null, string? Address = null, DateOnly? DateOfBirth = null, string? LicenseNumber = null, string? LicenseType = null, DateOnly? LicenseIssueDate = null, DateOnly? LicenseExpiryDate = null, DateOnly? HireDate = null, string? Notes = null, Guid? CurrentVehicleId = null, bool UpdateVehicle = false, bool? IsActive = null, string? AssignmentNotes = null, string? PhoneLocal = null, string? WhatsappPhone = null, string? WhatsappCountryCode = null, bool? HasWhatsApp = null, bool? WhatsappEnabled = null);
public sealed record OfficeVehicleInput(string Plate, Guid DriverId, Guid VehicleClassId, string Make, string Model, string Color, int? Year, bool Active, string Status);
public sealed record OfficeMessagingInput(string OfficeWhatsAppNumber);
public sealed record OfficeQueueInput(Guid VehicleId);
public sealed record QueueLocationInput(string Name, bool IsActive, int SortOrder);
public static class OfficeEndpoints
{
    public static void MapOfficeEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/office").RequireAuthorization("rides.read");
        api.MapGet("", async (TaxiDb db, ReceptionService reception) => new {
            today = ReceptionService.Day(DateTimeOffset.UtcNow),
            officeWhatsAppNumber = await db.Set<Office>().Select(o => o.OfficeWhatsAppNumber).FirstOrDefaultAsync() ?? "",
            drivers = await db.Set<Driver>().AsNoTracking().OrderBy(d => d.FullName).ToListAsync(),
            vehicles = await db.Set<Vehicle>().AsNoTracking().OrderBy(v => v.Plate).ToListAsync(),
            classes = await db.Set<VehicleClass>().AsNoTracking().OrderBy(v => v.Name).ToListAsync(),
            reception = await reception.Snapshot(),
            calls = (await reception.RecentCalls(8)).Select(c => JsonNode.Parse(c.Payload))
        });
        api.MapPut("/messaging-settings", async (OfficeMessagingInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => {
            var number = input.OfficeWhatsAppNumber?.Trim() ?? "";
            if (number != "" && !System.Text.RegularExpressions.Regex.IsMatch(number, @"^[+](970|972)[1-9][0-9]{7,8}$")) return Results.BadRequest(new { detail = "أدخل رقم المكتب الدولي +970 أو +972" });
            await using var tx = await db.Database.BeginTransactionAsync(); await service.Lock();
            var office = await db.Set<Office>().FirstOrDefaultAsync(); if (office is null) return Results.NotFound();
            office.OfficeWhatsAppNumber = number; db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = office.Id, Action = "office.messaging-settings-saved" });
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok();
        }).RequireAuthorization("rides.write");
        api.MapPost("/drivers", (OfficeDriverInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => SaveDriver(null, input, db, tenant, service)).RequireAuthorization("rides.write");
        api.MapPut("/drivers/{id:guid}", (Guid id, OfficeDriverInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => SaveDriver(id, input, db, tenant, service)).RequireAuthorization("rides.write");
        api.MapPost("/vehicles", (OfficeVehicleInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => SaveVehicle(null, input, db, tenant, service)).RequireAuthorization("rides.write");
        api.MapPut("/vehicles/{id:guid}", (Guid id, OfficeVehicleInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => SaveVehicle(id, input, db, tenant, service)).RequireAuthorization("rides.write");
        api.MapGet("/drivers/{id:guid}/assignments", async (Guid id, TaxiDb db) => {
            if (!await db.Set<Driver>().AnyAsync(d => d.Id == id)) return Results.NotFound();
            var rows = await (from a in db.Set<DriverVehicleAssignment>().AsNoTracking() join v in db.Set<Vehicle>() on a.VehicleId equals v.Id
                orderby a.StartedAt descending select new { a.Id, a.DriverId, a.VehicleId, a.StartedAt, a.EndedAt, a.ChangedBy, a.Notes, v.Plate, v.Make, v.Model }).Where(a => a.DriverId == id).ToListAsync();
            return Results.Ok(rows);
        });
        api.MapPost("/queue", async (DriverQueueInput input, DriverOperations service) => { await service.Queue(input); return Results.Ok(); }).RequireAuthorization("rides.write");
        api.MapPost("/queue-locations", (QueueLocationInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => SaveLocation(null, input, db, tenant, service)).RequireAuthorization("rides.write");
        api.MapPut("/queue-locations/{id:guid}", (Guid id, QueueLocationInput input, TaxiDb db, TenantContext tenant, ReceptionService service) => SaveLocation(id, input, db, tenant, service)).RequireAuthorization("rides.write");
        api.MapPost("/drivers/{id:guid}/queue", async (Guid id, OfficeQueueInput input, TaxiDb db, ReceptionService service) => {
            if (!await db.Set<Driver>().AnyAsync(d => d.Id == id && d.Active && d.Status != DriverStatus.Busy && d.Status != DriverStatus.Suspended) || !await db.Set<Vehicle>().AnyAsync(v => v.Id == input.VehicleId && v.DriverId == id && v.Active && v.Status == "ACTIVE")) return Results.BadRequest();
            var shift = await db.Set<ReceptionShift>().SingleOrDefaultAsync(s => s.DriverId == id && s.Active);
            if (shift is null) { await service.StartShift(id, input.VehicleId); shift = await db.Set<ReceptionShift>().SingleAsync(s => s.DriverId == id && s.Active); }
            if (shift.VehicleId != input.VehicleId) return Results.Conflict();
            await service.Queue(new("add", shift.Id)); return Results.Ok();
        }).RequireAuthorization("rides.write");
    }
    private static async Task<IResult> SaveDriver(Guid? id, OfficeDriverInput input, TaxiDb db, TenantContext tenant, ReceptionService service)
    {
        if (string.IsNullOrWhiteSpace(input.FullName) || input.FullName.Length > 150 || !Enum.IsDefined(input.Status)) return Results.BadRequest();
        if (input.NationalId?.Length > 80 || input.Notes?.Length > 8000 || input.LicenseNumber?.Length > 80 || input.LicenseType?.Length > 80 || input.AssignmentNotes?.Length > 2000 || input.DateOfBirth > DateOnly.FromDateTime(DateTime.UtcNow) || (input.LicenseIssueDate.HasValue && input.LicenseExpiryDate < input.LicenseIssueDate)) return Results.BadRequest();
        var active = input.Active ?? input.IsActive ?? true;
        var phone = DriverContact.Local(input.PhoneLocal ?? input.Phone);
        await using var tx = await db.Database.BeginTransactionAsync(); await service.Lock();
        var row = id.HasValue ? await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == id) : new Driver();
        if (row is null) return Results.NotFound();
        if (id.HasValue && (!active || input.Status != row.Status) && await db.Set<ReceptionShift>().AnyAsync(s => s.DriverId == id && s.Active)) return Results.Conflict(new { detail = "أنه وردية السائق قبل تعطيله أو تغيير حالته" });
        if (!id.HasValue) {
            var role = await db.Set<Role>().FirstOrDefaultAsync(r => r.Name == "Driver");
            if (role is null) return Results.Conflict(new { detail = "دور السائق غير مُعد للمكتب" });
            var user = new User { Username = "driver-" + Guid.NewGuid().ToString("N"), RoleId = role.Id, Active = false };
            row.UserId = user.Id; db.Add(user); db.Add(row);
        }
        var whatsappPhone = input.WhatsappPhone is null ? row.WhatsappPhone : input.WhatsappPhone.Trim();
        var countryCode = input.WhatsappCountryCode ?? row.WhatsappCountryCode;
        var hasWhatsApp = input.HasWhatsApp ?? row.HasWhatsApp;
        var enabled = input.WhatsappEnabled ?? row.WhatsappEnabled;
        if (countryCode is not ("+970" or "+972") || (enabled && !hasWhatsApp)) return Results.BadRequest();
        if (whatsappPhone != "") whatsappPhone = DriverContact.Local(whatsappPhone);
        if (hasWhatsApp && whatsappPhone == "") return Results.BadRequest(new { detail = "أدخل رقم WhatsApp المحلي" });
        row.WhatsappPhone = whatsappPhone; row.WhatsappCountryCode = countryCode; row.HasWhatsApp = hasWhatsApp; row.WhatsappEnabled = enabled;
        row.FullName = input.FullName.Trim(); row.Phone = phone; row.Active = active; row.Status = active ? input.Status : DriverStatus.Offline;
        row.NationalId = input.NationalId?.Trim() ?? row.NationalId; row.Address = input.Address ?? row.Address; row.Notes = input.Notes ?? row.Notes;
        row.LicenseNumber = input.LicenseNumber?.Trim() ?? row.LicenseNumber; row.LicenseType = input.LicenseType?.Trim() ?? row.LicenseType;
        row.DateOfBirth = input.DateOfBirth; row.LicenseIssueDate = input.LicenseIssueDate; row.LicenseExpiryDate = input.LicenseExpiryDate; row.HireDate = input.HireDate;
        await db.SaveChangesAsync();
        if (input.UpdateVehicle || input.CurrentVehicleId.HasValue) await new DriverOperations(db, tenant, service).Assign(row, input.CurrentVehicleId, input.AssignmentNotes ?? "");
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = row.Id, Action = "office.driver-saved" });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(row);
    }
    private static async Task<IResult> SaveVehicle(Guid? id, OfficeVehicleInput input, TaxiDb db, TenantContext tenant, ReceptionService service)
    {
        if (string.IsNullOrWhiteSpace(input.Plate) || input.Plate.Length > 30 || input.Make is null || input.Make.Length > 80 || input.Model is null || input.Model.Length > 80 || input.Color is null || input.Color.Length > 40 || input.Year is < 1900 || input.Year > DateTime.UtcNow.Year + 1 || input.Status is not ("ACTIVE" or "MAINTENANCE" or "OFFLINE")) return Results.BadRequest();
        await using var tx = await db.Database.BeginTransactionAsync(); await service.Lock();
        if (!await db.Set<Driver>().AnyAsync(d => d.Id == input.DriverId) || !await db.Set<VehicleClass>().AnyAsync(c => c.Id == input.VehicleClassId)) return Results.NotFound();
        var row = id.HasValue ? await db.Set<Vehicle>().SingleOrDefaultAsync(v => v.Id == id) : new Vehicle();
        if (row is null) return Results.NotFound();
        if (await db.Set<Vehicle>().AnyAsync(v => v.Id != row.Id && v.Plate == input.Plate.Trim())) return Results.Conflict(new { detail = "رقم اللوحة موجود" });
        if (id.HasValue && (row.DriverId != input.DriverId || !input.Active || input.Status != "ACTIVE") && await db.Set<ReceptionShift>().AnyAsync(s => s.VehicleId == id && s.Active)) return Results.Conflict(new { detail = "أنه الوردية قبل تغيير الربط أو تعطيل السيارة" });
        var changedDriver = !id.HasValue || row.DriverId != input.DriverId;
        row.Plate = input.Plate.Trim(); row.DriverId = input.DriverId; row.VehicleClassId = input.VehicleClassId; row.Make = input.Make.Trim(); row.Model = input.Model.Trim(); row.Color = input.Color.Trim(); row.Year = input.Year; row.Active = input.Active; row.Status = input.Status;
        if (!id.HasValue) db.Add(row);
        await db.SaveChangesAsync();
        if (changedDriver) await new DriverOperations(db, tenant, service).Assign(await db.Set<Driver>().SingleAsync(d => d.Id == input.DriverId), row.Id, "تحديث ربط السيارة من إدارة السيارات");
        db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = row.Id, Action = "office.vehicle-saved" });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(row);
    }
    private static async Task<IResult> SaveLocation(Guid? id, QueueLocationInput input, TaxiDb db, TenantContext tenant, ReceptionService service)
    {
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 120 || input.SortOrder < 0) return Results.BadRequest();
        await using var tx = await db.Database.BeginTransactionAsync(); await service.Lock();
        var row = id.HasValue ? await db.Set<QueueLocation>().SingleOrDefaultAsync(l => l.Id == id) : new QueueLocation();
        if (row is null) return Results.NotFound();
        if (await db.Set<QueueLocation>().AnyAsync(l => l.Id != row.Id && l.Name == input.Name.Trim())) return Results.Conflict(new { detail = "اسم الموقع موجود" });
        if (!input.IsActive && await db.Set<ReceptionQueue>().AnyAsync(q => q.QueueLocationId == row.Id)) return Results.Conflict(new { detail = "انقل أو أخرج السائقين قبل تعطيل الموقع" });
        row.Name = input.Name.Trim(); row.IsActive = input.IsActive; row.SortOrder = input.SortOrder;
        if (!id.HasValue) db.Add(row); db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = row.Id, Action = "queue-location.saved" });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(row);
    }
}
