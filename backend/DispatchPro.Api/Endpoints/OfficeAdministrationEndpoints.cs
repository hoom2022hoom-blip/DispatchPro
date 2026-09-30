using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record OfficeUserUpdate(Guid RoleId, bool Active);
public sealed record OfficeRoleUpdate(string Name, string[] Codes);
public static class OfficeAdministrationEndpoints
{
    public static void MapOfficeAdministration(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/administration").RequireAuthorization();
        api.MapGet("/access", (TenantContext tenant, HttpContext http) => Results.Ok(new { tenant.ActorId, tenant.TenantId, permissions = http.User.FindAll("permission").Select(c => c.Value).Distinct() }));
        api.MapGet("/users", async (string? search, int? page, TaxiDb db) => {
            if (page is < 1 or > 100000 || search?.Length > 100) return Results.BadRequest();
            var query = db.Set<User>().AsNoTracking();
            if (!string.IsNullOrWhiteSpace(search)) query = query.Where(u => u.Username.Contains(search.Trim()));
            return Results.Ok(new { total = await query.CountAsync(), items = await query.OrderBy(u => u.Username).ThenBy(u => u.Id).Skip(((page ?? 1)-1)*50).Take(50).Select(u => new { u.Id, u.Username, u.RoleId, u.Active }).ToListAsync() });
        }).RequireAuthorization("users.write");
        api.MapPut("/users/{id:guid}", async (Guid id, OfficeUserUpdate input, TaxiDb db, TenantContext tenant) => {
            var user = await db.Set<User>().SingleOrDefaultAsync(u => u.Id == id);
            if (user is null || !await db.Set<Role>().AnyAsync(r => r.Id == input.RoleId)) return Results.NotFound();
            if (id == tenant.ActorId && (!input.Active || !await db.Set<Permission>().AnyAsync(p => p.RoleId == input.RoleId && p.Code == "users.write"))) return Results.Conflict(new { detail = "لا يمكنك تعطيل حسابك أو إزالة صلاحية إدارته" });
            user.RoleId = input.RoleId; user.Active = input.Active;
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = id, Action = "user.updated" });
            await db.SaveChangesAsync(); return Results.Ok(new { user.Id, user.Username, user.RoleId, user.Active });
        }).RequireAuthorization("users.write");
        api.MapGet("/roles", async (TaxiDb db) => Results.Ok(new { codes = Permissions.All, roles = await db.Set<Role>().AsNoTracking().OrderBy(r => r.Name).Select(r => new { r.Id, r.Name, codes = db.Set<Permission>().Where(p => p.RoleId == r.Id).Select(p => p.Code).ToArray() }).ToListAsync() })).RequireAuthorization("users.write");
        api.MapPut("/roles/{id:guid}", async (Guid id, OfficeRoleUpdate input, TaxiDb db, TenantContext tenant) => {
            if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 100 || input.Codes is null || input.Codes.Any(c => !Permissions.All.Contains(c))) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync();
            var role = await db.Set<Role>().SingleOrDefaultAsync(r => r.Id == id);
            if (role is null) return Results.NotFound();
            if (!input.Codes.Contains("users.write") && await db.Set<User>().AnyAsync(u => u.Id == tenant.ActorId && u.RoleId == id)) return Results.Conflict(new { detail = "احتفظ بصلاحية إدارة المستخدمين لدورك الحالي" });
            role.Name = input.Name.Trim();
            var existing = await db.Set<Permission>().Where(p => p.RoleId == id).ToListAsync();
            db.RemoveRange(existing.Where(p => !input.Codes.Contains(p.Code)));
            foreach (var code in input.Codes.Distinct().Except(existing.Select(p => p.Code))) db.Add(new Permission { RoleId = id, Code = code });
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = id, Action = "role.permissions-updated" });
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok();
        }).RequireAuthorization("users.write");
        // A bounded, tenant-scoped internal activity feed; no external delivery or push service.
        api.MapGet("/notifications", async (TaxiDb db) => Results.Ok(await db.Set<AuditLog>().AsNoTracking().OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Take(50).Select(a => new { a.Id, a.Action, a.EntityId, a.CreatedAt }).ToListAsync())).RequireAuthorization("audit.read");
    }
}
