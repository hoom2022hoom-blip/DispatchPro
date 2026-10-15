using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;

namespace DispatchPro.Api.Endpoints;

public sealed record CustomerRegistration(string Tenant, Guid AccountId, string DeviceSecret, string FullName, string Phone, string? VerificationProof = null);
public sealed record CustomerOtpRequest(string Tenant, string Phone, Guid AccountId);
public sealed record CustomerOtpVerify(string Tenant, Guid AccountId, Guid ChallengeId, string Code);
public sealed record CustomerArrivalAck(Guid EventId);
public sealed record CustomerRideInput(Guid Id, LocationInput Pickup, string Destination, string? Notes = null, DateTimeOffset? ScheduledAt = null, LocationInput? DestinationLocation = null);
public sealed record CustomerPlaceInput(Guid Id, string Label, string AddressText, double? Latitude = null, double? Longitude = null, string Icon = "OTHER");

// Device-bound MVP accounts reuse User, PasswordHasher and TokenService unchanged.
// Existing shared-ID accounts remain valid. Device-link audit records bind additional test devices.
public static class CustomerAppEndpoints
{
    public static IQueryable<Ride> OwnRides(TaxiDb db, Guid customerId) => db.Set<Ride>().AsNoTracking().Where(r => db.Set<RideRequest>().Any(q => q.Id == r.RideRequestId && q.CustomerId == customerId));
    public static IQueryable<SavedAddress> OwnPlaces(TaxiDb db, Guid customerId) => db.Set<SavedAddress>().AsNoTracking().Where(p => p.CustomerId == customerId).OrderByDescending(p => p.IsDefault).ThenBy(p => p.Label);
    public static IQueryable<RideRequest> RecentDestinations(TaxiDb db, Guid customerId) => db.Set<RideRequest>().AsNoTracking().Where(r => r.CustomerId == customerId && r.Destination != "").OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id).Take(20);
    private const string RoleName = "CustomerApp";
    private static IQueryable<Customer> Profiles(TaxiDb db) => db.Set<Customer>().FromSqlRaw("SELECT c.\"Id\",c.\"TenantId\",c.\"FullName\",c.\"Phone\",''::text AS \"SecondaryPhone\",''::text AS \"Notes\",COALESCE((to_jsonb(c)->>'IsActive')::boolean,true) AS \"IsActive\",now() AS \"CreatedAt\" FROM \"Customer\" c");
    internal static async Task<Customer?> Own(TaxiDb db, TenantContext tenant)
    {
        var username = "customer-" + tenant.ActorId.ToString("N");
        if (!await (from u in db.Set<User>() join role in db.Set<Role>() on u.RoleId equals role.Id where u.Id == tenant.ActorId && u.Active && u.Username == username && role.Name == RoleName select u.Id).AnyAsync()) return null;
        var linked = await db.Set<AuditLog>().Where(a => a.ActorId == tenant.ActorId && a.Action == "customer-app.device-linked").Select(a => (Guid?)a.EntityId).SingleOrDefaultAsync();
        var customerId = linked ?? tenant.ActorId;
        return await Profiles(db).AsNoTracking().SingleOrDefaultAsync(c => c.Id == customerId && c.IsActive);
    }
    internal static async Task<bool> Verified(TaxiDb db,TenantContext tenant,IHostEnvironment? environment=null,IConfiguration? configuration=null){var own=await Own(db,tenant);if(own is null)return false;if(environment is not null&&DriverQaSafety.Enabled(environment)&&configuration?["Qa:TenantId"]==tenant.TenantId.ToString()&&own.Phone=="QA-PEER")return await db.Set<AuditLog>().AnyAsync(a=>a.ActorId==tenant.ActorId&&a.Action=="customer.qa.synthetic"&&a.Detail=="QA-PEER");var key=CustomerOtp.VerifiedKey(tenant.TenantId,own.Phone);return await db.Set<AuditLog>().AnyAsync(a=>a.ActorId==tenant.ActorId&&a.Action=="customer.phone.verified"&&a.Detail==key)||await CustomerTestAccess.Verified(db,tenant,own.Phone,environment,configuration);}
    private static object Profile(Customer c,bool phoneVerified=true) => new { c.Id, c.FullName, phone = CustomerPhone.Local(c.Phone), phoneVerified };
    private static async Task NormalizeCustomer(TaxiDb db, TenantContext tenant, Customer customer)
    {
        var local = CustomerPhone.Local(customer.Phone);
        if (await db.Set<Customer>().AnyAsync(c => c.Id != customer.Id && CustomerPhone.Variants(local).Contains(c.Phone))) throw new ReceptionConflictException("يوجد أكثر من سجل لهذا الرقم؛ يلزم مراجعة الربط دون حذف الحسابات");
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Customer\" SET \"Phone\"={local} WHERE \"Id\"={customer.Id} AND \"TenantId\"={tenant.TenantId}");
        foreach (var request in await db.Set<RideRequest>().Where(r => r.CustomerId == customer.Id).ToListAsync()) request.PassengerPhone = local;
        var orders = await (from o in db.Set<ReceptionOrder>() join r in db.Set<RideRequest>() on o.RideRequestId equals r.Id where r.CustomerId == customer.Id select o).ToListAsync();
        foreach (var order in orders)
        {
            var payload = JsonNode.Parse(order.Payload)!.AsObject();
            if (payload["passengerPhone"]?.ToString() == local) continue;
            payload["passengerPhone"] = local; payload["receptionVersion"] = ++order.Version;
            order.Payload = payload.ToJsonString(); order.LastWriteHash = "";
        }
        customer.Phone = local;
    }
    private static string State(RideStatus state) => state switch { RideStatus.NoDriverAvailable => "NO_DRIVER_AVAILABLE", RideStatus.DriverArriving => "DRIVER_ARRIVING", RideStatus.Rejected => "REJECTED", RideStatus.Pending => "REQUESTED", RideStatus.Assigned => "ASSIGNED", RideStatus.Accepted => "ACCEPTED", RideStatus.Arrived => "ARRIVED", RideStatus.InProgress => "IN_PROGRESS", RideStatus.Completed => "COMPLETED", _ => "CANCELLED" };

    public static void MapCustomerApp(this WebApplication app)
    {
        app.MapPost("/api/v1/customer-app/otp/request",async(CustomerOtpRequest input,TaxiDb db,TenantContext context,CustomerOtp otp,ICustomerSmsSender sender,IHostEnvironment environment,IConfiguration configuration,HttpContext http,CancellationToken ct)=>{
            if(input.AccountId==Guid.Empty)return Results.BadRequest();
            var office=await db.Set<Tenant>().SingleOrDefaultAsync(t=>t.Slug==input.Tenant,ct);if(office is null)return Results.BadRequest();context.TenantId=office.Id;
            string phone;try{phone=CustomerPhone.Local(input.Phone);CustomerPhone.SmsInternational(phone);}catch(ArgumentException e){return Results.BadRequest(new{code="INVALID_PHONE",detail=e.Message});}
            if(sender is DevelopmentCustomerSms && http.Request.Headers["X-Customer-Debug"]!="1")
                return Results.Json(new{code="SMS_UNAVAILABLE",detail="Debug OTP requires the development client."},statusCode:503);
            var result=await otp.Request(phone,input.AccountId,ct);
            if(result.Status!=200)return Results.Json(new{code=result.Status==503?"SMS_UNAVAILABLE":"OTP_RATE_LIMITED",detail=result.Status==503?"التحقق بالرسائل غير متاح حاليًا. تواصل مع المكتب.":"انتظر قليلًا قبل طلب رمز جديد."},statusCode:result.Status);
            var debugCode=DevelopmentCustomerOtp.Enabled(environment,configuration)&&sender is DevelopmentCustomerSms development&&http.Request.Headers["X-Customer-Debug"]=="1"?development.Code(result.Id!.Value):null;
            http.Response.Headers.CacheControl="no-store";
            return debugCode is null?Results.Ok(new{challengeId=result.Id,expiresIn=300,resendAfter=60}):Results.Ok(new{challengeId=result.Id,expiresIn=300,resendAfter=60,debugCode,developmentOnly=true});
        }).RequireRateLimiting("customer-otp");
        app.MapPost("/api/v1/customer-app/otp/verify",async(CustomerOtpVerify input,TaxiDb db,TenantContext context,CustomerOtp otp,CancellationToken ct)=>{
            var office=await db.Set<Tenant>().SingleOrDefaultAsync(t=>t.Slug==input.Tenant,ct);if(office is null)return Results.BadRequest();context.TenantId=office.Id;
            var proof=await otp.Verify(input.ChallengeId,input.AccountId,input.Code??"",ct);return proof is null?Results.BadRequest(new{code="OTP_INVALID_OR_EXPIRED",detail="رمز التحقق غير صحيح أو انتهت صلاحيته. راجع الرمز أو اطلب رمزًا جديدًا."}):Results.Ok(new{verificationProof=proof});
        }).RequireRateLimiting("customer-otp");
        app.MapPost("/api/v1/customer-app/register", async (CustomerRegistration input, TaxiDb db, TenantContext tenant, TokenService tokens, ReceptionService reception, CustomerOtp otp, CustomerSessions sessions) =>
        {
            if (input.AccountId == Guid.Empty || input.DeviceSecret is null || input.DeviceSecret.Length != 64 || !input.DeviceSecret.All(Uri.IsHexDigit) || string.IsNullOrWhiteSpace(input.FullName) || input.FullName.Trim().Length > 150) return Results.BadRequest();
            var phone = CustomerPhone.Local(input.Phone);
            var variants = CustomerPhone.Variants(phone);
            var office = await db.Set<Tenant>().SingleOrDefaultAsync(t => t.Slug == input.Tenant);
            if (office is null) return Results.BadRequest(new { detail = "معرف المكتب غير صحيح" });
            tenant.TenantId = office.Id;
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var username = "customer-" + input.AccountId.ToString("N");
            var existing = await db.Set<User>().SingleOrDefaultAsync(u => u.Id == input.AccountId);
            var phoneKey=CustomerOtp.VerifiedKey(tenant.TenantId,phone);var verified=await db.Set<AuditLog>().AnyAsync(a=>a.ActorId==input.AccountId&&a.Action=="customer.phone.verified"&&a.Detail==phoneKey);
            tenant.ActorId=input.AccountId;
            var testVerified=await CustomerTestAccess.Verified(db,tenant,phone,app.Environment,app.Configuration);
            if(!verified&&!testVerified&&!await otp.Consume(input.VerificationProof,input.AccountId,phone,CancellationToken.None))return Results.Json(new{detail="يلزم التحقق من رقم الهاتف أولًا."},statusCode:403);
            var testOnly=!verified&&(testVerified||otp.ConsumedTestProof);
            if (existing is not null)
            {
                if (!existing.Active || existing.Username != username || new PasswordHasher<User>().VerifyHashedPassword(existing, existing.PasswordHash, input.DeviceSecret) == PasswordVerificationResult.Failed) return Results.Conflict();
                tenant.ActorId = existing.Id; var own = await Own(db, tenant);
                if (own is null) return Results.Forbid();
                if (CustomerPhone.Local(own.Phone) != phone) return Results.Conflict();
                await NormalizeCustomer(db, tenant, own);var accessToken=sessions.Create(existing); await db.SaveChangesAsync(); await tx.CommitAsync();
                return Results.Ok(new { accessToken, profile = Profile(own,!testOnly) });
            }
            var matches = await Profiles(db).AsNoTracking().Where(c => variants.Contains(c.Phone)).ToListAsync();
            if (matches.Count > 1) return Results.Conflict(new { detail = "يوجد أكثر من سجل لهذا الرقم؛ يلزم مراجعة الربط" });
            var customer = matches.SingleOrDefault();
            // A consumed phone-bound OTP authorizes recovery; no production test bypass.
            if (customer is not null && !customer.IsActive) return Results.Forbid();
            var role = await db.Set<Role>().FirstOrDefaultAsync(r => r.Name == RoleName);
            if (role is null) { role = new Role { Name = RoleName }; db.Add(role); }
            else if (await db.Set<Permission>().AnyAsync(p => p.RoleId == role.Id)) return Results.Conflict(new { detail = "Customer role must have no office permissions" });
            var user = new User { Id = input.AccountId, Username = username, RoleId = role.Id };
            user.PasswordHash = new PasswordHasher<User>().HashPassword(user, input.DeviceSecret);
            db.Add(user); await db.SaveChangesAsync();
            if (customer is null)
            {
                customer = new Customer { Id = user.Id, FullName = input.FullName.Trim(), Phone = phone };
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO \"Customer\" (\"Id\",\"TenantId\",\"FullName\",\"Phone\") VALUES ({customer.Id},{tenant.TenantId},{customer.FullName},{phone})");
            }
            else await NormalizeCustomer(db, tenant, customer);
            db.Add(new AuditLog { ActorId = user.Id, EntityId = customer.Id, Action = "customer-app.device-linked" });
            db.Add(new AuditLog { ActorId = user.Id, EntityId = customer.Id, Action = "customer-app.registered" });
            var access=sessions.Create(user);await db.SaveChangesAsync(); await tx.CommitAsync();
            return Results.Ok(new { accessToken = access, profile = Profile(customer,!testOnly) });
        }).RequireRateLimiting("auth");

        var api = app.MapGroup("/api/v1/customer-app").RequireAuthorization();
        api.MapPost("/rides/{id:guid}/arrival-ack",async(Guid id,CustomerArrivalAck input,TaxiDb db,TenantContext tenant)=>{
            var own=await Own(db,tenant);if(own is null)return Results.Forbid();
            if(!await OwnRides(db,own.Id).AnyAsync(r=>r.Id==id&&r.Status==RideStatus.Arrived))return Results.NotFound();
            var latest=await db.Set<AuditLog>().Where(a=>a.EntityId==id&&a.Action=="ride.notification.Arrived").OrderByDescending(a=>a.CreatedAt).ThenByDescending(a=>a.Id).Select(a=>(Guid?)a.Id).FirstOrDefaultAsync();if(latest!=input.EventId)return Results.Conflict();
            await using var tx=await db.Database.BeginTransactionAsync();await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId+":arrival-ack:"+id},0))");
            if(!await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==own.Id&&a.Action=="customer.arrival.ack"&&a.Detail==input.EventId.ToString())){db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=own.Id,Action="customer.arrival.ack",Detail=input.EventId.ToString()});await db.SaveChangesAsync();}await tx.CommitAsync();return Results.NoContent();
        });
        api.MapPost("/logout",async(HttpContext http,TaxiDb db,TenantContext tenant)=>{if(await Own(db,tenant)is null)return Results.Forbid();var value=http.User.FindFirst("customer_session")?.Value;if(Guid.TryParse(value,out var id)){db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action="customer.session.revoked"});await db.SaveChangesAsync();}return Results.NoContent();});
        api.MapGet("/places", async (TaxiDb db, TenantContext tenant, CancellationToken cancellationToken) => {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            var saved = await OwnPlaces(db, customer.Id).Select(p => new { p.Id, p.Label, p.AddressText, p.Latitude, p.Longitude, p.Icon }).ToListAsync(cancellationToken);
            var recent = await RecentDestinations(db, customer.Id).Select(r => new { label = r.Destination, addressText = r.Destination, latitude = r.DestinationLatitude, longitude = r.DestinationLongitude }).ToListAsync(cancellationToken);
            return Results.Ok(new { savedPlaces = saved, recentDestinations = recent.DistinctBy(p => p.label.Trim().ToLowerInvariant()).Take(5), suggestedPlaces = await SuggestedPlaceEndpoints.Active(db).Select(p => new { p.Id, name = p.Name, label = p.Name, p.Area, p.Category, p.IsActive, addressText = p.AddressText == "" ? p.Name : p.Name + " ? " + p.AddressText, p.Latitude, p.Longitude }).ToListAsync(cancellationToken), suggestionsConfigured = true });
        });
        api.MapPost("/places", async (CustomerPlaceInput input, TaxiDb db, TenantContext tenant, ReceptionService reception) => {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            if (input.Id == Guid.Empty || string.IsNullOrWhiteSpace(input.Label) || input.Label.Length > 100 || input.Icon is not ("HOME" or "WORK" or "OTHER")) return Results.BadRequest(new { detail = "اختر اسمًا صالحًا للمكان" });
            Locations.Validate(new(input.AddressText, Latitude: input.Latitude, Longitude: input.Longitude, LocationSource: "SAVED_ADDRESS"));
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var existing = await db.Set<SavedAddress>().AsNoTracking().SingleOrDefaultAsync(p => p.Id == input.Id);
            if (existing is not null) return existing.CustomerId == customer.Id ? Results.Ok(new { existing.Id }) : Results.NotFound();
            var place = new SavedAddress { Id = input.Id, CustomerId = customer.Id, Label = input.Label.Trim(), AddressText = input.AddressText.Trim(), Latitude = input.Latitude, Longitude = input.Longitude, Icon = input.Icon };
            db.Add(place); db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = place.Id, Action = "saved-address.created" });
            await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(new { place.Id });
        });
        api.MapGet("/me", async (TaxiDb db, TenantContext tenant) => {
            var c=await Own(db,tenant);if(c is null)return Results.Forbid();
            var officeWhatsAppNumber=await db.Set<Office>().Select(o=>o.OfficeWhatsAppNumber).FirstOrDefaultAsync()??"";
            var phoneKey=CustomerOtp.VerifiedKey(tenant.TenantId,c.Phone);
            var phoneVerified=await db.Set<AuditLog>().AnyAsync(a=>a.ActorId==tenant.ActorId&&a.Action=="customer.phone.verified"&&a.Detail==phoneKey);
            return Results.Ok(new{c.Id,c.FullName,phone=CustomerPhone.Local(c.Phone),phoneVerified,officeWhatsAppNumber});
        });
        api.MapPost("/rides/{id:guid}/cancel", async (Guid id, TaxiDb db, TenantContext tenant, ReceptionService reception, AutoDispatch dispatch) =>
        {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id && db.Set<RideRequest>().Any(q => q.Id == r.RideRequestId && q.CustomerId == customer.Id));
            if (ride is null) return Results.NotFound();
            if (ride.Status is RideStatus.InProgress or RideStatus.Completed) return Results.Conflict(new { detail = "لا يمكن إلغاء الرحلة بعد بدئها" });
            if (ride.Status != RideStatus.Cancelled)
            {
                await dispatch.CloseOffer(ride, "CANCELLED");
                ride.Status = RideStatus.Cancelled;
                if (ride.DriverId is Guid driverId)
                {
                    var driver = await db.Set<Driver>().SingleAsync(d => d.Id == driverId);
                    if (driver.Status == DriverStatus.Busy) driver.Status = DriverStatus.Available;
                }
                await reception.SyncRide(ride); await db.SaveChangesAsync();
            }
            await tx.CommitAsync();
            return Results.Ok(new { ride.Id, rideStatus = "CANCELLED" });
        });
        api.MapGet("/rides/{id:guid}/events", async (Guid id, TaxiDb db, TenantContext tenant) =>
        {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            if (!await Query(db, customer.Id).AnyAsync(r => r.Ride.Id == id)) return Results.NotFound();
            return Results.Ok(await db.Set<AuditLog>().Where(a => a.EntityId == id && a.Action == "ride.state")
                .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id).Select(a => new { a.CreatedAt, a.Detail }).ToListAsync());
        });
        api.MapPost("/rides", async (CustomerRideInput input, TaxiDb db, TenantContext tenant, ReceptionService reception, AutoDispatch dispatch, DevelopmentTiming timing) =>
        {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            Locations.RequiredDestination(input.Destination);
            if (input.Id == Guid.Empty || input.Pickup is null || input.Notes?.Length > 2000) return Results.BadRequest();
            Locations.Validate(input.Pickup);
            if (input.DestinationLocation is not null) Locations.Validate(input.DestinationLocation);
            if (input.Pickup.LocationSource is not ("CUSTOMER_GPS" or "MANUAL_TEXT" or "MAP_PIN")) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var existing = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == input.Id);
            if (existing is not null)
            {
                if (!await db.Set<RideRequest>().AnyAsync(r => r.Id == existing.RideRequestId && r.CustomerId == customer.Id)) return Results.NotFound();
                return Results.Ok(new { existing.Id, status = State(existing.Status), rideStatus = RideWorkflow.CustomerState(existing) });
            }
            if (input.ScheduledAt is null && await db.Set<Ride>().AnyAsync(r => r.Status != RideStatus.Completed && r.Status != RideStatus.Cancelled && r.Status != RideStatus.NoDriverAvailable &&
                db.Set<RideRequest>().Any(q => q.Id == r.RideRequestId && q.CustomerId == customer.Id && q.ScheduledAt == null)))
                return Results.Conflict(new { detail = "لديك طلب رحلة جارٍ؛ تابعه أو ألغِه قبل طلب سيارة أخرى" });
            if (input.ScheduledAt.HasValue && (input.ScheduledAt <= DateTimeOffset.UtcNow || input.ScheduledAt > DateTimeOffset.UtcNow.AddDays(90))) return Results.BadRequest(new { detail = "اختر موعدًا خلال التسعين يومًا القادمة" });
            await NormalizeCustomer(db, tenant, customer);
            var request = new RideRequest { CustomerId = customer.Id, PassengerName = customer.FullName, PassengerPhone = CustomerPhone.Local(customer.Phone), Destination = input.Destination.Trim(), ScheduledAt = input.ScheduledAt?.ToUniversalTime(), Source = "CUSTOMER_APP" };
            request.DestinationLatitude = input.DestinationLocation?.Latitude; request.DestinationLongitude = input.DestinationLocation?.Longitude;
            Locations.Apply(request, input.Pickup); request.Notes = input.Notes?.Trim() ?? "";
            var ride = new Ride { Id = input.Id, RideRequestId = request.Id };
            db.AddRange(request, ride); await reception.ProjectRequest(request, ride);
            // Enrich this new order only. Existing reception handlers and workflow remain unchanged.
            var order = db.ChangeTracker.Entries<ReceptionOrder>().Single(e => e.Entity.RideRequestId == request.Id).Entity;
            var payload = JsonNode.Parse(order.Payload)!.AsObject();
            payload["dropoff"] = new JsonObject { ["name"] = request.Destination, ["coords"] = request.DestinationLatitude.HasValue && request.DestinationLongitude.HasValue ? new JsonObject { ["x"] = request.DestinationLatitude.Value, ["y"] = request.DestinationLongitude.Value } : null };
            if (request.ScheduledAt.HasValue) { payload["scheduledTime"] = JsonValue.Create(request.ScheduledAt.Value); payload["receptionPending"] = true; }
            order.Payload = payload.ToJsonString();
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "customer-app.requested" });
            await dispatch.Initialize(ride, request);
            timing.Mark("dispatch");
            await db.SaveChangesAsync(); await tx.CommitAsync();
            timing.Mark("committed");
            return Results.Ok(new { ride.Id, status = AutoDispatch.State(ride), rideStatus = RideWorkflow.CustomerState(ride) });
        });
        api.MapGet("/rides/{id:guid}", async (Guid id, TaxiDb db, TenantContext tenant, AutoDispatch dispatch, IArrivalEstimate eta) =>
        {
            var c = await Own(db, tenant); if (c is null) return Results.Forbid();
            var ride = await Query(db, c.Id).Where(r => r.Ride.Id == id).SingleOrDefaultAsync();
            return ride is null ? Results.NotFound() : Results.Ok(Present(ride, await dispatch.Policy(), eta));
        });
        api.MapGet("/history", async (int? page, TaxiDb db, TenantContext tenant, AutoDispatch dispatch, IArrivalEstimate eta) =>
        {
            var c = await Own(db, tenant); if (c is null) return Results.Forbid();
            var number = Math.Clamp(page ?? 1, 1, 10000);
            var query = Query(db, c.Id);
            var rows = await query.OrderByDescending(r => r.Request.CreatedAt).ThenBy(r => r.Ride.Id).Skip((number - 1) * 20).Take(20).ToListAsync();
            return Results.Ok(new { page = number, total = await query.CountAsync(), items = rows.Select(row => Present(row, new DispatchPolicy(), eta)) });
        });
        api.MapPost("/push-device", async (CustomerPushRegistration input, TaxiDb db, TenantContext tenant, IDataProtectionProvider protection, ICustomerPushSender sender, HttpContext http) =>
        {
            var own=await Own(db,tenant);if(own is null)return Results.Forbid();
            if(input.InstallationId==Guid.Empty||input.Token is null||input.Token.Length is < 20 or > 4096||input.Token.Any(char.IsWhiteSpace))return Results.BadRequest();
            await using var tx=await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId.ToString()+":customer-push"},0))");
            Guid? sessionId=Guid.TryParse(http.User.FindFirst("customer_session")?.Value,out var session)?session:null;
            if(!await CustomerPushStore.Register(db,tenant,protection,input,CustomerPushStore.Registration,sessionId))return Results.StatusCode(429);
            await tx.CommitAsync();return Results.NoContent();
        });
        api.MapPost("/push-device/remove", async (CustomerPushRegistration input, TaxiDb db, TenantContext tenant) =>
        {
            if(input.InstallationId==Guid.Empty)return Results.BadRequest();
            if(await Own(db,tenant) is null)return Results.Forbid();
            await using var tx=await db.Database.BeginTransactionAsync();
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId.ToString()+":customer-push"},0))");
            var id=CustomerPushStore.RegistrationId(tenant.TenantId,tenant.ActorId,input.InstallationId);
            if(await db.Set<AuditLog>().AnyAsync(a=>a.EntityId==id&&a.ActorId==tenant.ActorId&&a.Action==CustomerPushStore.Registration))db.Add(new AuditLog{ActorId=tenant.ActorId,EntityId=id,Action=CustomerPushStore.Registration,Detail=""});
            await db.SaveChangesAsync();await tx.CommitAsync();return Results.NoContent();
        });
        api.MapGet("/updates", async (string? cursor, TaxiDb db, TenantContext tenant, NotificationSignal signal, HttpContext http, AutoDispatch dispatch, IArrivalEstimate eta) =>
        {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
            while (true)
            {
                using var subscription = signal.Subscribe(tenant.TenantId);
                var changed = subscription.Changed;
                // Restore an active immediate ride even when newer scheduled/history rows fill the page.
                var rows = await Query(db, customer.Id).OrderBy(r => r.Request.ScheduledAt == null && r.Ride.Status != RideStatus.Completed && r.Ride.Status != RideStatus.Cancelled && r.Ride.Status != RideStatus.NoDriverAvailable ? 0 : 1).ThenByDescending(r => r.Request.CreatedAt).ThenBy(r => r.Ride.Id).Take(50).ToListAsync(http.RequestAborted);
                var policy = await dispatch.Policy();
                var data = rows.Select(row => Present(row, policy, eta)).ToArray();
                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(data))));
                if (cursor != hash || DateTimeOffset.UtcNow >= deadline) return Results.Ok(new { cursor = hash, rides = data });
                try { await changed.WaitAsync(TimeSpan.FromMilliseconds(Math.Max(1, (deadline - DateTimeOffset.UtcNow).TotalMilliseconds)), http.RequestAborted); } catch (TimeoutException) { }
            }
        });
    }
    private sealed class CustomerRideRow
    {
        public Ride Ride { get; set; } = null!;
        public RideRequest Request { get; set; } = null!;
        public Driver? Driver { get; set; }
        public Vehicle? Vehicle { get; set; }
        public DriverLocation? Location { get; set; }
        public Guid? ArrivalEventId { get; set; }
        public bool ArrivalAcknowledged { get; set; }
    }
    private static IQueryable<CustomerRideRow> Query(TaxiDb db, Guid customer) =>
        from r in OwnRides(db, customer) join q in db.Set<RideRequest>() on r.RideRequestId equals q.Id
        join d in db.Set<Driver>() on r.DriverId equals d.Id into drivers from d in drivers.DefaultIfEmpty()
        // Preserve legacy fleets linked through Vehicle.DriverId, but never guess
        // a vehicle when multiple active cars exist and no current car was chosen.
        from v in db.Set<Vehicle>().Where(v => v.Id == d.CurrentVehicleId ||
            d.CurrentVehicleId == null && !db.Set<DriverVehicleAssignment>().Any(a=>a.DriverId==d.Id) && v.DriverId == d.Id && v.Active && v.Status == "ACTIVE" &&
            db.Set<Vehicle>().Count(candidate => candidate.DriverId == d.Id && candidate.Active && candidate.Status == "ACTIVE") == 1).DefaultIfEmpty()
        join l in db.Set<DriverLocation>() on r.DriverId equals l.DriverId into locations from l in locations.DefaultIfEmpty()
        where q.CustomerId == customer select new CustomerRideRow { Ride = r, Request = q, Driver = d, Vehicle = v, Location = l,
            ArrivalEventId = db.Set<AuditLog>().Where(a => a.EntityId == r.Id && a.Action == "ride.notification.Arrived").OrderByDescending(a => a.CreatedAt).ThenByDescending(a => a.Id).Select(a => (Guid?)a.Id).FirstOrDefault(),
            ArrivalAcknowledged=db.Set<AuditLog>().Any(a=>a.EntityId==customer&&a.Action=="customer.arrival.ack"&&a.Detail==db.Set<AuditLog>().Where(e=>e.EntityId==r.Id&&e.Action=="ride.notification.Arrived").OrderByDescending(e=>e.CreatedAt).ThenByDescending(e=>e.Id).Select(e=>e.Id.ToString()).FirstOrDefault()) };
    private static object Present(CustomerRideRow row, DispatchPolicy policy, IArrivalEstimate eta)
    {
        var visible = row.Ride.Status is RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress or RideStatus.Completed;
        return new { row.Ride.Id, row.Ride.FinalFare, row.Ride.MeterCalculatedFare, row.Ride.FareSource, row.Ride.Currency, row.Ride.FareMode, rideStatus = RideWorkflow.CustomerState(row.Ride), workflowStatus = RideWorkflow.State(row.Ride.Status), status = row.Ride.DispatchMode == "MANUAL" ? State(row.Ride.Status) : AutoDispatch.State(row.Ride), row.Request.Pickup, row.Request.Destination, row.Request.ScheduledAt, row.Request.CreatedAt,
            arrivalEventId = row.Ride.Status == RideStatus.Arrived ? row.ArrivalEventId : null,
            arrivalAcknowledged=row.ArrivalAcknowledged,
            pickupLocation = new { row.Request.Latitude, row.Request.Longitude }, destinationLocation = new { latitude = row.Request.DestinationLatitude, longitude = row.Request.DestinationLongitude },
            driver = visible && row.Driver is not null ? new { row.Driver.FullName, phone = policy.ShowDriverPhone ? row.Driver.Phone : null, whatsAppNumber = policy.ShowDriverPhone ? DriverContact.WhatsAppRecipient(row.Driver) : null } : null,
            // The shared ETA assumes a fixed speed; it is not a measured arrival estimate.
            // Customer tracking exposes real, fresh observations only.
            tracking = visible && row.Ride.Status != RideStatus.Completed && row.Location is not null && row.Location.UpdatedAt >= DateTimeOffset.UtcNow.AddSeconds(-policy.LocationMaxAgeSeconds)
                ? new { latitude = row.Location.Position.Y, longitude = row.Location.Position.X, row.Location.Accuracy, row.Location.UpdatedAt } : null,
            vehicle = visible && row.Vehicle is not null ? new { row.Vehicle.Plate, row.Vehicle.Make, row.Vehicle.Model, row.Vehicle.Color } : null };
    }
}
