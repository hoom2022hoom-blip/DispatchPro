using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record LoginInput(string Tenant, string Username, string Password);
public sealed record UserInput(string Username, string Password, Guid RoleId);
public sealed record RequestInput(Guid? CustomerId, string? Pickup, string? Destination, string? Notes, string Source, DateTimeOffset? ScheduledAt, LocationInput? Location = null, Guid? SavedAddressId = null);
public sealed record StatusInput(RideStatus Status, long Version);
public sealed record AssignmentInput(Guid DriverId, long Version);
public sealed record QuoteInput(Guid PricingRuleId, MeterInput Meter, Guid? FixedRouteId, Guid? VehicleClassId, Guid? ZoneId, Guid[]? ServiceIds);
public sealed record AdjustmentInput(decimal FinalPrice, string Reason, long Version);
public sealed record OtpInput(string Phone);

public static class TaxiEndpoints
{
    public static void MapTaxiEndpoints(this WebApplication app)
    {
        app.MapPost("/api/v1/auth/login", async (LoginInput input, TaxiDb db, TenantContext context, TokenService tokens) =>
        {
            if (string.IsNullOrWhiteSpace(input.Password) || input.Password.Length > 512) return Results.Unauthorized();
            var tenant = await db.Set<Tenant>().SingleOrDefaultAsync(t => t.Slug == input.Tenant);
            if (tenant is null) return Results.Unauthorized();
            context.TenantId = tenant.Id;
            var user = await db.Set<User>().SingleOrDefaultAsync(u => u.Username == input.Username && u.Active);
            if (user is null || new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, input.Password) == PasswordVerificationResult.Failed) return Results.Unauthorized();
            return Results.Ok(new { accessToken = tokens.Issue(user), expiresIn = 1800 });
        }).RequireRateLimiting("auth");

