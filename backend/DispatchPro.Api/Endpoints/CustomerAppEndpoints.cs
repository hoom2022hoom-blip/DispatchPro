using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record CustomerRegistration(string Tenant, Guid AccountId, string DeviceSecret, string FullName, string Phone);
public sealed record CustomerRideInput(Guid Id, LocationInput Pickup, string Destination, string? Notes = null, DateTimeOffset? ScheduledAt = null, LocationInput? DestinationLocation = null);

// Device-bound MVP accounts reuse User, PasswordHasher and TokenService unchanged.
// Existing shared-ID accounts remain valid. Device-link audit records bind additional test devices.
public static class CustomerAppEndpoints
{
    private const string RoleName = "CustomerApp";
    private static IQueryable<Customer> Profiles(TaxiDb db) => db.Set<Customer>().FromSqlRaw("SELECT c.\"Id\",c.\"TenantId\",c.\"FullName\",c.\"Phone\",''::text AS \"SecondaryPhone\",''::text AS \"Notes\",COALESCE((to_jsonb(c)->>'IsActive')::boolean,true) AS \"IsActive\",now() AS \"CreatedAt\" FROM \"Customer\" c");
    private static async Task<Customer?> Own(TaxiDb db, TenantContext tenant)
    {
        var username = "customer-" + tenant.ActorId.ToString("N");
        if (!await (from u in db.Set<User>() join role in db.Set<Role>() on u.RoleId equals role.Id where u.Id == tenant.ActorId && u.Active && u.Username == username && role.Name == RoleName select u.Id).AnyAsync()) return null;
        var linked = await db.Set<AuditLog>().Where(a => a.ActorId == tenant.ActorId && a.Action == "customer-app.device-linked").Select(a => (Guid?)a.EntityId).SingleOrDefaultAsync();
        var customerId = linked ?? tenant.ActorId;
        return await Profiles(db).AsNoTracking().SingleOrDefaultAsync(c => c.Id == customerId && c.IsActive);
    }
    private static object Profile(Customer c) => new { c.Id, c.FullName, phone = CustomerPhone.Local(c.Phone), phoneVerified = false };
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
        app.MapPost("/api/v1/customer-app/register", async (CustomerRegistration input, TaxiDb db, TenantContext tenant, TokenService tokens, ReceptionService reception, IConfiguration config) =>
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
            if (existing is not null)
            {
                if (!existing.Active || existing.Username != username || new PasswordHasher<User>().VerifyHashedPassword(existing, existing.PasswordHash, input.DeviceSecret) == PasswordVerificationResult.Failed) return Results.Conflict();
                tenant.ActorId = existing.Id; var own = await Own(db, tenant);
                if (own is null) return Results.Forbid();
                if (CustomerPhone.Local(own.Phone) != phone) return Results.Conflict();
                await NormalizeCustomer(db, tenant, own); await db.SaveChangesAsync(); await tx.CommitAsync();
                return Results.Ok(new { accessToken = tokens.Issue(existing), profile = Profile(own) });
            }
            var matches = await Profiles(db).AsNoTracking().Where(c => variants.Contains(c.Phone)).ToListAsync();
            if (matches.Count > 1) return Results.Conflict(new { detail = "يوجد أكثر من سجل لهذا الرقم؛ يلزم مراجعة الربط" });
            var customer = matches.SingleOrDefault();
            // Explicit tenant-scoped test override. Production remains denied until OTP verification is implemented.
            var testRecovery = config.GetValue<bool>("CustomerApp:TestPhoneRecoveryEnabled") && config["CustomerApp:TestPhoneRecoveryTenant"] == office.Slug;
            if (customer is not null && !testRecovery) return Results.Conflict(new { detail = "استعادة الحساب تتطلب التحقق من الرقم؛ وضع الاختبار غير مفعّل لهذا المكتب." });
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
            await db.SaveChangesAsync(); await tx.CommitAsync();
            return Results.Ok(new { accessToken = tokens.Issue(user), profile = Profile(customer), testPhoneRecovery = testRecovery });
        }).RequireRateLimiting("auth");

        var api = app.MapGroup("/api/v1/customer-app").RequireAuthorization();
        api.MapGet("/me", async (TaxiDb db, TenantContext tenant) => await Own(db, tenant) is { } c ? Results.Ok(Profile(c)) : Results.Forbid());
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
        api.MapPost("/rides", async (CustomerRideInput input, TaxiDb db, TenantContext tenant, ReceptionService reception, AutoDispatch dispatch) =>
        {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            if (input.Id == Guid.Empty || input.Pickup is null || string.IsNullOrWhiteSpace(input.Destination) || input.Destination.Length > 500 || input.Notes?.Length > 2000) return Results.BadRequest();
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
            payload["dropoff"] = new JsonObject { ["name"] = request.Destination, ["coords"] = new JsonObject { ["x"] = request.DestinationLatitude ?? 0, ["y"] = request.DestinationLongitude ?? 0 } };
            if (request.ScheduledAt.HasValue) { payload["scheduledTime"] = JsonValue.Create(request.ScheduledAt.Value); payload["receptionPending"] = true; }
            order.Payload = payload.ToJsonString();
            db.Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "customer-app.requested" });
            await dispatch.Initialize(ride, request);
            await db.SaveChangesAsync(); await tx.CommitAsync();
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
            var query = Query(db, c.Id).Where(r => r.Ride.Status == RideStatus.Completed || r.Ride.Status == RideStatus.Cancelled || r.Ride.Status == RideStatus.NoDriverAvailable);
            var rows = await query.OrderByDescending(r => r.Request.CreatedAt).ThenBy(r => r.Ride.Id).Skip((number - 1) * 20).Take(20).ToListAsync();
            return Results.Ok(new { page = number, total = await query.CountAsync(), items = rows.Select(row => Present(row, new DispatchPolicy(), eta)) });
        });
        api.MapGet("/updates", async (string? cursor, TaxiDb db, TenantContext tenant, NotificationSignal signal, HttpContext http, AutoDispatch dispatch, IArrivalEstimate eta) =>
        {
            var customer = await Own(db, tenant); if (customer is null) return Results.Forbid();
            var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
            while (true)
            {
                var changed = signal.Changed;
                var rows = await Query(db, customer.Id).OrderByDescending(r => r.Request.CreatedAt).ThenBy(r => r.Ride.Id).Take(50).ToListAsync(http.RequestAborted);
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
    }
    private static IQueryable<CustomerRideRow> Query(TaxiDb db, Guid customer) =>
        from r in db.Set<Ride>().AsNoTracking() join q in db.Set<RideRequest>() on r.RideRequestId equals q.Id
        join d in db.Set<Driver>() on r.DriverId equals d.Id into drivers from d in drivers.DefaultIfEmpty()
        // Preserve legacy fleets linked through Vehicle.DriverId, but never guess
        // a vehicle when multiple active cars exist and no current car was chosen.
        from v in db.Set<Vehicle>().Where(v => v.Id == d.CurrentVehicleId ||
            d.CurrentVehicleId == null && v.DriverId == d.Id && v.Active && v.Status == "ACTIVE" &&
            db.Set<Vehicle>().Count(candidate => candidate.DriverId == d.Id && candidate.Active && candidate.Status == "ACTIVE") == 1).DefaultIfEmpty()
        join l in db.Set<DriverLocation>() on r.DriverId equals l.DriverId into locations from l in locations.DefaultIfEmpty()
        where q.CustomerId == customer select new CustomerRideRow { Ride = r, Request = q, Driver = d, Vehicle = v, Location = l };
    private static object Present(CustomerRideRow row, DispatchPolicy policy, IArrivalEstimate eta)
    {
        var visible = (row.Ride.Status >= RideStatus.Accepted && row.Ride.Status <= RideStatus.Completed || row.Ride.Status == RideStatus.DriverArriving);
        return new { row.Ride.Id, rideStatus = RideWorkflow.CustomerState(row.Ride), workflowStatus = RideWorkflow.State(row.Ride.Status), status = row.Ride.DispatchMode == "MANUAL" ? State(row.Ride.Status) : AutoDispatch.State(row.Ride), row.Request.Pickup, row.Request.Destination, row.Request.ScheduledAt, row.Request.CreatedAt,
            pickupLocation = new { row.Request.Latitude, row.Request.Longitude }, destinationLocation = new { latitude = row.Request.DestinationLatitude, longitude = row.Request.DestinationLongitude },
            driver = visible && row.Driver is not null ? new { row.Driver.FullName, phone = policy.ShowDriverPhone ? row.Driver.Phone : null } : null,
            tracking = visible && row.Ride.Status != RideStatus.Completed ? DispatchEndpoints.Tracking(row.Location, row.Request, policy, eta) : null,
            vehicle = visible && row.Vehicle is not null ? new { row.Vehicle.Plate, row.Vehicle.Make, row.Vehicle.Model, row.Vehicle.Color } : null };
    }
}
