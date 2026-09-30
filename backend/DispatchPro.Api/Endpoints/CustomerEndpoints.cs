using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record CustomerProfileInput(string FullName, string Phone, string? SecondaryPhone = null, string? Notes = null, bool IsActive = true);

public static class CustomerEndpoints
{
    public static void MapCustomers(this WebApplication app)
    {
        var api=app.MapGroup("/api/v1/customers").RequireAuthorization();
        api.MapGet("",async (string? search,int? page,int? limit,TaxiDb db)=>{
            if(page < 1 || page > 100000 || limit < 1 || limit > 500) return Results.BadRequest();
            var hasProfile=await HasProfileColumns(db);
            var rows=hasProfile?db.Set<Customer>().AsNoTracking():LegacyQuery(db);
            if(!string.IsNullOrWhiteSpace(search)){var value=search.Trim();var phone=CustomerPhone.SearchKey(value);rows=rows.Where(c=>c.FullName.Contains(value)||(phone!=""&&(c.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(phone)||c.SecondaryPhone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(phone))));}
            var size=limit??500;
            var result=await rows.OrderBy(c=>c.FullName).ThenBy(c=>c.Id).Skip(((page??1)-1)*size).Take(size).ToListAsync();
            foreach(var customer in result)customer.Phone=CustomerPhone.Display(customer.Phone);
            return Results.Ok(result);
        }).RequireAuthorization("customers.read");
        api.MapGet("/{id:guid}",async (Guid id,TaxiDb db)=>{
            var rows=await HasProfileColumns(db)?db.Set<Customer>().AsNoTracking():LegacyQuery(db);
            var customer=await rows.SingleOrDefaultAsync(c=>c.Id==id);if(customer is not null)customer.Phone=CustomerPhone.Display(customer.Phone);return customer is null?Results.NotFound():Results.Ok(customer);
        }).RequireAuthorization("customers.read");
        api.MapPost("",async (CustomerProfileInput input,TaxiDb db,TenantContext tenant)=>{
            if(string.IsNullOrWhiteSpace(input.FullName)||input.FullName.Length>150)return Results.BadRequest();
            var local=CustomerPhone.Local(input.Phone);var variants=CustomerPhone.Variants(local);
            if(await db.Set<Customer>().AnyAsync(c=>variants.Contains(c.Phone)))return Results.Conflict(new{detail="رقم الزبون موجود مسبقًا"});
            var customer=new Customer{FullName=input.FullName.Trim(),Phone=local,SecondaryPhone=input.SecondaryPhone?.Trim()??"",Notes=input.Notes?.Trim()??"",IsActive=input.IsActive};
            if(await HasProfileColumns(db)){db.Add(customer);db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=customer.Id,Action="customer.created"});await db.SaveChangesAsync();}
            else {await using var tx=await db.Database.BeginTransactionAsync();await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Customer\" (\"Id\",\"TenantId\",\"FullName\",\"Phone\") VALUES ({customer.Id},{tenant.TenantId},{customer.FullName},{customer.Phone})");db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=customer.Id,Action="customer.created"});await db.SaveChangesAsync();await tx.CommitAsync();}
            return Results.Created($"/api/v1/customers/{customer.Id}",customer);
        }).RequireAuthorization("customers.write");
        api.MapPut("/{id:guid}",async (Guid id,CustomerProfileInput input,TaxiDb db,TenantContext tenant)=>{
            if(string.IsNullOrWhiteSpace(input.FullName)||input.FullName.Length>150)return Results.BadRequest();
            var hasProfile=await HasProfileColumns(db);var rows=hasProfile?db.Set<Customer>().AsTracking():LegacyQuery(db).AsTracking();var customer=await rows.SingleOrDefaultAsync(c=>c.Id==id);if(customer is null)return Results.NotFound();
            var local=CustomerPhone.Local(input.Phone);var variants=CustomerPhone.Variants(local);
            if(await db.Set<Customer>().AnyAsync(c=>c.Id!=id&&variants.Contains(c.Phone)))return Results.Conflict(new{detail="رقم الزبون موجود مسبقًا"});
            customer.FullName=input.FullName.Trim();customer.Phone=local;customer.SecondaryPhone=input.SecondaryPhone?.Trim()??"";customer.Notes=input.Notes?.Trim()??"";customer.IsActive=input.IsActive;
            if(hasProfile){db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="customer.updated"});await db.SaveChangesAsync();}
            else {await using var tx=await db.Database.BeginTransactionAsync();await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Customer\" SET \"FullName\"={customer.FullName},\"Phone\"={customer.Phone} WHERE \"Id\"={id} AND \"TenantId\"={tenant.TenantId}");db.Entry(customer).State=EntityState.Detached;db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="customer.updated"});await db.SaveChangesAsync();await tx.CommitAsync();}
            return Results.Ok(customer);
        }).RequireAuthorization("customers.write");
    }

    public static IQueryable<Customer> LegacyQuery(TaxiDb db)=>db.Set<Customer>().FromSqlRaw("SELECT \"Id\",\"FullName\",\"Phone\",\"TenantId\",''::text AS \"SecondaryPhone\",''::text AS \"Notes\",TRUE AS \"IsActive\",now() AS \"CreatedAt\" FROM \"Customer\"");
    private static Task<bool> HasProfileColumns(TaxiDb db)=>db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Customer' AND column_name='SecondaryPhone') AS \"Value\"").SingleAsync();
}
