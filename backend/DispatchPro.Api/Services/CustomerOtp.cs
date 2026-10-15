using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

// A real adapter must be supplied server-side. No SMS codes in responses or logs.
public interface ICustomerSmsSender
{
    bool Enabled { get; }
    Task Send(Guid tenant, string phone, string code, Guid challenge, CancellationToken cancellation);
}
public sealed class UnconfiguredCustomerSmsSender : ICustomerSmsSender
{
    public bool Enabled => false;
    public Task Send(Guid tenant, string phone, string code, Guid challenge, CancellationToken cancellation) => throw new InvalidOperationException("SMS unavailable");
}
// Retain the old optional lease field to read already-encrypted records. New
// test identities have no calendar deadline; individual OTPs still expire.
public sealed record CustomerOtpChallenge(string Phone, Guid AccountId, string Salt, string Hash, DateTimeOffset Expires, DateTimeOffset? TestAccessExpires = null, bool TestOnly = false);
public sealed record CustomerOtpProof(Guid Tenant, Guid AccountId, string Phone, Guid Challenge, DateTimeOffset Expires, DateTimeOffset? TestAccessExpires = null, bool TestOnly = false);
public sealed class CustomerOtp(TaxiDb db, TenantContext context, IDataProtectionProvider protection, ICustomerSmsSender sender, IHostEnvironment environment, IConfiguration configuration)
{
    public bool ConsumedTestProof { get; private set; }
    public static string VerifiedKey(Guid tenant,string phone)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(tenant+":"+CustomerPhone.Local(phone))));
    private IDataProtector Protector => protection.CreateProtector("DispatchPro.CustomerOtp.v1", context.TenantId.ToString());
    private static string Hash(string salt, string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(salt+":"+code)));
    private async Task Lock(CancellationToken ct) => await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({context.TenantId.ToString()+":customer-otp"},0))",ct);
    public async Task<(int Status, Guid? Id)> Request(string phone, Guid account, CancellationToken ct, bool testOnly = false)
    {
        if(testOnly && !await CustomerTestAccess.Allowed(db,context,environment,configuration,ct))return (403,null);
        if(!sender.Enabled)return (503,null);
        var now=DateTimeOffset.UtcNow;
        // Phone is a keyed protected identifier; neither phone nor code appears in audit detail.
        // Independent test devices may request codes for the same normalized
        // phone concurrently. Real SMS limits remain phone-scoped.
        var phoneId=new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(context.TenantId+":"+phone+(testOnly?":"+account:"")))[..16]);
        var reservedChallenge=Guid.NewGuid();
        await using(var reservation=await db.Database.BeginTransactionAsync(ct)) {
            await Lock(ct);
            // Include failed/ambiguous provider calls in the limit. Count old
            // requests too, but not twice when their reservation exists.
            var recent=await db.Set<AuditLog>().Where(a=>a.EntityId==phoneId&&a.CreatedAt>now.AddHours(-1)
                &&(a.Action=="customer.otp.send-attempt"||a.Action=="customer.otp.request"
                    &&!db.Set<AuditLog>().Any(s=>s.Action=="customer.otp.send-attempt"&&s.Detail==a.Id.ToString())))
                .OrderByDescending(a=>a.CreatedAt).ToListAsync(ct);
            if(recent.Count>=5||recent.Any(a=>a.CreatedAt>now.AddSeconds(-60)))return (429,null);
            db.Add(new AuditLog{ActorId=account,EntityId=phoneId,Action="customer.otp.send-attempt",Detail=reservedChallenge.ToString()});
            await db.SaveChangesAsync(ct);await reservation.CommitAsync(ct);
        }
        var code=RandomNumberGenerator.GetInt32(100000,1000000).ToString();
        var salt=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var row=new AuditLog{Id=reservedChallenge,ActorId=account,EntityId=phoneId,Action="customer.otp.request",Detail=Protector.Protect(JsonSerializer.Serialize(new CustomerOtpChallenge(phone,account,salt,Hash(salt,code),now.AddMinutes(5),TestOnly:testOnly)))};
        // Provider calls run outside the tenant lock. Keep reservations on
        // timeout/failure so immediate retries cannot send duplicate paid SMS.
        try{await sender.Send(context.TenantId,phone,code,row.Id,ct);}catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}catch{return (503,null);}
        db.Add(row);await db.SaveChangesAsync(ct);return (200,row.Id);
    }
    public async Task<string?> Verify(Guid challenge, Guid account, string code, CancellationToken ct)
    {
        if(code.Length!=6||!code.All(char.IsAsciiDigit))return null;
        await using var tx=await db.Database.BeginTransactionAsync(ct);await Lock(ct);
        var row=await db.Set<AuditLog>().SingleOrDefaultAsync(a=>a.Id==challenge&&a.ActorId==account&&a.Action=="customer.otp.request",ct);
        if(row is null||await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==challenge&&a.Action=="customer.otp.verified",ct))return null;
        CustomerOtpChallenge value;try{value=JsonSerializer.Deserialize<CustomerOtpChallenge>(Protector.Unprotect(row.Detail))!;}catch{return null;}
        if(await db.Set<AuditLog>().AnyAsync(a=>a.Action=="customer.otp.request"&&a.ActorId==account&&a.EntityId==row.EntityId&&a.CreatedAt>row.CreatedAt,ct))return null;
        var testOnly=value.TestOnly||value.TestAccessExpires is not null;
        if(testOnly&&!await CustomerTestAccess.Allowed(db,context,environment,configuration,ct))return null;
        if(value.Expires<=DateTimeOffset.UtcNow||await db.Set<AuditLog>().CountAsync(a=>a.EntityId==challenge&&a.Action=="customer.otp.attempt",ct)>=5)return null;
        db.Add(new AuditLog{ActorId=account,EntityId=challenge,Action="customer.otp.attempt"});
        var valid=CryptographicOperations.FixedTimeEquals(Convert.FromHexString(value.Hash),Convert.FromHexString(Hash(value.Salt,code)));
        if(valid)db.Add(new AuditLog{ActorId=account,EntityId=challenge,Action="customer.otp.verified"});
        await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);
        return valid?Protector.Protect(JsonSerializer.Serialize(new CustomerOtpProof(context.TenantId,account,value.Phone,challenge,DateTimeOffset.UtcNow.AddMinutes(5),TestOnly:testOnly))):null;
    }
    // Called inside registration's existing transaction; the proof is consumed once.
    public async Task<bool> Consume(string? proof, Guid account, string phone, CancellationToken ct)
    {
        if(string.IsNullOrEmpty(proof)||proof.Length>4096)return false;
        CustomerOtpProof value;try{value=JsonSerializer.Deserialize<CustomerOtpProof>(Protector.Unprotect(proof))!;}catch{return false;}
        if(value.Tenant!=context.TenantId||value.AccountId!=account||value.Phone!=phone||value.Expires<=DateTimeOffset.UtcNow)return false;
        var testOnly=value.TestOnly||value.TestAccessExpires is not null;
        if(testOnly&&!await CustomerTestAccess.Allowed(db,context,environment,configuration,ct))return false;
        if(!await db.Set<AuditLog>().AnyAsync(a=>a.ActorId==account&&a.EntityId==value.Challenge&&a.Action=="customer.otp.verified",ct)||await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==value.Challenge&&a.Action=="customer.otp.consumed",ct))return false;
        db.Add(new AuditLog{ActorId=account,EntityId=value.Challenge,Action="customer.otp.consumed"});
        ConsumedTestProof=testOnly;
        db.Add(new AuditLog{ActorId=account,EntityId=account,Action=ConsumedTestProof?"customer.phone.test-verified":"customer.phone.verified",Detail=ConsumedTestProof?JsonSerializer.Serialize(new CustomerTestAccess.Verification(VerifiedKey(context.TenantId,phone))):VerifiedKey(context.TenantId,phone)});return true;
    }
}
