using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed partial class ReceptionService
{
    // Called inside the existing office transaction and tenant lock.
    private async Task CaptureOfficeCustomer(RideRequest request)
    {
        if (request.Source is not ("MANUAL" or "WHATSAPP" or "LANDLINE" or "LANDLINE_ICALL")) return;
        string phone;
        try { phone = CustomerPhone.Local(request.PassengerPhone); }
        catch (ArgumentException) { return; } // Ground placeholders are not customer profiles.
        var variants = CustomerPhone.Variants(phone);
        var hasProfile = await CustomerEndpoints.HasProfileColumns(db);
        var customers = hasProfile ? db.Set<Customer>().AsTracking() : CustomerEndpoints.LegacyQuery(db).AsTracking();
        var customer = request.CustomerId.HasValue
            ? await customers.SingleAsync(c => c.Id == request.CustomerId)
            : await customers.FirstOrDefaultAsync(c => variants.Contains(c.Phone));
        if (customer is null)
        {
            if (string.IsNullOrWhiteSpace(request.PassengerName)) return;
            customer = new Customer { FullName = request.PassengerName.Trim(), Phone = phone };
            if (hasProfile) db.Add(customer);
            else await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Customer\" (\"Id\",\"TenantId\",\"FullName\",\"Phone\") VALUES ({customer.Id},{tenant.TenantId},{customer.FullName},{customer.Phone})");
            Audit("customer.created", customer.Id);
        }
        else if (string.IsNullOrWhiteSpace(customer.FullName) && !string.IsNullOrWhiteSpace(request.PassengerName))
        {
            customer.FullName = request.PassengerName.Trim();
            if (!hasProfile)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Customer\" SET \"FullName\"={customer.FullName} WHERE \"Id\"={customer.Id} AND \"TenantId\"={tenant.TenantId}");
                db.Entry(customer).State = EntityState.Detached;
            }
            Audit("customer.updated", customer.Id);
        }
        request.CustomerId = customer.Id;
        if (!string.IsNullOrWhiteSpace(request.AddressText) &&
            !await db.Set<SavedAddress>().AnyAsync(a => a.CustomerId == customer.Id && a.AddressText.Trim() != ""))
        {
            var address = await db.Set<SavedAddress>().Where(a=>a.CustomerId==customer.Id).OrderByDescending(a=>a.IsDefault).ThenBy(a=>a.CreatedAt).ThenBy(a=>a.Id).FirstOrDefaultAsync();
            if(address is null){address=new SavedAddress{CustomerId=customer.Id,Label="العنوان",Icon="OTHER",IsDefault=true,Latitude=request.Latitude,Longitude=request.Longitude};db.Add(address);Audit("address.created",address.Id);}
            else {address.Version++;address.UpdatedAt=DateTimeOffset.UtcNow;Audit("address.updated",address.Id);}
            address.AddressText=request.AddressText.Trim();
            if(string.IsNullOrWhiteSpace(address.Neighborhood))address.Neighborhood=request.Neighborhood;
            if(string.IsNullOrWhiteSpace(address.Street))address.Street=request.Street;
        }
    }
}
