#if DEBUG
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public static class CustomerTestEndpoints
{
    public static void MapCustomerTest(this WebApplication app)
    {
        if (!CustomerTestAccess.Enabled(app.Environment, app.Configuration)) return;
        app.MapPost("/api/v1/customer-app/test-otp/request", async (CustomerOtpRequest input, TaxiDb db, TenantContext context, IDataProtectionProvider protection, DevelopmentCustomerSms sender, HttpContext http, CancellationToken ct) =>
        {
            if (input.Tenant != CustomerTestAccess.Office || http.Request.Headers["X-Customer-Debug"] != "1") return Results.NotFound();
            if (input.AccountId == Guid.Empty) return Results.BadRequest();
            var office = await db.Set<Tenant>().SingleOrDefaultAsync(t => t.Slug == CustomerTestAccess.Office, ct);
            if (office is null) return Results.NotFound();
            context.TenantId = office.Id;
            var phone = CustomerPhone.Local(input.Phone);
            var otp = new CustomerOtp(db, context, protection, sender, app.Environment, app.Configuration);
            var result = await otp.Request(phone, input.AccountId, ct, testOnly:true);
            if (result.Status != 200) return Results.Json(new { code = "OTP_RATE_LIMITED" }, statusCode: result.Status);
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { challengeId = result.Id, expiresIn = 300, resendAfter = 60, debugCode = sender.Code(result.Id!.Value), developmentOnly = true });
        }).RequireRateLimiting("customer-otp");
    }
}
#endif
