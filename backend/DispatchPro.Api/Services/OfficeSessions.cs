using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

// Durable, revocable session families use existing tenant-scoped storage; no schema migration.
public sealed class OfficeSessions(TaxiDb db, TenantContext tenant, TokenService tokens, IConfiguration config)
{
    private sealed record State(long Generation, DateTimeOffset RotatedAt, string SecurityStamp, string? DeviceId=null, string Application="driver");
    private string Mac(string value) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(config["Auth:SigningKey"]!),Encoding.UTF8.GetBytes("office-refresh-v1:"+value)));
    private string Stamp(User user) => Mac(user.PasswordHash+":"+user.RoleId);
    private string Credential(AuditLog row,long generation) {var value=$"{row.TenantId:N}.{row.Id:N}.{generation}";return value+"."+Mac(value);}
    public async Task<bool> Replaced(string credential)
    {
        if(string.IsNullOrWhiteSpace(credential)||credential.Length>240)return false;
        var parts=credential.Split('.');
        if(parts.Length!=4||!Guid.TryParseExact(parts[0],"N",out var tenantId)||!Guid.TryParseExact(parts[1],"N",out var id))return false;
        var expected=Mac(string.Join('.',parts.Take(3)));
        if(parts[3].Length!=expected.Length||!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(parts[3]),Encoding.ASCII.GetBytes(expected)))return false;
        tenant.TenantId=tenantId;
        return await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==id&&a.Action=="office.session.revoked"&&a.Detail=="SESSION_REPLACED");
    }
    public async Task<object> Create(User user,string slug,string? deviceId=null,string application="driver")
    {
        var driver=await db.Set<Driver>().AnyAsync(d=>d.UserId==user.Id);
        await using var tx=await db.Database.BeginTransactionAsync();
        if(driver){
            if(application is not ("driver" or "radio"))throw new ArgumentException("Invalid application");
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({user.Id.ToString()}))");
            var previous=await db.Set<AuditLog>().Where(a=>a.EntityId==user.Id&&a.Action=="office.session.created"&&(application=="radio"?a.Detail.Contains("\"Application\":\"radio\""):!a.Detail.Contains("\"Application\":\"radio\""))&&!db.Set<AuditLog>().Any(r=>r.EntityId==a.Id&&r.Action=="office.session.revoked")).Select(a=>a.Id).ToListAsync();
            foreach(var id in previous)db.Add(new AuditLog{EntityId=id,ActorId=user.Id,Action="office.session.revoked",Detail="SESSION_REPLACED"});
        }
        var row=new AuditLog {EntityId=user.Id,ActorId=user.Id,Action="office.session.created",Detail=JsonSerializer.Serialize(new State(0,DateTimeOffset.UtcNow,Stamp(user),driver?deviceId:null,application))};
        db.Add(row);await db.SaveChangesAsync();await tx.CommitAsync();return new {accessToken=tokens.Issue(user,row.Id.ToString(),application:driver?application:null),refreshToken=Credential(row,0),expiresIn=1800,tenant=slug};
    }
    public async Task<object?> Renew(string credential,bool revoke=false)
    {
        if(string.IsNullOrWhiteSpace(credential)||credential.Length>240)return null;
        var parts=credential.Split('.');
        if(parts.Length!=4||!Guid.TryParseExact(parts[0],"N",out var tenantId)||!Guid.TryParseExact(parts[1],"N",out var id)||!long.TryParse(parts[2],out var generation))return null;
        var expected=Mac(string.Join('.',parts.Take(3)));
        if(parts[3].Length!=expected.Length||!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(parts[3]),Encoding.ASCII.GetBytes(expected)))return null;
        tenant.TenantId=tenantId;
        await using var tx=await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({id.ToString()}))");
        var row=await db.Set<AuditLog>().AsNoTracking().SingleOrDefaultAsync(a=>a.Id==id&&a.Action=="office.session.created");
        if(row is null)return null;
        if(await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==id&&a.Action=="office.session.revoked"))return null;
        var latest=await db.Set<AuditLog>().Where(a=>a.EntityId==id&&a.Action=="office.session.renewed").OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Select(a=>a.Detail).FirstOrDefaultAsync();
        var state=JsonSerializer.Deserialize<State>(latest??row.Detail)!;
        var user=await db.Set<User>().SingleOrDefaultAsync(u=>u.Id==row.EntityId&&u.Active);
        var driver= user is null ? null : await db.Set<Driver>().SingleOrDefaultAsync(d=>d.UserId==user.Id);
        var application=state.Application;
        var allowed=user is not null&&(driver is null || MobileAppAccess.Allowed(driver,application))&&(await db.Set<Permission>().AnyAsync(p=>p.RoleId==user.RoleId&&p.Code=="rides.write")||await db.Set<Permission>().AnyAsync(p=>p.RoleId==user.RoleId&&p.Code=="rides.drive")&&await db.Set<Driver>().AnyAsync(d=>d.UserId==user.Id&&d.Active&&d.Status!=DriverStatus.Suspended));
        if(revoke||user is null||state.SecurityStamp!=Stamp(user)||!allowed)
        {db.Add(new AuditLog{EntityId=id,ActorId=row.EntityId,Action="office.session.revoked"});await db.SaveChangesAsync();await tx.CommitAsync();return null;}
        // The previous generation remains recoverable until the replacement is acknowledged
        // by its next renewal, so a lost response followed by an offline period is recoverable.
        if(generation!=state.Generation&&generation!=state.Generation-1)return null;
        if(generation==state.Generation){state=state with {Generation=state.Generation+1,RotatedAt=DateTimeOffset.UtcNow};db.Add(new AuditLog{EntityId=id,ActorId=user.Id,Action="office.session.renewed",Detail=JsonSerializer.Serialize(state)});await db.SaveChangesAsync();}
        var slug=await db.Set<Tenant>().Where(t=>t.Id==tenantId).Select(t=>t.Slug).SingleAsync();
        await tx.CommitAsync();return new {accessToken=tokens.Issue(user,row.Id.ToString(),application:driver is not null?application:null),refreshToken=Credential(row,state.Generation),expiresIn=1800,tenant=slug};
    }
}
