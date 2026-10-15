using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record CustomerProfileInput(string FullName, string Phone, string? SecondaryPhone = null, string? Notes = null, bool IsActive = true, string? AddressText = null);
public sealed record CustomerListItem(Guid Id, Guid TenantId, string FullName, string Phone, string SecondaryPhone, string Notes, bool IsActive, DateTimeOffset CreatedAt, string AddressText, int OrderCount, DateTimeOffset? LastOrderAt, DateTimeOffset? FirstOrderAt);

public static class CustomerEndpoints
{
    public static void MapCustomers(this WebApplication app)
    {
        app.MapCustomerHistory();
        var api=app.MapGroup("/api/v1/customers").RequireAuthorization();
        api.MapGet("",async (string? search,int? page,int? limit,bool? paged,TaxiDb db)=>{
            if(page < 1 || page > 100000 || limit < 1 || limit > 500) return Results.BadRequest();
            var hasProfile=await HasProfileColumns(db);
            var rows=hasProfile?db.Set<Customer>().AsNoTracking():LegacyQuery(db);
            var totalCustomers=paged==true?await rows.CountAsync():0;
            if(!string.IsNullOrWhiteSpace(search)){var value=search.Trim();var phone=CustomerPhone.SearchKey(value);rows=rows.Where(c=>EF.Functions.ILike(c.FullName,"%"+value+"%")||(phone!=""&&(c.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(phone)||c.SecondaryPhone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(phone)))||db.Set<SavedAddress>().Any(a=>a.CustomerId==c.Id&&(EF.Functions.ILike(a.AddressText,"%"+value+"%")||EF.Functions.ILike(a.Label,"%"+value+"%")||EF.Functions.ILike(a.Neighborhood,"%"+value+"%")||EF.Functions.ILike(a.Street,"%"+value+"%"))));}
            var size=limit??500;
            var total=paged==true?await rows.CountAsync():0;
            var result=await rows.OrderBy(c=>c.FullName).ThenBy(c=>c.Id).Skip(((page??1)-1)*size).Take(size).ToListAsync();
            var items=await Enrich(db,result);
            return paged==true?Results.Ok(new{items,total,totalCustomers,page=page??1,pageSize=size}):Results.Ok(items);
        }).RequireAuthorization("customers.read");
        api.MapGet("/{id:guid}",async (Guid id,TaxiDb db)=>{
            var rows=await HasProfileColumns(db)?db.Set<Customer>().AsNoTracking():LegacyQuery(db);
            var customer=await rows.SingleOrDefaultAsync(c=>c.Id==id);return customer is null?Results.NotFound():Results.Ok((await Enrich(db,[customer]))[0]);
        }).RequireAuthorization("customers.read");
        api.MapPost("",async (CustomerProfileInput input,TaxiDb db,TenantContext tenant,ReceptionService service)=>{
            if(string.IsNullOrWhiteSpace(input.FullName)||input.FullName.Length>150||input.AddressText?.Length>500)return Results.BadRequest();
            var local=CustomerPhone.Local(input.Phone);var variants=CustomerPhone.Variants(local);
            await using var tx=await db.Database.BeginTransactionAsync();await service.Lock();
            if(await db.Set<Customer>().AnyAsync(c=>variants.Contains(c.Phone)))return Results.Conflict(new{detail="رقم الزبون موجود مسبقًا"});
            var customer=new Customer{TenantId=tenant.TenantId,FullName=input.FullName.Trim(),Phone=local,SecondaryPhone=input.SecondaryPhone?.Trim()??"",Notes=input.Notes?.Trim()??"",IsActive=input.IsActive};
            if(await HasProfileColumns(db)){db.Add(customer);db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=customer.Id,Action="customer.created"});await db.SaveChangesAsync();}
            else {await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Customer\" (\"Id\",\"TenantId\",\"FullName\",\"Phone\") VALUES ({customer.Id},{tenant.TenantId},{customer.FullName},{customer.Phone})");db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=customer.Id,Action="customer.created"});await db.SaveChangesAsync();}
            await SaveProfileAddress(db,tenant,customer.Id,input.AddressText);
            await db.SaveChangesAsync();await tx.CommitAsync();
            return Results.Created($"/api/v1/customers/{customer.Id}",(await Enrich(db,[customer]))[0]);
        }).RequireAuthorization("customers.write");
        api.MapPut("/{id:guid}",async (Guid id,CustomerProfileInput input,TaxiDb db,TenantContext tenant,ReceptionService service)=>{
            if(string.IsNullOrWhiteSpace(input.FullName)||input.FullName.Length>150||input.AddressText?.Length>500)return Results.BadRequest();
            await using var tx=await db.Database.BeginTransactionAsync();await service.Lock();
            var hasProfile=await HasProfileColumns(db);var rows=hasProfile?db.Set<Customer>().AsTracking():LegacyQuery(db).AsTracking();var customer=await rows.SingleOrDefaultAsync(c=>c.Id==id);if(customer is null)return Results.NotFound();
            var local=CustomerPhone.Local(input.Phone);var variants=CustomerPhone.Variants(local);
            if(await db.Set<Customer>().AnyAsync(c=>c.Id!=id&&variants.Contains(c.Phone)))return Results.Conflict(new{detail="رقم الزبون موجود مسبقًا"});
            customer.FullName=input.FullName.Trim();customer.Phone=local;customer.SecondaryPhone=input.SecondaryPhone?.Trim()??"";customer.Notes=input.Notes?.Trim()??"";customer.IsActive=input.IsActive;
            if(hasProfile){db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="customer.updated"});await db.SaveChangesAsync();}
            else {await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Customer\" SET \"FullName\"={customer.FullName},\"Phone\"={customer.Phone} WHERE \"Id\"={id} AND \"TenantId\"={tenant.TenantId}");db.Entry(customer).State=EntityState.Detached;db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="customer.updated"});await db.SaveChangesAsync();}
            await SaveProfileAddress(db,tenant,id,input.AddressText);
            await db.SaveChangesAsync();await tx.CommitAsync();
            return Results.Ok((await Enrich(db,[customer]))[0]);
        }).RequireAuthorization("customers.write");
    }

    // A bounded set of batched queries; counts come from requests, never a manual counter.
    internal static async Task<CustomerListItem[]> Enrich(TaxiDb db,List<Customer> customers)
    {
        if(customers.Count==0)return [];
        var ids=customers.Select(c=>c.Id).ToArray();
        var addresses=await db.Set<SavedAddress>().AsNoTracking().Where(a=>ids.Contains(a.CustomerId)).OrderByDescending(a=>a.IsDefault).ThenBy(a=>a.CreatedAt).ThenBy(a=>a.Id).ToListAsync();
        var stats=await CustomerHistoryEndpoints.SearchStats(db,ids);
        return customers.Select(c=>{stats.TryGetValue(c.Id,out var s);var address=addresses.FirstOrDefault(a=>a.CustomerId==c.Id&&!string.IsNullOrWhiteSpace(a.AddressText));return new CustomerListItem(c.Id,c.TenantId,c.FullName,CustomerPhone.Display(c.Phone),c.SecondaryPhone,c.Notes,c.IsActive,c.CreatedAt,address?.AddressText??"",s?.Count??0,s?.Last,s?.First);}).ToArray();
    }

    private static async Task SaveProfileAddress(TaxiDb db,TenantContext tenant,Guid customerId,string? text)
    {
        if(text is null)return; // Older callers do not implicitly clear an address.
        var value=text.Trim();
        var address=await db.Set<SavedAddress>().Where(a=>a.CustomerId==customerId).OrderByDescending(a=>a.IsDefault).ThenBy(a=>a.CreatedAt).ThenBy(a=>a.Id).ToListAsync();
        var primary=address.FirstOrDefault(a=>!string.IsNullOrWhiteSpace(a.AddressText))??address.FirstOrDefault();
        if(primary is null){if(value=="")return;primary=new SavedAddress{CustomerId=customerId,Label="العنوان",Icon="OTHER",IsDefault=true};db.Add(primary);}
        else if(primary.AddressText==value)return;
        else {primary.Version++;primary.UpdatedAt=DateTimeOffset.UtcNow;}
        primary.AddressText=value;
        db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=primary.Id,Action="address.updated"});
    }

    public static IQueryable<Customer> LegacyQuery(TaxiDb db)=>db.Set<Customer>().FromSqlRaw("SELECT \"Id\",\"FullName\",\"Phone\",\"TenantId\",''::text AS \"SecondaryPhone\",''::text AS \"Notes\",TRUE AS \"IsActive\",now() AS \"CreatedAt\" FROM \"Customer\"");
    internal static Task<bool> HasProfileColumns(TaxiDb db)=>db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Customer' AND column_name='SecondaryPhone') AS \"Value\"").SingleAsync();
}