        var api = app.MapGroup("/api/v1").RequireAuthorization();
        api.MapGet("/me", (TenantContext context) => new { context.TenantId, context.ActorId });
        api.MapGet("/tenant", async (TaxiDb db, TenantContext context) => await db.Set<Tenant>().SingleAsync(t => t.Id == context.TenantId));
        api.MapPost("/otp/request", async (OtpInput input, IOtpProvider provider, TenantContext context, CancellationToken cancellation) =>
        {
            await provider.RequestAsync(context.TenantId, PalestinianPhone.Normalize(input.Phone), cancellation); return Results.Accepted();
        }).RequireAuthorization("customers.write").RequireRateLimiting("auth");
        api.MapGet("/users", async (TaxiDb db) => await db.Set<User>().Select(u => new { u.Id, u.Username, u.RoleId, u.Active }).Take(200).ToListAsync()).RequireAuthorization("users.write");
        api.MapPost("/users", async (UserInput input, TaxiDb db, TenantContext context) =>
        {
            Required(input.Username, 100); Required(input.Password, 512);
            if (input.Password.Length < 14 || !await db.Set<Role>().AnyAsync(r => r.Id == input.RoleId)) return Results.BadRequest();
            var user = new User { Username = input.Username.Trim(), RoleId = input.RoleId };
            user.PasswordHash = new PasswordHasher<User>().HashPassword(user, input.Password);
            db.Add(user); Audit(db, context, "user.created", user.Id); await db.SaveChangesAsync();
            return Results.Created($"/api/v1/users/{user.Id}", new { user.Id, user.Username, user.RoleId });
        }).RequireAuthorization("users.write");
        MapCatalog<Role>(api, "roles", "users.write", x => Required(x.Name, 100));
        MapCatalog<Permission>(api, "permissions", "users.write", x => { if (!Permissions.All.Contains(x.Code)) throw new ArgumentException("Unknown permission"); });
        api.MapGet("/features", async (TaxiDb db) => await db.Set<FeatureFlag>().ToListAsync());
        api.MapPut("/features/{key}", async (string key, bool enabled, TaxiDb db, TenantContext context) =>
        {
            var flag = await db.Set<FeatureFlag>().SingleOrDefaultAsync(f => f.Key == key);
            if (flag is null) return Results.NotFound();
            flag.Enabled = enabled; Audit(db, context, "feature.changed", flag.Id, $"{key}={enabled}"); await db.SaveChangesAsync(); return Results.Ok(flag);
        }).RequireAuthorization("settings.write");
        api.MapGet("/audit", async (TaxiDb db) => await db.Set<AuditLog>().AsNoTracking().OrderByDescending(a => a.CreatedAt).Take(200).ToListAsync()).RequireAuthorization("audit.read");
        MapCatalog<Office>(api, "offices", "settings.write", x => { Required(x.Name, 150); ValidateTimeZone(x.TimeZone); });
        MapCatalog<Driver>(api, "drivers", "users.write", x => { Required(x.FullName, 150); if (!Enum.IsDefined(x.Status)) throw new ArgumentException("Invalid status"); });
        MapCatalog<Vehicle>(api, "vehicles", "users.write", x => Required(x.Plate, 30));
        MapCatalog<VehicleClass>(api, "vehicle-classes", "pricing.write", x => { Required(x.Name, 100); if (x.Multiplier is <= 0 or > 100) throw new ArgumentException("Invalid multiplier"); });
        MapCatalog<PricingProfile>(api, "pricing/profiles", "pricing.write", x => { Required(x.Name, 150); Required(x.Currency, 3); if (x.Currency.Length != 3 || !x.Currency.All(c => c is >= 'A' and <= 'Z')) throw new ArgumentException("Currency must be a three-letter uppercase code"); ValidateTimeZone(x.TimeZone); });
        MapCatalog<PricingRule>(api, "pricing/rules", "pricing.write", PricingEngine.Validate);
        MapCatalog<FixedRoutePrice>(api, "pricing/routes", "pricing.write", x => { Required(x.Origin, 200); Required(x.Destination, 200); Nonnegative(x.Outbound, x.Return); });
        MapCatalog<ZonePrice>(api, "pricing/zones", "pricing.write", x => { Required(x.Name, 100); Nonnegative(x.AdditionalFare); if (x.Boundary is not null && (x.Boundary.SRID != 4326 || !x.Boundary.IsValid || x.Boundary is not (NetTopologySuite.Geometries.Polygon or NetTopologySuite.Geometries.MultiPolygon) || x.Boundary.EnvelopeInternal.MinX < -180 || x.Boundary.EnvelopeInternal.MaxX > 180 || x.Boundary.EnvelopeInternal.MinY < -90 || x.Boundary.EnvelopeInternal.MaxY > 90)) throw new ArgumentException("Valid EPSG:4326 polygon required"); });
        MapCatalog<ServiceSurcharge>(api, "pricing/services", "pricing.write", x => { Required(x.Name, 100); Nonnegative(x.Amount); });
        api.MapPost("/pricing/quote", async (QuoteInput input, TaxiDb db) => Results.Ok(await Quote(db, input))).RequireAuthorization("pricing.read");
        MapRides(api);
    }

    private static void MapCatalog<T>(RouteGroupBuilder api, string path, string permission, Action<T> validate) where T : TenantEntity
    {
        api.MapGet($"/{path}", async (TaxiDb db) => await db.Set<T>().AsNoTracking().Take(200).ToListAsync()).RequireAuthorization(permission);
        api.MapPost($"/{path}", async (T input, TaxiDb db, TenantContext context) =>
        {
            validate(input); input.Id = Guid.NewGuid(); input.TenantId = context.TenantId;
            db.Add(input); Audit(db, context, $"{path}.created", input.Id); await db.SaveChangesAsync(); return Results.Created($"/api/v1/{path}/{input.Id}", input);
        }).RequireAuthorization(permission);
        api.MapPut($"/{path}/{{id:guid}}", async (Guid id, T input, TaxiDb db, TenantContext context) =>
        {
            var current = await db.Set<T>().SingleOrDefaultAsync(x => x.Id == id);
            if (current is null) return Results.NotFound();
            validate(input); input.Id = id; input.TenantId = context.TenantId;
            db.Entry(current).CurrentValues.SetValues(input); Audit(db, context, $"{path}.updated", id); await db.SaveChangesAsync(); return Results.Ok(current);
        }).RequireAuthorization(permission);
    }
    private static void MapRides(RouteGroupBuilder api)
    {
        api.MapGet("/ride-requests", async (TaxiDb db) => await db.Set<RideRequest>().AsNoTracking().OrderByDescending(r => r.CreatedAt).Take(200).ToListAsync()).RequireAuthorization("rides.read");
        api.MapGet("/rides/{id:guid}", async (Guid id, TaxiDb db) =>
        {
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            if (ride is null) return Results.NotFound();
            var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == ride.RideRequestId);
            var customer = await db.Set<Customer>().Where(c=>c.Id==request.CustomerId).Select(c=>new {c.Id,c.FullName,c.Phone}).SingleOrDefaultAsync();
            return Results.Ok(new { ride, request, customer });
        }).RequireAuthorization("rides.read");
        api.MapPost("/ride-requests", async (RequestInput input, TaxiDb db, TenantContext context, ReceptionService reception) =>
        {
            var source = Locations.OrderSource(input.Source);
            if (source is not ("MANUAL" or "CUSTOMER_APP" or "WHATSAPP" or "LANDLINE")) return Results.BadRequest();
            if ((source == "WHATSAPP" && !await Enabled(db, "WhatsApp")) || (source == "LANDLINE" && !await Enabled(db, "CallerId"))) return Results.BadRequest(new { error = "Source feature disabled" });
            if (input.Notes?.Length > 2000) return Results.BadRequest();
            if (input.CustomerId.HasValue && !await db.Set<Customer>().AnyAsync(c => c.Id == input.CustomerId)) return Results.NotFound();
            if (input.ScheduledAt.HasValue && (input.ScheduledAt <= DateTimeOffset.UtcNow || !await Enabled(db, "ScheduledBooking"))) return Results.BadRequest(new { error = "Scheduled booking unavailable or date is in the past" });
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var request = new RideRequest { CustomerId = input.CustomerId, Destination = input.Destination ?? "", Notes = input.Notes ?? "", Source = source, ScheduledAt = input.ScheduledAt?.ToUniversalTime() };
            var location = input.Location ?? new LocationInput(input.Pickup ?? "", Notes: input.Notes);
            if (input.SavedAddressId.HasValue) {
                var saved = await db.Set<SavedAddress>().SingleOrDefaultAsync(a => a.Id == input.SavedAddressId);
                if (saved is null || (input.CustomerId.HasValue && saved.CustomerId != input.CustomerId)) return Results.NotFound();
                request.CustomerId = saved.CustomerId; request.SavedAddressId = saved.Id; location = Locations.From(saved);
            }
            Locations.Validate(location, allowEmpty: true); Locations.Apply(request, location);
            var ride = new Ride { RideRequestId = request.Id };
            db.AddRange(request, ride); await reception.ProjectRequest(request, ride); Audit(db, context, "ride.created", ride.Id); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Created($"/api/v1/rides/{ride.Id}", ride);
        }).RequireAuthorization("rides.write");
        api.MapGet("/rides", async (TaxiDb db) => await db.Set<Ride>().AsNoTracking().Take(200).ToListAsync()).RequireAuthorization("rides.read");
        api.MapPut("/rides/{id:guid}/assignment", async (Guid id, AssignmentInput input, TaxiDb db, TenantContext context, ReceptionService reception, AutoDispatch dispatch) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            var driver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.Id == input.DriverId);
            if (ride is null || driver is null) return Results.NotFound();
            if (ride.Version != input.Version || ride.Status is not (RideStatus.Pending or RideStatus.Assigned or RideStatus.Rejected) || !driver.Active || driver.Status != DriverStatus.Available) return Results.Conflict();
            if (await reception.HasActiveOrder(driver.Id, exceptRequest: ride.RideRequestId)) return Results.Conflict();
            await dispatch.CloseOffer(ride, "OFFICE_OVERRIDE"); ride.DispatchMode = "MANUAL";
            ride.DriverId = driver.Id; ride.Status = RideStatus.Assigned; await reception.SyncRide(ride); Audit(db, context, "ride.assigned", ride.Id); await db.SaveChangesAsync(); await transaction.CommitAsync(); return Results.Ok(ride);
        }).RequireAuthorization("rides.write");
        api.MapGet("/driver/rides/{id:guid}", async (Guid id, TaxiDb db, TenantContext context) =>
        {
            var driver = await DriverEndpoints.CurrentDriver(db, context);
            if (driver is null) return Results.Forbid();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id && driver != null && r.DriverId == driver.Id);
            if (ride is null) return Results.NotFound();
            var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == ride.RideRequestId);
            if (ride.Status is RideStatus.Pending or RideStatus.Assigned or RideStatus.Cancelled) return Results.Ok(new { ride.Id, ride.Status, ride.Version, request.Pickup, request.Destination });
            var customer = await db.Set<Customer>().Where(c=>c.Id==request.CustomerId).Select(c=>new {c.FullName,c.Phone}).SingleOrDefaultAsync();
            var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
            bool show = price is not null && await (from rule in db.Set<PricingRule>() join profile in db.Set<PricingProfile>() on rule.PricingProfileId equals profile.Id where rule.Id == price.PricingRuleId select profile.ShowEstimate).SingleAsync();
            return Results.Ok(new { ride.Id, ride.Status, ride.Version, request.Pickup, request.Destination, request.Notes, FullName = customer?.FullName ?? request.PassengerName, Phone = customer?.Phone ?? request.PassengerPhone, request.AddressText, request.Neighborhood, request.Street, request.Latitude, request.Longitude, request.DestinationLatitude, request.DestinationLongitude, request.LocationSource, EstimatedPrice = show ? price?.EstimatedPrice : null });
        }).RequireAuthorization("rides.drive");
        api.MapPut("/rides/{id:guid}/status", async (Guid id, StatusInput input, TaxiDb db, TenantContext context, HttpContext http, ReceptionService reception, AutoDispatch dispatch) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            if (ride is null) return Results.NotFound();
            var office = http.User.HasClaim("permission", "rides.write");
            if (!office && !await db.Set<Driver>().AnyAsync(d => d.Id == ride.DriverId && d.UserId == context.ActorId && d.Active && d.Status != DriverStatus.Suspended)) return Results.NotFound();
            if (!office && input.Status == RideStatus.Cancelled) return Results.Forbid();
            if (ride.Version != input.Version || !CanTransition(ride.Status, input.Status)) return Results.Conflict();
            if (input.Status == RideStatus.Completed)
            {
                var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
                var order = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(r => r.RideRequestId == ride.RideRequestId);
                // Office orders already carry the recorded fare; preserve the existing pricing flow.
                var officeFare = order is null ? null : System.Text.Json.Nodes.JsonNode.Parse(order.Payload)?["totalFare"]?.GetValue<decimal?>();
                if (price is not null ? price.FinalPrice is null : officeFare is null or < 0) return Results.Conflict(new { error = "Final price required from office" });
            }
            if (ride.Status == RideStatus.Assigned && input.Status == RideStatus.Accepted && ride.OfferExpiresAt <= DateTimeOffset.UtcNow) return Results.Conflict(new { error = "Offer expired" });
            if (ride.Status == RideStatus.Assigned && input.Status == RideStatus.Accepted && ride.DispatchMode != "MANUAL" && !await dispatch.CanReceive(ride)) return Results.Conflict(new { error = "Driver is no longer available for this offer" });
            await dispatch.CloseOffer(ride, input.Status == RideStatus.Accepted ? "ACCEPTED" : "CLOSED");
            ride.Status = input.Status;
            if (ride.DriverId is Guid driverId)
            {
                var driver = await db.Set<Driver>().SingleAsync(d => d.Id == driverId);
                if (input.Status is RideStatus.Completed or RideStatus.Cancelled)
                {
                    if (driver.Status == DriverStatus.Busy) driver.Status = DriverStatus.Available;
                }
                else driver.Status = DriverStatus.Busy;
            }
            await reception.SyncRide(ride); Audit(db, context, "ride.status", ride.Id, input.Status.ToString()); await db.SaveChangesAsync(); await tx.CommitAsync(); return Results.Ok(ride);
        }).RequireAuthorization(p => p.RequireAssertion(c => c.User.HasClaim("permission", "rides.write") || c.User.HasClaim("permission", "rides.drive")));
        api.MapPost("/rides/{id:guid}/price", async (Guid id, QuoteInput input, TaxiDb db, TenantContext context) =>
        {
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            if (ride is null) return Results.NotFound();
            if (ride.Status is RideStatus.Completed or RideStatus.Cancelled) return Results.Conflict();
            var quote = await Quote(db, input);
            var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
            if (price is null) { price = new RidePrice { RideId = id, PricingRuleId = quote.RuleId, PricingMode = quote.Mode, Currency = quote.Currency, EstimatedPrice = quote.Amount }; db.Add(price); }
            if (price.PricingRuleId != quote.RuleId || price.AdjustedBy.HasValue) return Results.Conflict(new { error = "Existing price rule or manual adjustment must be preserved" });
            price.CalculatedPrice = quote.Amount; price.FinalPrice = quote.Amount;
            Audit(db, context, "price.calculated", price.Id); await db.SaveChangesAsync(); return Results.Ok(price);
        }).RequireAuthorization("pricing.write");
        api.MapGet("/rides/{id:guid}/price", async (Guid id, TaxiDb db) => await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id) is { } p ? Results.Ok(p) : Results.NotFound()).RequireAuthorization("pricing.read");
        api.MapPut("/rides/{id:guid}/price/adjustment", async (Guid id, AdjustmentInput input, TaxiDb db, TenantContext context) =>
        {
            Required(input.Reason, 1000); Nonnegative(input.FinalPrice);
            var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
            if (price is null) return Results.NotFound();
            var ownDriver = await db.Set<Driver>().SingleOrDefaultAsync(d => d.UserId == context.ActorId);
            if (ownDriver is not null && !await db.Set<Ride>().AnyAsync(r => r.Id == id && r.DriverId == ownDriver.Id && (r.Status >= RideStatus.Accepted && r.Status <= RideStatus.Completed || r.Status == RideStatus.DriverArriving))) return Results.NotFound();
            if (price.Version != input.Version) return Results.Conflict();
            if (price.PricingMode is not (PricingMode.Manual or PricingMode.Hybrid) || !await Enabled(db, "ManualPricing")) return Results.BadRequest();
            db.Add(new PriceAdjustment { RidePriceId = price.Id, PreviousPrice = price.FinalPrice, FinalPrice = input.FinalPrice, Reason = input.Reason.Trim(), AdjustedBy = context.ActorId });
            price.FinalPrice = input.FinalPrice; price.ManualAdjustment = input.FinalPrice - (price.CalculatedPrice ?? 0); price.AdjustmentReason = input.Reason.Trim(); price.AdjustedBy = context.ActorId;
            Audit(db, context, "price.adjusted", price.Id, input.Reason.Trim()); await db.SaveChangesAsync(); return Results.Ok(price);
        }).RequireAuthorization("pricing.adjust");
    }

    public static bool CanTransition(RideStatus current, RideStatus next) => (current, next) switch
    {
        (RideStatus.Assigned, RideStatus.Accepted) or (RideStatus.Accepted, RideStatus.Arrived) or (RideStatus.Accepted, RideStatus.DriverArriving) or (RideStatus.DriverArriving, RideStatus.Arrived) or (RideStatus.Arrived, RideStatus.InProgress) or (RideStatus.InProgress, RideStatus.Completed) => true,
        (_, RideStatus.Cancelled) when current is not (RideStatus.Completed or RideStatus.Cancelled) => true,
        _ => false
    };
    public sealed record QuoteResult(Guid RuleId, PricingMode Mode, string Currency, decimal? Amount);
    private static async Task<QuoteResult> Quote(TaxiDb db, QuoteInput input)
    {
        if (input.Meter is null) throw new ArgumentException("Meter input required");
        var rule = await db.Set<PricingRule>().SingleOrDefaultAsync(r => r.Id == input.PricingRuleId) ?? throw new ArgumentException("Unknown pricing rule");
        string feature = rule.Mode switch { PricingMode.Manual => "ManualPricing", PricingMode.FixedRoute => "FixedRoutePricing", _ => "GpsMeter" };
        if (!await Enabled(db, feature)) throw new ArgumentException("Pricing mode disabled");
        var profile = await db.Set<PricingProfile>().SingleAsync(p => p.Id == rule.PricingProfileId);
        var route = input.FixedRouteId.HasValue ? await db.Set<FixedRoutePrice>().SingleOrDefaultAsync(r => r.Id == input.FixedRouteId && r.PricingRuleId == rule.Id) ?? throw new ArgumentException("Unknown route") : null;
        var vehicle = input.VehicleClassId.HasValue ? await db.Set<VehicleClass>().SingleOrDefaultAsync(v => v.Id == input.VehicleClassId) ?? throw new ArgumentException("Unknown class") : null;
        var zone = input.ZoneId.HasValue ? await db.Set<ZonePrice>().SingleOrDefaultAsync(z => z.Id == input.ZoneId && z.PricingRuleId == rule.Id) ?? throw new ArgumentException("Unknown zone") : null;
        var ids = input.ServiceIds?.Distinct().ToArray() ?? [];
        if (ids.Length > 100) throw new ArgumentException("Too many services");
        var services = await db.Set<ServiceSurcharge>().Where(s => ids.Contains(s.Id)).ToListAsync();
        if (services.Count != ids.Length) throw new ArgumentException("Unknown service");
        if ((vehicle is not null && !await Enabled(db, "VehicleClasses")) || (zone is not null && !await Enabled(db, "ZonePricing")) || (services.Count > 0 && !await Enabled(db, "SpecialServices"))) throw new ArgumentException("Pricing feature disabled");
        return new(rule.Id, rule.Mode, profile.Currency, PricingEngine.Calculate(rule, profile, input.Meter, route, vehicle, zone, services));
    }
    private static Task<bool> Enabled(TaxiDb db, string key) => db.Set<FeatureFlag>().AnyAsync(f => f.Key == key && f.Enabled);
    private static void Audit(TaxiDb db, TenantContext context, string action, Guid id, string detail = "") => db.Add(new AuditLog { ActorId = context.ActorId, Action = action, EntityId = id, Detail = detail });
    private static void Required(string? value, int max) { if (string.IsNullOrWhiteSpace(value) || value.Length > max) throw new ArgumentException($"Text required, maximum {max} characters"); }
    private static void Nonnegative(params decimal[] values) { if (values.Any(v => v is < 0 or > 10000000)) throw new ArgumentException("Amount out of range"); }
    private static void ValidateTimeZone(string zone) { Required(zone, 100); try { TimeZoneInfo.FindSystemTimeZoneById(zone); } catch (TimeZoneNotFoundException) { throw new ArgumentException("Unknown time zone"); } }
}
