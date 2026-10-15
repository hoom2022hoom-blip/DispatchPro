using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed record LoginInput(string Tenant, string Username, string Password, string? DeviceId = null);
public sealed record RefreshInput(string RefreshToken);
public sealed record UserInput(string Username, string Password, Guid RoleId);
public sealed record RequestInput(Guid? CustomerId, string? Pickup, string? Destination, string? Notes, string Source, DateTimeOffset? ScheduledAt, LocationInput? Location = null, Guid? SavedAddressId = null);
public sealed record StatusInput(RideStatus Status, long Version, decimal? CollectedFare = null);
public sealed record AssignmentInput(Guid DriverId, long Version);
public sealed record QuoteInput(Guid PricingRuleId, MeterInput Meter, Guid? FixedRouteId, Guid? VehicleClassId, Guid? ZoneId, Guid[]? ServiceIds);
public sealed record AdjustmentInput(decimal FinalPrice, string Reason, long Version);
public sealed record OtpInput(string Phone);

public static class TaxiEndpoints
{
    public static void MapTaxiEndpoints(this WebApplication app)
    {
        async Task<IResult> Login(LoginInput input, TaxiDb db, TenantContext context, TokenService tokens, OfficeSessions sessions, CustomerSessions customerSessions, HttpContext http)
        {
            if (string.IsNullOrWhiteSpace(input.Password) || input.Password.Length > 512) return Results.Unauthorized();
            var tenant = await db.Set<Tenant>().SingleOrDefaultAsync(t => t.Slug == input.Tenant);
            if (tenant is null) return Results.Unauthorized();
            context.TenantId = tenant.Id;
            var user = await db.Set<User>().SingleOrDefaultAsync(u => u.Username == input.Username && u.Active);
            if (user is null || new PasswordHasher<User>().VerifyHashedPassword(user, user.PasswordHash, input.Password) == PasswordVerificationResult.Failed) return Results.Unauthorized();
            var driver=await db.Set<Driver>().SingleOrDefaultAsync(d=>d.UserId==user.Id);
            var application=http.Request.Path.Value!.EndsWith("radio-login")?"radio":"driver";
            if(application=="radio"&&driver is null || driver is not null&&!MobileAppAccess.Allowed(driver,application))return Results.Forbid();
            if(await db.Set<Role>().AnyAsync(r=>r.Id==user.RoleId&&r.Name=="CustomerApp")){context.ActorId=user.Id;if(!await CustomerAppEndpoints.Verified(db,context,app.Environment,app.Configuration))return Results.Json(new{code="PHONE_VERIFICATION_REQUIRED"},statusCode:401);return Results.Ok(new{accessToken=await customerSessions.Login(user),expiresIn=1800,tenant=tenant.Slug});}
            if(await db.Set<Permission>().AnyAsync(p=>p.RoleId==user.RoleId&&(p.Code=="rides.write"||p.Code=="rides.drive")))return Results.Ok(await sessions.Create(user,tenant.Slug,input.DeviceId is {Length:<=100}?input.DeviceId:null,application));
            return Results.Ok(new {accessToken=tokens.Issue(user),expiresIn=1800,tenant=tenant.Slug});
        }
        app.MapPost("/api/v1/auth/login", Login).RequireRateLimiting("auth");
        app.MapPost("/api/v1/auth/driver-login", Login).RequireRateLimiting("auth");
        app.MapPost("/api/v1/auth/radio-login", Login).RequireRateLimiting("auth");
        app.MapPost("/api/v1/auth/refresh",async (RefreshInput input,OfficeSessions sessions)=>await sessions.Renew(input.RefreshToken) is {} result?Results.Ok(result):await sessions.Replaced(input.RefreshToken)?Results.Json(new {code="SESSION_REPLACED"},statusCode:401):Results.Unauthorized()).RequireRateLimiting("office-refresh");
        app.MapPost("/api/v1/auth/logout",async (RefreshInput input,OfficeSessions sessions)=>{await sessions.Renew(input.RefreshToken,true);return Results.NoContent();}).RequireRateLimiting("office-refresh");

        var api = app.MapGroup("/api/v1").RequireAuthorization();
        api.MapPost("/auth/session",async(TaxiDb db,TenantContext context,OfficeSessions sessions)=>{
            var user=await db.Set<User>().SingleAsync(u=>u.Id==context.ActorId&&u.Active);
            var slug=await db.Set<Tenant>().Where(t=>t.Id==context.TenantId).Select(t=>t.Slug).SingleAsync();
            return Results.Ok(await sessions.Create(user,slug));
        }).RequireAuthorization("rides.write").RequireRateLimiting("office-refresh");
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
            if (input.Password.Length < 8 || !await db.Set<Role>().AnyAsync(r => r.Id == input.RoleId)) return Results.BadRequest();
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
            var destination = source == "CUSTOMER_APP" ? Locations.RequiredDestination(input.Destination) : Locations.OfficeDestination(input.Destination);
            if ((source == "WHATSAPP" && !await Enabled(db, "WhatsApp")) || (source == "LANDLINE" && !await Enabled(db, "CallerId"))) return Results.BadRequest(new { error = "Source feature disabled" });
            if (input.Notes?.Length > 2000) return Results.BadRequest();
            if (input.CustomerId.HasValue && !await db.Set<Customer>().AnyAsync(c => c.Id == input.CustomerId)) return Results.NotFound();
            if (input.ScheduledAt.HasValue && (input.ScheduledAt <= DateTimeOffset.UtcNow || !await Enabled(db, "ScheduledBooking"))) return Results.BadRequest(new { error = "Scheduled booking unavailable or date is in the past" });
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var request = new RideRequest { CustomerId = input.CustomerId, Destination = destination, Notes = input.Notes ?? "", Source = source, ScheduledAt = input.ScheduledAt?.ToUniversalTime() };
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
            if (await reception.IsQueued(id)) return Results.Conflict(new { error = "أخرج الطلب من الطابور قبل التعيين المباشر" });
            if (ride.Version != input.Version || ride.Status is not (RideStatus.Pending or RideStatus.Assigned or RideStatus.Rejected) || !driver.Active || driver.Status != DriverStatus.Available) return Results.Conflict();
            if (await reception.HasActiveOrder(driver.Id, exceptRequest: ride.RideRequestId)) return Results.Conflict();
            await dispatch.CloseOffer(ride, "OFFICE_OVERRIDE"); ride.DispatchMode = "MANUAL";
            ride.DriverId = driver.Id; ride.Status = RideStatus.Assigned; await reception.SyncRide(ride); Audit(db, context, "ride.assigned", ride.Id); await db.SaveChangesAsync(); await transaction.CommitAsync(); return Results.Ok(ride);
        }).RequireAuthorization("rides.write");
        api.MapGet("/driver/rides/{id:guid}", async (Guid id, TaxiDb db, TenantContext context, ReceptionService reception) =>
        {
            var driver = await DriverEndpoints.CurrentDriver(db, context);
            if (driver is null) return Results.Forbid();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id && driver != null && r.DriverId == driver.Id);
            if (ride is null) return Results.NotFound();
            var request = await db.Set<RideRequest>().SingleAsync(r => r.Id == ride.RideRequestId);
            if (ride.Status is RideStatus.Pending or RideStatus.Assigned or RideStatus.Cancelled) return Results.Ok(new { ride.Id, ride.Status, ride.Version, ride.FareMode, ride.FareSource, ride.FinalFare, ride.MeterCalculatedFare, ride.DistanceKm, ride.DurationSeconds, ride.WaitingSeconds, ride.MeterStartedAt, ride.Currency, request.Source, request.Pickup, request.Destination, request.Notes, request.Latitude, request.Longitude, request.DestinationLatitude, request.DestinationLongitude });
            var customer = await db.Set<Customer>().Where(c=>c.Id==request.CustomerId).Select(c=>new {c.FullName,c.Phone}).SingleOrDefaultAsync();
            var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
            bool show = price is not null && await (from rule in db.Set<PricingRule>() join profile in db.Set<PricingProfile>() on rule.PricingProfileId equals profile.Id where rule.Id == price.PricingRuleId select profile.ShowEstimate).SingleAsync();
            var startedAt=await db.Set<AuditLog>().Where(a=>a.EntityId==ride.Id&&a.Action=="ride.notification.InProgress").Select(a=>(DateTimeOffset?)a.CreatedAt).MinAsync();
            return Results.Ok(new { ride.Id, ride.Status, ride.Version, ride.FareMode, ride.FareSource, ride.FinalFare, ride.MeterCalculatedFare, ride.DistanceKm, ride.DurationSeconds, ride.WaitingSeconds, ride.MeterStartedAt, ride.Currency, request.Source, request.Pickup, request.Destination, request.Notes, startedAt, FullName = customer?.FullName ?? request.PassengerName, Phone = await reception.ShareCustomerPhone(request.Id) ? customer?.Phone ?? request.PassengerPhone : null, request.AddressText, request.Neighborhood, request.Street, request.Latitude, request.Longitude, request.DestinationLatitude, request.DestinationLongitude, request.LocationSource, EstimatedPrice = show ? price?.EstimatedPrice : null });
        }).RequireAuthorization("rides.drive");
        api.MapPut("/rides/{id:guid}/status", async (Guid id, StatusInput input, TaxiDb db, TenantContext context, HttpContext http, ReceptionService reception, AutoDispatch dispatch) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(); await reception.Lock();
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            if (ride is null) return Results.NotFound();
            var office = http.User.HasClaim("permission", "rides.write");
            if (!office && !await db.Set<Driver>().AnyAsync(d => d.Id == ride.DriverId && d.UserId == context.ActorId && d.Active && d.DriverAppEnabled && d.Status != DriverStatus.Suspended)) return Results.NotFound();
            if (!office && input.Status == RideStatus.Cancelled) return Results.Forbid();
            // A retry after losing the committed response must not re-run fares,
            // audit, dispatch or reception synchronization. Conflicting prices
            // and unrelated stale versions still receive 409.
            if (ride.Status == input.Status && (input.Version == ride.Version || input.Version == ride.Version - 1)
                && (!input.CollectedFare.HasValue || input.CollectedFare == ride.FinalFare)) return Results.Ok(ride);
            if (ride.Version != input.Version || !CanTransition(ride.Status, input.Status)) return Results.Conflict();
            if (input.Status == RideStatus.InProgress)
            {
                // Destination is optional for office dispatch. State, ownership,
                // version and completion fare checks still apply.
                await RideFare.Start(db, ride);
            }
            if (input.Status == RideStatus.Cancelled) RideFare.Finish(db,context.ActorId,ride,finalize:false);
            if (input.Status == RideStatus.Completed)
            {
                RideFare.Finish(db, context.ActorId, ride);
                var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
                var order = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(r => r.RideRequestId == ride.RideRequestId);
                // Office orders already carry the recorded fare; preserve the existing pricing flow.
                var officeFare = order is null ? null : System.Text.Json.Nodes.JsonNode.Parse(order.Payload)?["totalFare"]?.GetValue<decimal?>();
                if (!ride.FinalFare.HasValue) {
                    var legacyFare = price?.FinalPrice ?? (officeFare >= 0 ? officeFare : null);
                    if (legacyFare.HasValue) { ride.FinalFare = legacyFare; ride.FareSource = "OFFICE_MANUAL"; }
                }
                if (!ride.FinalFare.HasValue && input.CollectedFare.HasValue) {
                    var amount = input.CollectedFare.Value;
                    if (office || amount is < 0 or > 10000000 || decimal.Round(amount, 2) != amount) return Results.BadRequest(new { error = "أدخل مبلغًا صحيحًا بحد أقصى منزلتين عشريتين" });
                    if (ride.FareUpdatedAt is null) ride.Currency = await RideFare.ReadCurrency(db);
                    if (ride.FareMode != "GPS_METER") ride.FareMode = "DRIVER_MANUAL";
                    var old = ride.FinalFare; ride.FinalFare = amount; ride.FareSource = "DRIVER_MANUAL";
                    ride.FareUpdatedAt = DateTimeOffset.UtcNow; ride.FareUpdatedBy = context.ActorId;
                    RideFare.Audit(db, context.ActorId, ride, old);
                }
                if (ride.FinalFare is null or < 0) return Results.Conflict(new { code = "FINAL_FARE_REQUIRED", error = "أدخل المبلغ الذي تم تحصيله من الزبون" });
                await RideFare.SyncLegacy(db,context.ActorId,ride);
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
            await reception.SyncRide(ride); Audit(db, context, "ride.status", ride.Id, input.Status.ToString()); await db.SaveChangesAsync();
            if (ride.DriverId is Guid releasedId && input.Status is RideStatus.Completed or RideStatus.Cancelled) await reception.PromoteJob(releasedId);
            await tx.CommitAsync(); return Results.Ok(ride);
        }).RequireAuthorization(p => p.RequireAssertion(c => c.User.HasClaim("permission", "rides.write") || c.User.HasClaim("permission", "rides.drive")));
        api.MapPost("/rides/{id:guid}/price", async (Guid id, QuoteInput input, TaxiDb db, TenantContext context) =>
        {
            var ride = await db.Set<Ride>().SingleOrDefaultAsync(r => r.Id == id);
            if (ride is null) return Results.NotFound();
            if (ride.Status is RideStatus.Completed or RideStatus.Cancelled) return Results.Conflict();
            var quote = await Quote(db, input);
            if(quote.Mode==PricingMode.GpsMeter||ride.FareMode=="GPS_METER")return Results.BadRequest(new{error="GPS fare is calculated from server-validated location data"});
            var price = await db.Set<RidePrice>().SingleOrDefaultAsync(p => p.RideId == id);
            if (price is null) { price = new RidePrice { RideId = id, PricingRuleId = quote.RuleId, PricingMode = quote.Mode, Currency = quote.Currency, EstimatedPrice = quote.Amount }; db.Add(price); }
            if (price.PricingRuleId != quote.RuleId || price.AdjustedBy.HasValue) return Results.Conflict(new { error = "Existing price rule or manual adjustment must be preserved" });
            price.CalculatedPrice = quote.Amount; price.FinalPrice = quote.Amount;
            var oldFare=ride.FinalFare;ride.FinalFare=quote.Amount;ride.FareSource="OFFICE_MANUAL";ride.FareUpdatedAt=DateTimeOffset.UtcNow;ride.FareUpdatedBy=context.ActorId;RideFare.Audit(db,context.ActorId,ride,oldFare);
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
            var adjustedRide=await db.Set<Ride>().SingleAsync(r=>r.Id==id);
            if(ownDriver is not null&&adjustedRide.FareMode=="GPS_METER")return Results.Forbid();
            if(ownDriver is not null&&!await db.Set<FeatureFlag>().AnyAsync(f=>f.Key=="DriverManualFare"&&f.Enabled))return Results.Forbid();
            if (price.Version != input.Version) return Results.Conflict();
            if (price.PricingMode is not (PricingMode.Manual or PricingMode.Hybrid) || !await Enabled(db, "ManualPricing")) return Results.BadRequest();
            db.Add(new PriceAdjustment { RidePriceId = price.Id, PreviousPrice = price.FinalPrice, FinalPrice = input.FinalPrice, Reason = input.Reason.Trim(), AdjustedBy = context.ActorId });
            price.FinalPrice = input.FinalPrice; price.ManualAdjustment = input.FinalPrice - (price.CalculatedPrice ?? 0); price.AdjustmentReason = input.Reason.Trim(); price.AdjustedBy = context.ActorId;
            var oldFare=adjustedRide.FinalFare;adjustedRide.FinalFare=input.FinalPrice;adjustedRide.FareSource=adjustedRide.FareMode=="GPS_METER"?"OFFICE_OVERRIDE":ownDriver is null?"OFFICE_MANUAL":"DRIVER_MANUAL";adjustedRide.FareUpdatedAt=DateTimeOffset.UtcNow;adjustedRide.FareUpdatedBy=context.ActorId;RideFare.Audit(db,context.ActorId,adjustedRide,oldFare,input.Reason);
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
