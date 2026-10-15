using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Services;

// Registered ONLY in DriverQa. The driver ID identifies an internal conversation,
// not a fabricated ride; no ride/status/price records are created or modified.
public sealed class QaOfficeConversation(TaxiDb db,TenantContext tenant)
{
    public async Task<bool> IsOffice(CancellationToken ct) => await db.Set<User>().AnyAsync(u=>u.Id==tenant.ActorId&&u.Username=="qa.office"&&u.Active,ct);
    public async Task<CallParty?> Access(Guid channel,CancellationToken ct)
    {
        var driver=await db.Set<Driver>().AsNoTracking().SingleOrDefaultAsync(d=>d.Id==channel&&d.Active&&d.Status!=DriverStatus.Suspended,ct);
        if(driver is null||!await db.Set<User>().AnyAsync(u=>u.Id==driver.UserId&&u.Username=="qa.driver"&&u.Active&&db.Set<Permission>().Any(p=>p.RoleId==u.RoleId&&p.Code=="rides.drive"),ct))return null;
        var office=await db.Set<User>().AsNoTracking().SingleOrDefaultAsync(u=>u.Username=="qa.office"&&u.Active,ct);
        if(office is null||tenant.ActorId!=driver.UserId&&tenant.ActorId!=office.Id)return null;
        return new(driver.Id,driver.UserId,office.Id,driver.FullName,"مكتب الاختبار",tenant.ActorId==driver.UserId);
    }
    public async Task<Guid[]> Channels(CancellationToken ct)
    {
        var ids=await db.Set<Driver>().Where(d=>d.Active&&db.Set<User>().Any(u=>u.Id==d.UserId&&u.Username=="qa.driver"&&u.Active)).Select(d=>d.Id).Take(2).ToArrayAsync(ct);
        var allowed=new List<Guid>();foreach(var id in ids)if(await Access(id,ct) is not null)allowed.Add(id);return allowed.ToArray();
    }
}
