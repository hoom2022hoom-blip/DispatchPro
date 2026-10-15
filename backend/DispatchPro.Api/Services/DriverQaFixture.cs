using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;
public static class DriverQaFixture
{
    public static async Task Seed(TaxiDb db,TenantContext context,IConfiguration config)
    {
        context.TenantId=await db.Set<Tenant>().Where(t=>t.Slug=="driver-qa").Select(t=>t.Id).SingleAsync();
        if(await db.Set<User>().AnyAsync(u=>u.Username=="qa.driver"))return;
        var driverRole=await db.Set<Role>().SingleAsync(r=>r.Name=="Driver");
        var user=new User{Username="qa.driver",RoleId=driverRole.Id};
        user.PasswordHash=new PasswordHasher<User>().HashPassword(user,config["Qa:DriverPassword"]!);
        var driver=new Driver{UserId=user.Id,FullName="سائق اختبار معزول",Status=DriverStatus.Available,Phone="",WhatsappEnabled=false,HasWhatsApp=false};
        var vehicle=new Vehicle{DriverId=driver.Id,VehicleClassId=await db.Set<VehicleClass>().Select(v=>v.Id).FirstAsync(),Plate="QA-ONLY-01",Make="QA",Model="Synthetic"};
        var customer=new Customer{FullName="راكب اختبار معزول",Phone="QA-PEER"};
        var peerRole=new Role{Name="CustomerApp"};
        var peer=new User{Id=customer.Id,Username="customer-"+customer.Id.ToString("N"),RoleId=peerRole.Id};
        peer.PasswordHash=new PasswordHasher<User>().HashPassword(peer,config["Qa:PeerPassword"]!);
        db.AddRange(user,driver,vehicle,customer,peerRole,peer);
        db.Add(new AuditLog{ActorId=peer.Id,EntityId=peer.Id,Action="customer.qa.synthetic",Detail="QA-PEER"});
        foreach(var flag in await db.Set<FeatureFlag>().ToListAsync())flag.Enabled=flag.Key is "ManualPricing" or "GpsMeter" or "Chat" or "Calling";
        await db.SaveChangesAsync();
        driver.CurrentVehicleId=vehicle.Id;await db.SaveChangesAsync();
    }
}
