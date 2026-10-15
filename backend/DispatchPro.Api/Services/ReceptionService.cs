using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Endpoints;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Services;

public sealed class ReceptionConflictException(string message) : Exception(message);
public sealed record ReceptionEvent(string EventId, string Source, string Phone, string Timestamp, string? Line = null, LocationInput? Location = null);
public sealed record ReceptionQueueAction(string Type, Guid ShiftId, Guid? BeforeShiftId = null);
public sealed partial class ReceptionService(TaxiDb db, TenantContext tenant)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] Active = ["assigned", "driver-accepted", "driver-arriving", "arrived", "in-progress"];
    private static readonly string[] Statuses = ["pending", "waiting", .. Active, "completed", "cancelled"];
    private static readonly string[] Sources = ["WHATSAPP", "LANDLINE_ICALL", "MANUAL", "CUSTOMER_APP", "DRIVER_STREET", "OFFICE", "LANDLINE", "EXTERNAL", "BRIDGE"];
    private static string Text(JsonObject value, string key) => value[key]?.ToString() ?? "";
    private static bool IsActive(JsonObject value) => Active.Contains(Text(value, "status"));
    private static string LegacyDispatch(string status) => status switch { "assigned" => "SENT", "driver-accepted" => "ACCEPTED", "driver-arriving" => "ARRIVING", "arrived" => "ARRIVED", "in-progress" => "STARTED", "completed" => "COMPLETED", "cancelled" => "CANCELLED", _ => "PENDING" };
    private static string DispatchStatus(JsonObject value) => Text(value, "dispatchStatus") is { Length: > 0 } status ? status : LegacyDispatch(Text(value, "status"));
    private static void NormalizeDispatch(JsonObject input, JsonObject? previous)
    {
        var value = Text(input, "dispatchStatus");
        if (value == "" || (previous is not null && value == DispatchStatus(previous) && Text(input, "status") != Text(previous, "status"))) value = LegacyDispatch(Text(input, "status"));
        var expected = value switch { "PENDING" => "pending", "SENT" => "assigned", "ACCEPTED" => "driver-accepted", "REJECTED" => "waiting", "ARRIVING" => "driver-arriving", "ARRIVED" => "arrived", "STARTED" => "in-progress", "COMPLETED" => "completed", "CANCELLED" => "cancelled", _ => throw new ArgumentException("Invalid dispatch status") };
        if (Text(input, "status") != expected && !(value == "PENDING" && Text(input, "status") == "waiting") && !(value == "ACCEPTED" && Text(input, "status") == "driver-arriving")) throw new ArgumentException("Inconsistent dispatch status");
        input["dispatchStatus"] = value;
    }
    private static JsonObject Parse(ReceptionOrder row) {
        var value = JsonNode.Parse(row.Payload)!.AsObject();
        value["dispatchStatus"] = DispatchStatus(value);
        value["addressType"] ??= Text(value, "addressStatus") == "variable" ? "VARIABLE" : "FIXED";
        return value;
    }
    private void Audit(string action, Guid id, string detail = "") => db.Add(new AuditLog { ActorId = tenant.ActorId, Action = action, EntityId = id, Detail = detail });
    public static string Day(DateTimeOffset timestamp) => TimeZoneInfo.ConvertTime(timestamp, TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem")).ToString("yyyy-MM-dd");
    public async Task Lock() => await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({tenant.TenantId.ToString()}, 0))");
    private async Task<int> Number(string day)
    {
        var counter = await db.Set<ReceptionCounter>().SingleOrDefaultAsync(c => c.Day == day);
        if (counter is null) { counter = new ReceptionCounter { Day = day }; db.Add(counter); }
        return ++counter.Value;
    }
    public static ReceptionEvent ValidateEvent(ReceptionEvent input)
    {
        if (string.IsNullOrWhiteSpace(input.EventId) || input.EventId.Length > 160 || !Sources.Contains(input.Source) || string.IsNullOrWhiteSpace(input.Phone) || !Regex.IsMatch(input.Phone.Trim(), @"^[+0-9][0-9 ()-]{0,39}$") || input.Line?.Length > 80 || input.Timestamp is null || !Regex.IsMatch(input.Timestamp, @"^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$") || !DateTimeOffset.TryParse(input.Timestamp, out _)) throw new ArgumentException("Invalid call event");
        if (input.Location is not null) Locations.Validate(input.Location);
        return input with { EventId = input.EventId.Trim(), Phone = input.Phone.Trim(), Timestamp = DateTimeOffset.Parse(input.Timestamp).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") };
    }
    public async Task<ReceptionCall[]> RecentCalls(int count = 1) => (await db.Set<ReceptionCall>()
        .FromSqlInterpolated($"SELECT * FROM \"ReceptionCall\" WHERE \"TenantId\" = {tenant.TenantId} ORDER BY (\"Payload\"::jsonb ->> 'timestamp')::timestamptz DESC, \"EventId\" DESC LIMIT {count}")
        .AsNoTracking().ToListAsync()).OrderByDescending(c => DateTimeOffset.Parse(JsonNode.Parse(c.Payload)!["timestamp"]!.GetValue<string>())).ThenByDescending(c => c.EventId, StringComparer.Ordinal).ToArray();
    public async Task<object> Receive(ReceptionEvent input)
    {
        var call = ValidateEvent(input);
        var serialized = JsonSerializer.SerializeToNode(call, Json)!.AsObject();
        if (call.Location is null) serialized.Remove("location"); // Preserve fingerprints of pre-location call events.
        var payload = serialized.ToJsonString(Json);
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        await using var transaction = await db.Database.BeginTransactionAsync(); await Lock();
        var previous = await db.Set<ReceptionCall>().SingleOrDefaultAsync(e => e.EventId == call.EventId);
        if (previous is not null)
        {
            if (previous.Fingerprint != fingerprint) throw new ReceptionConflictException("EVENT_ID_CONFLICT");
            return new { duplicate = true, eventId = call.EventId };
        }
        var feature = call.Source == "WHATSAPP" ? "WhatsApp" : call.Source == "LANDLINE_ICALL" ? "CallerId" : null;
        if (feature is not null && !await db.Set<FeatureFlag>().AnyAsync(f => f.Key == feature && f.Enabled)) throw new ReceptionConflictException("Call source is disabled for this office");
        var received = new ReceptionCall { EventId = call.EventId, Payload = payload, Fingerprint = fingerprint };
        db.Add(received);
        if (feature is not null)
        {
            var phone = CustomerPhone.Clean(call.Phone);
            string[] variants;
            try { variants = CustomerPhone.Variants(phone); } catch (ArgumentException) { variants = [phone]; }
            var customer = await db.Set<Customer>().Where(c => variants.Contains(c.Phone) || variants.Contains(c.SecondaryPhone)).Select(c=>new {c.Id,c.FullName,c.Phone}).FirstOrDefaultAsync();
            var now = DateTimeOffset.UtcNow;
            var row = new ReceptionOrder { ExternalId = "call-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(call.EventId))).ToLowerInvariant(), EventId = call.EventId, Day = Day(now), Version = 1 };
            row.Number = await Number(row.Day);
            row.Payload = JsonSerializer.Serialize(new { id = row.ExternalId, callEventId = call.EventId, callTimestamp = call.Timestamp, receptionPending = true, source = call.Source, passengerPhone = call.Phone, passengerName = customer?.FullName ?? "", pickup = new { name = "", coords = new { x = 0, y = 0 } }, totalFare = (decimal?)null, movingFee = false, status = "pending", driverId = (string?)null, shiftId = (string?)null, createdAt = now, updatedAt = now, orderDay = row.Day, orderNumber = row.Number, receptionVersion = row.Version }, Json);
            var data = Parse(row);
            if (customer is not null) {
                data["customerId"] = customer.Id;
                var saved = await db.Set<SavedAddress>().SingleOrDefaultAsync(a => a.CustomerId == customer.Id && a.IsDefault);
                if (saved is not null && call.Location is null) {
                    data["savedAddressId"] = saved.Id;
                    data["addressText"] = saved.AddressText; data["neighborhood"] = saved.Neighborhood; data["street"] = saved.Street;
                    data["latitude"] = saved.Latitude; data["longitude"] = saved.Longitude; data["locationSource"] = "SAVED_ADDRESS"; data["notes"] = saved.Notes;
                    data["pickup"] = JsonSerializer.SerializeToNode(new { name = saved.AddressText, coords = new { x = saved.Latitude ?? 0, y = saved.Longitude ?? 0 } }, Json);
                }
            }
            if (call.Location is {} location) {
                data["addressText"] = location.AddressText; data["neighborhood"] = location.Neighborhood; data["street"] = location.Street; data["latitude"] = location.Latitude; data["longitude"] = location.Longitude; data["locationSource"] = location.LocationSource; data["notes"] = location.Notes;
                data["pickup"] = JsonSerializer.SerializeToNode(new { name = location.AddressText, coords = new { x = location.Latitude ?? 0, y = location.Longitude ?? 0 } }, Json);
            }
            // A received call is a reception draft, not a ride. Create its request only
            // when the receptionist supplies a destination and saves the order.
            row.Payload = data.ToJsonString();
            db.Add(row); Audit("reception.call-created", row.Id);
        }
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        return new { duplicate = false, eventId = call.EventId };
    }
    public async Task<JsonObject> Save(string id, JsonObject input, bool canPrice = true)
    {
        foreach(var key in new[]{"finalFare","meterCalculatedFare","distanceKm","durationSeconds","waitingSeconds","fareSource","fareUpdatedBy","fareUpdatedAt","currency"}) input.Remove(key);
        input.Remove("queuedDriverId"); input.Remove("jobPosition"); // Read-only snapshot projection.
        if (input["pickup"] is null) input["pickup"] = new JsonObject { ["name"] = "" };
        ValidateRide(input);
        if (string.IsNullOrWhiteSpace(id) || id.Length > 180 || Text(input, "id") != id) throw new ArgumentException("Invalid ride ID");
        var status = Text(input, "status");
        if (!Statuses.Contains(status)) throw new ArgumentException("Invalid reception status");
        if (input["pickup"] is not JsonObject pickup || pickup["name"] is not JsonValue || Text(pickup, "name").Length > 500) throw new ArgumentException("Pickup is required");
        decimal? fare = null;
        if (input["totalFare"] is not null) {
            if (input["totalFare"] is not JsonValue fareValue || !fareValue.TryGetValue<decimal>(out var amount) || amount is < 0 or > 10000000 || decimal.Round(amount, 2) != amount) throw new ArgumentException("Invalid fare");
            fare = amount;
        }
        var source = Text(input, "source"); if (source == "") { source = "MANUAL"; input["source"] = source; }
        if (!Sources.Contains(source)) throw new ArgumentException("Invalid source");
        // Stable fingerprint lets a response-lost retry succeed without overwriting a newer edit.
        var fingerprintInput = new JsonObject();
        foreach (var pair in input.OrderBy(p => p.Key)) if (pair.Key is not ("createdAt" or "updatedAt" or "orderDay" or "orderNumber")) fingerprintInput[pair.Key] = pair.Value?.DeepClone();
        var writeHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprintInput.ToJsonString())));
        await using var transaction = await db.Database.BeginTransactionAsync(); await Lock();
        var row = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(r => r.ExternalId == id);
        var previous = row is null ? null : Parse(row);
        // Only the send action controls what the driver may see.
        if (previous is not null) input["shareCustomerPhone"] = previous["shareCustomerPhone"]?.DeepClone();
        else input.Remove("shareCustomerPhone");
        if (input["dropoff"] is JsonObject destination) destination["name"] = Text(destination, "name").Trim();
        if (status != "cancelled") input["receptionPending"] = false;
        if(row is not null){var pricedRide=await db.Set<Ride>().AsNoTracking().SingleOrDefaultAsync(r=>r.RideRequestId==row.RideRequestId);if(pricedRide is not null)RideFare.Project(previous!,pricedRide);}
        if (row is not null && row.LastWriteHash == writeHash) return previous!;
        if (row is not null && input["receptionVersion"]?.GetValue<long>() != row.Version) throw new ReceptionConflictException("Stale reception version; reload before saving");
        if(Text(input,"fareMode")!=""&&Text(input,"fareMode")!=(Text(previous??new JsonObject(),"fareMode") is {Length:>0} oldMode?oldMode:"OFFICE_MANUAL")&&!canPrice)throw new ReceptionConflictException("Pricing permission required");
        if (fare.HasValue && fare != (previous?["totalFare"]?.GetValue<decimal>()) && (!canPrice || !await db.Set<FeatureFlag>().AnyAsync(f => f.Key == "ManualPricing" && f.Enabled))) throw new ReceptionConflictException("Manual pricing requires permission and the office feature");
        if (row is null && (!string.IsNullOrEmpty(Text(input, "callEventId")) || id.StartsWith("call-"))) throw new ArgumentException("Call orders must be created by ingestion");
        if (previous is not null && Text(previous, "status") is "completed" or "cancelled" && status != Text(previous, "status")) throw new ReceptionConflictException("Terminal order cannot be reopened; create a new order");
        if (input["scheduledTime"] is JsonValue scheduled && (previous is null || scheduled.ToJsonString() != previous["scheduledTime"]?.ToJsonString()))
        {
            if (!DateTimeOffset.TryParse(scheduled.GetValue<string>(), out _) || !await db.Set<FeatureFlag>().AnyAsync(f => f.Key == "ScheduledBooking" && f.Enabled)) throw new ArgumentException("Scheduled booking disabled or invalid date");
        }
        var driverChanged = previous is not null && Text(previous, "driverId") != Text(input, "driverId");
        if (driverChanged && Text(previous!, "status") is "completed" or "cancelled") throw new ReceptionConflictException("لا يمكن تغيير سائق طلب مغلق نهائيًا");
        var reassigned = driverChanged && Text(previous!, "driverId") != "" && status != "cancelled";
        if (reassigned) {
            if (Guid.TryParse(Text(input, "driverId"), out var replacement) && (await Busy(replacement, id, row?.RideRequestId) || await db.Set<Driver>().AnyAsync(d => d.Id == replacement && d.Status == DriverStatus.Busy))) throw new ReceptionConflictException("السائق الجديد مشغول");
            input["status"] = "pending"; input["dispatchStatus"] = "PENDING"; status = "pending";
            foreach (var timestamp in new[] { "assignedAt", "pickedUpAt", "droppedOffAt", "completionTime" }) input.Remove(timestamp);
        }
        if (IsActive(input))
        {
            if (!Guid.TryParse(Text(input, "driverId"), out var driverId)) throw new ArgumentException("Driver required");
            if (await Busy(driverId, id, row?.RideRequestId)) throw new ReceptionConflictException("Driver is busy");
            if (!await db.Set<Driver>().AnyAsync(d => d.Id == driverId && d.Active && d.DriverAppEnabled && d.Status != DriverStatus.Suspended && d.Status != DriverStatus.Offline)) throw new ReceptionConflictException("السائق غير متاح أو موقوف أو معطل");
            // Assignment keeps location, position and entry time until an explicit queue action.
        }
        else if (status is "cancelled") { input["driverId"] = null; input["shiftId"] = null; }
        if (Guid.TryParse(Text(input, "driverId"), out var selectedDriver) && !await db.Set<Driver>().AnyAsync(d => d.Id == selectedDriver && d.Active && d.DriverAppEnabled && d.Status != DriverStatus.Suspended)) throw new ArgumentException("السائق غير متاح في المكتب");
        if (Text(input, "driverId") != "" && !Guid.TryParse(Text(input, "driverId"), out _)) throw new ArgumentException("Invalid driver");
        input["shiftId"] = null;
        NormalizeDispatch(input, previous);
        if (row is null)
        {
            var now = DateTimeOffset.UtcNow;
            row = new ReceptionOrder { ExternalId = id, Day = Day(now), Version = 0 };
            row.Number = await Number(row.Day); input["createdAt"] = now;
            db.Add(row);
        }
        else
        {
            input["createdAt"] = previous!["createdAt"]?.DeepClone();
            foreach (var key in new[] { "callEventId", "callTimestamp", "source" }) input[key] = previous[key]?.DeepClone();
        }
        input["orderDay"] = row.Day; input["orderNumber"] = row.Number; input["updatedAt"] = DateTimeOffset.UtcNow; input["receptionVersion"] = ++row.Version;
        if (row.RideRequestId.HasValue || status != "cancelled") await SyncRequest(row, input);
        await SyncQueueStatus(previous, input);
        if (driverChanged && status != "cancelled") Audit(reassigned ? "reception.driver-reassigned" : "reception.driver-assigned", row.Id, JsonSerializer.Serialize(new { previousDriverId = Text(previous!, "driverId"), newDriverId = Text(input, "driverId"), previousDispatchStatus = DispatchStatus(previous!), readyToSend = true }, Json));
        var beforeStatus = previous is null ? "PENDING" : DispatchStatus(previous);
        var afterStatus = DispatchStatus(input);
        if (beforeStatus != afterStatus) Audit("reception.status-changed", row.Id, JsonSerializer.Serialize(new { previous = beforeStatus, next = afterStatus }, Json));
        row.Payload = input.ToJsonString(); row.LastWriteHash = writeHash;
        Audit("reception.saved", row.Id, previous is not null && previous["totalFare"]?.ToJsonString() != input["totalFare"]?.ToJsonString() ? $"fare: {previous["totalFare"]} -> {input["totalFare"]}" : "");
        await db.SaveChangesAsync();
        if (Guid.TryParse(previous?["driverId"]?.ToString(), out var releasedDriver)) await PromoteJob(releasedDriver);
        await transaction.CommitAsync(); return input;
    }
    private static void ValidateRide(JsonObject input)
    {
        foreach (var key in new[] { "id", "status", "source", "passengerName", "passengerPhone", "notes", "addressStatus", "addressType", "dispatchStatus", "driverId", "shiftId", "callEventId", "callTimestamp" })
            if (input[key] is not null && (input[key] is not JsonValue value || !value.TryGetValue<string>(out var text) || text.Length > (key == "notes" ? 4000 : 500))) throw new ArgumentException($"Invalid {key}");
        foreach (var key in new[] { "receptionPending", "movingFee", "isNew" }) if (input[key] is not null && (input[key] is not JsonValue value || !value.TryGetValue<bool>(out _))) throw new ArgumentException($"Invalid {key}");
        if (input["receptionVersion"] is not null && (input["receptionVersion"] is not JsonValue version || !version.TryGetValue<long>(out var number) || number < 1)) throw new ArgumentException("Invalid reception version");
        foreach (var key in new[] { "createdAt", "updatedAt", "scheduledTime", "assignedAt", "pickedUpAt", "droppedOffAt", "cancelledAt", "completionTime" })
            if (input[key] is not null && (input[key] is not JsonValue value || !value.TryGetValue<string>(out var timestamp) || !DateTimeOffset.TryParse(timestamp, out _))) throw new ArgumentException($"Invalid {key}");
        void Location(JsonNode? node)
        {
            if (node is JsonObject textLocation && textLocation["coords"] is null && textLocation["name"] is JsonValue textName && textName.TryGetValue<string>(out var address) && address.Length <= 500) return;
            if (node is not JsonObject location || location["name"] is not JsonValue name || !name.TryGetValue<string>(out var text) || text.Length > 500 || location["coords"] is not JsonObject coords || coords["x"] is not JsonValue x || coords["y"] is not JsonValue y || !x.TryGetValue<double>(out var latitude) || !y.TryGetValue<double>(out var longitude) || !double.IsFinite(latitude) || !double.IsFinite(longitude) || latitude is < -90 or > 90 || longitude is < -180 or > 180) throw new ArgumentException("Invalid location");
        }
        Location(input["pickup"]); if (input["dropoff"] is not null) Location(input["dropoff"]);
        if (input["stops"] is not null) { if (input["stops"] is not JsonArray stops || stops.Count > 30) throw new ArgumentException("Invalid stops"); foreach (var stop in stops) Location(stop); }
    }
    public Task<bool> IsBusy(Guid driverId) => Busy(driverId);
    private async Task<bool> Busy(Guid driverId, string? except = null, Guid? exceptRequest = null)
    {
        if (await db.Set<Ride>().AnyAsync(r => r.DriverId == driverId && r.RideRequestId != exceptRequest && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving))) return true;
        return await HasActiveOrder(driverId, except);
    }
    public async Task<bool> HasActiveOrder(Guid driverId, string? except = null, Guid? exceptRequest = null) => (await ActiveOrderDrivers(except,exceptRequest)).Contains(driverId);
    public async Task<HashSet<Guid>> ActiveOrderDrivers(string? except = null, Guid? exceptRequest = null)
    {
        var rows=(await db.Set<ReceptionOrder>().Where(r=>r.ExternalId!=except&&r.RideRequestId!=exceptRequest).ToListAsync()).Select(Parse).Where(IsActive);
        return rows.Select(r=>Guid.TryParse(Text(r,"driverId"),out var id)?id:Guid.Empty).Where(id=>id!=Guid.Empty).ToHashSet();
    }
    private async Task SyncRequest(ReceptionOrder row, JsonObject input)
    {
        var isNew = !row.RideRequestId.HasValue;
        var request = isNew ? new RideRequest { Id = row.Id } : await db.Set<RideRequest>().SingleAsync(r => r.Id == row.RideRequestId);
        var originalLocation = new { pickup = request.Pickup, latitude = request.Latitude, longitude = request.Longitude, destination = request.Destination, destinationLatitude = request.DestinationLatitude, destinationLongitude = request.DestinationLongitude, locationSource = request.LocationSource };
        var existingRide = isNew ? null : await db.Set<Ride>().SingleAsync(r => r.RideRequestId == request.Id);
        if (Guid.TryParse(Text(input, "customerId"), out var customerId)) {
            if (!await db.Set<Customer>().AnyAsync(c => c.Id == customerId)) throw new ArgumentException("Unknown customer");
            request.CustomerId = customerId;
        }
        var addressType = Text(input, "addressType");
        if (addressType == "") addressType = Text(input, "addressStatus") == "variable" ? "VARIABLE" : "FIXED";
        if (addressType is not ("FIXED" or "VARIABLE")) throw new ArgumentException("Invalid address type");
        request.AddressType = addressType; input["addressType"] = addressType;
        input["addressStatus"] = addressType == "VARIABLE" ? "variable" : "default";
        request.PassengerName = Text(input, "passengerName"); request.PassengerPhone = Text(input, "passengerPhone");
        request.Source = Locations.OrderSource(Text(input, "source")); request.Notes = Text(input, "notes");
        request.Destination = input["dropoff"] is JsonObject dropoff ? Text(dropoff, "name").Trim() : "";
        request.ScheduledAt = DateTimeOffset.TryParse(Text(input, "scheduledTime"), out var scheduled) ? scheduled.ToUniversalTime() : null;
        LocationInput location;
        if (Guid.TryParse(Text(input, "savedAddressId"), out var addressId) && (isNew || request.SavedAddressId != addressId)) {
            var saved = await db.Set<SavedAddress>().SingleOrDefaultAsync(a => a.Id == addressId) ?? throw new ArgumentException("Unknown saved address");
            if (request.CustomerId.HasValue && request.CustomerId != saved.CustomerId) throw new ArgumentException("Address belongs to a different customer");
            request.CustomerId = saved.CustomerId; request.SavedAddressId = saved.Id; location = Locations.From(saved);
        } else {
            if (input["savedAddressId"] is null) request.SavedAddressId = null;
            location = new LocationInput(Text(input, "addressText") is { Length: > 0 } text ? text : Text(input["pickup"]!.AsObject(), "name"), Text(input, "neighborhood"), Text(input, "street"), input["latitude"]?.GetValue<double?>(), input["longitude"]?.GetValue<double?>(), Text(input, "locationSource") is { Length: > 0 } source ? source : "MANUAL_TEXT", request.Notes);
        }
        Locations.Validate(location, allowEmpty: true);
        if (existingRide is not null && (!RideLocationEndpoints.CanEditPickup(existingRide.Status) || existingRide.MeterStartedAt.HasValue) &&
            (request.Pickup != location.AddressText.Trim() || request.Latitude != location.Latitude || request.Longitude != location.Longitude))
            throw new ReceptionConflictException("لا يمكن تغيير نقطة الانطلاق بعد بدء الرحلة");
        Locations.Apply(request, location);
        if (isNew || !request.CustomerId.HasValue) await CaptureOfficeCustomer(request);
        var destinationCoords = input["dropoff"]?["coords"];
        request.DestinationLatitude = destinationCoords?["x"]?.GetValue<double?>(); request.DestinationLongitude = destinationCoords?["y"]?.GetValue<double?>();
        // Legacy reception forms used 0,0 for text-only locations; keep absence explicit.
        if (request.DestinationLatitude == 0 && request.DestinationLongitude == 0) { request.DestinationLatitude = null; request.DestinationLongitude = null; }
        if (existingRide is not null && (originalLocation.pickup != request.Pickup || originalLocation.latitude != request.Latitude || originalLocation.longitude != request.Longitude || originalLocation.destination != request.Destination || originalLocation.destinationLatitude != request.DestinationLatitude || originalLocation.destinationLongitude != request.DestinationLongitude))
        {
            if (!RideLocationEndpoints.CanEdit(existingRide.Status)) throw new ReceptionConflictException("لا يمكن تغيير مواقع رحلة منتهية");
            var changedAt = DateTimeOffset.UtcNow;
            Audit("ride.locations-updated", existingRide.Id, JsonSerializer.Serialize(new { rideId = existingRide.Id, previous = originalLocation, next = new { pickup = request.Pickup, latitude = request.Latitude, longitude = request.Longitude, destination = request.Destination, destinationLatitude = request.DestinationLatitude, destinationLongitude = request.DestinationLongitude, locationSource = request.LocationSource }, changedBy = tenant.ActorId, changedAt, source = "OFFICE" }, Json));
        }
        input["rideRequestId"] = request.Id; input["customerId"] = request.CustomerId; input["savedAddressId"] = request.SavedAddressId;
        input["addressText"] = request.AddressText; input["neighborhood"] = request.Neighborhood; input["street"] = request.Street; input["latitude"] = request.Latitude; input["longitude"] = request.Longitude; input["locationSource"] = request.LocationSource;
        input["notes"] = request.Notes;
        input["pickup"] = JsonSerializer.SerializeToNode(new { name = request.AddressText, coords = request.Latitude.HasValue && request.Longitude.HasValue ? new { x = request.Latitude.Value, y = request.Longitude.Value } : null }, Json);
        var ride = isNew ? new Ride { RideRequestId = request.Id } : await db.Set<Ride>().SingleAsync(r => r.RideRequestId == request.Id);
        var officeDriver = Guid.TryParse(Text(input, "driverId"), out var selectedId) ? selectedId : (Guid?)null;
        if (!isNew && await IsQueued(ride.Id) && (officeDriver.HasValue || Text(input, "status") is not ("pending" or "waiting" or "cancelled"))) throw new ReceptionConflictException("أخرج الطلب من الطابور قبل إرساله أو تغيير سائقه");
        if (!isNew && (officeDriver != ride.DriverId || Text(input, "status") == "cancelled"))
        {
            foreach (var offer in await db.Set<RideOffer>().Where(o => o.RideId == ride.Id && o.Outcome == "OFFERED").ToListAsync()) offer.Outcome = "OFFICE_OVERRIDE";
            ride.DispatchMode = "MANUAL"; ride.OfferExpiresAt = null;
        }
        var requestedMode=Text(input,"fareMode");
        if(requestedMode!=""&&!RideFare.Modes.Contains(requestedMode))throw new ArgumentException("Invalid fare mode");
        if(requestedMode!=""&&requestedMode!=ride.FareMode){
            if(ride.MeterStartedAt.HasValue||ride.Status is RideStatus.InProgress or RideStatus.Completed)throw new ReceptionConflictException("لا يمكن تغيير طريقة التسعير بعد بدء الرحلة");
            if(requestedMode=="DRIVER_MANUAL"&&!await db.Set<FeatureFlag>().AnyAsync(f=>f.Key=="DriverManualFare"&&f.Enabled))throw new ReceptionConflictException("التسعير بواسطة السائق غير مفعّل");
            if(requestedMode=="GPS_METER"&&!await db.Set<PricingRule>().AnyAsync(r=>r.Mode==PricingMode.GpsMeter))throw new ReceptionConflictException("إعدادات عداد GPS غير مهيأة");
            ride.FareMode=requestedMode;
        }
        var inputFare=input["totalFare"]?.GetValue<decimal>();
        var storedFare=ride.FinalFare??(isNew?(decimal?)null:Parse(await db.Set<ReceptionOrder>().SingleAsync(o=>o.RideRequestId==request.Id))["totalFare"]?.GetValue<decimal>());
        if(inputFare.HasValue && (isNew||storedFare!=inputFare)){
            var old=ride.FinalFare;if(ride.FareUpdatedAt is null)ride.Currency=await RideFare.ReadCurrency(db);ride.FinalFare=inputFare;ride.FareSource=ride.FareMode=="GPS_METER"?"OFFICE_OVERRIDE":"OFFICE_MANUAL";
            ride.FareUpdatedAt=DateTimeOffset.UtcNow;ride.FareUpdatedBy=tenant.ActorId;RideFare.Audit(db,tenant.ActorId,ride,old);
        }
        var previousDriverId = ride.DriverId;
        var previousStatus = ride.Status;
        var wasActive = (ride.Status >= RideStatus.Assigned && ride.Status <= RideStatus.InProgress) || ride.Status == RideStatus.DriverArriving;
        ride.DriverId = Guid.TryParse(Text(input, "driverId"), out var driverId) ? driverId : null;
        ride.Status = Text(input, "status") switch { "assigned" => RideStatus.Assigned, "driver-accepted" => RideStatus.Accepted, "driver-arriving" => RideStatus.DriverArriving, "waiting" when DispatchStatus(input) == "REJECTED" => RideStatus.Rejected, "arrived" => RideStatus.Arrived, "in-progress" => RideStatus.InProgress, "completed" => RideStatus.Completed, "cancelled" => RideStatus.Cancelled, _ => RideStatus.Pending };
        if(previousStatus!=RideStatus.InProgress&&ride.Status==RideStatus.InProgress)await RideFare.Start(db,ride);
        if(ride.Status==RideStatus.Cancelled)RideFare.Finish(db,tenant.ActorId,ride,finalize:false);
        if(ride.Status==RideStatus.Completed)RideFare.Finish(db,tenant.ActorId,ride);
        if(ride.Status==RideStatus.Completed && ride.FinalFare is null or < 0)throw new ReceptionConflictException("لا يمكن إنهاء الرحلة قبل تحديد السعر النهائي");
        await RideFare.SyncLegacy(db,tenant.ActorId,ride);
        RideFare.Project(input,ride);
        if (!isNew && previousStatus == RideStatus.NoDriverAvailable && ride.Status == RideStatus.Pending && previousDriverId == ride.DriverId) ride.Status = RideStatus.NoDriverAvailable;
        if (!isNew && previousDriverId == ride.DriverId && !RideWorkflow.CanTransition(previousStatus, ride.Status)) throw new ReceptionConflictException("انتقال حالة الرحلة غير مسموح");
        if (previousStatus == RideStatus.Assigned && ride.Status != RideStatus.Assigned)
        {
            foreach (var offer in await db.Set<RideOffer>().Where(o => o.RideId == ride.Id && o.Outcome == "OFFERED").ToListAsync()) offer.Outcome = ride.Status == RideStatus.Accepted ? "ACCEPTED" : "OFFICE_OVERRIDE";
            ride.OfferExpiresAt = null;
        }
        if (ride.DriverId is Guid activeDriver && ride.Status is RideStatus.Accepted or RideStatus.DriverArriving or RideStatus.Arrived or RideStatus.InProgress)
            (await db.Set<Driver>().SingleAsync(d => d.Id == activeDriver)).Status = DriverStatus.Busy;
        if (wasActive && previousDriverId.HasValue && (previousDriverId != ride.DriverId || !IsActive(input)))
        {
            var released = await db.Set<Driver>().SingleAsync(d => d.Id == previousDriverId.Value);
            if (released.Status == DriverStatus.Busy) released.Status = DriverStatus.Available;
        }
        if (ride.Status == RideStatus.Cancelled) await RemoveJob(ride.Id);
        input["workflowStatus"] = RideWorkflow.State(ride.Status);
        input["rideStatus"] = RideWorkflow.CustomerState(ride);
        input["dispatchMode"] = ride.DispatchMode; input["hailingStatus"] = AutoDispatch.State(ride); input["offerExpiresAt"] = ride.OfferExpiresAt;
        input["backendRideId"] = ride.Id; input["rideVersion"] = ride.Version + 1;
        if (isNew) { row.RideRequestId = request.Id; db.AddRange(request, ride); }
    }
    public async Task ProjectRequest(RideRequest request, Ride ride)
    {
        var customer = request.CustomerId.HasValue ? await db.Set<Customer>().Where(c=>c.Id==request.CustomerId).Select(c=>new {c.FullName,c.Phone}).SingleAsync() : null;
        var row = new ReceptionOrder { RideRequestId = request.Id, ExternalId = ride.Id.ToString(), Day = Day(request.CreatedAt), Version = 1 };
        row.Number = await Number(row.Day);
        row.Payload = JsonSerializer.Serialize(new { id = row.ExternalId, rideRequestId = request.Id, customerId = request.CustomerId, savedAddressId = request.SavedAddressId, source = request.Source == "LANDLINE" ? "LANDLINE_ICALL" : request.Source, passengerName = customer?.FullName ?? request.PassengerName, passengerPhone = customer?.Phone ?? request.PassengerPhone, pickup = new { name = request.AddressText, coords = new { x = request.Latitude ?? 0, y = request.Longitude ?? 0 } }, addressText = request.AddressText, neighborhood = request.Neighborhood, street = request.Street, latitude = request.Latitude, longitude = request.Longitude, locationSource = request.LocationSource, notes = request.Notes, destination = request.Destination, dropoff = new { name = request.Destination, coords = new { x = request.DestinationLatitude ?? 0, y = request.DestinationLongitude ?? 0 } }, totalFare = (decimal?)null, movingFee = false, status = "pending", driverId = (Guid?)null, shiftId = (Guid?)null, createdAt = request.CreatedAt, updatedAt = request.CreatedAt, orderDay = row.Day, orderNumber = row.Number, receptionVersion = row.Version }, Json);
        db.Add(row);
    }
    public async Task SyncRide(Ride ride)
    {
        if (ride.Status is RideStatus.Completed or RideStatus.Cancelled) await RemoveJob(ride.Id);
        var row = await db.Set<ReceptionOrder>().SingleOrDefaultAsync(r => r.RideRequestId == ride.RideRequestId); if (row is null) return;
        var previous = Parse(row); var data = Parse(row); RideFare.Project(data,ride); data["driverId"] = ride.DriverId;
        data["status"] = ride.Status switch { RideStatus.DriverArriving => "driver-arriving", RideStatus.Rejected => "waiting", RideStatus.Assigned => "assigned", RideStatus.Accepted => "driver-accepted", RideStatus.Arrived => "arrived", RideStatus.InProgress => "in-progress", RideStatus.Completed => "completed", RideStatus.Cancelled => "cancelled", _ => "pending" };
        data["dispatchStatus"] = ride.Status == RideStatus.Rejected ? "REJECTED" : LegacyDispatch(Text(data, "status"));
        data["workflowStatus"] = RideWorkflow.State(ride.Status);
        data["rideStatus"] = RideWorkflow.CustomerState(ride);
        data["backendRideId"] = ride.Id; data["rideVersion"] = ride.Version + 1;
        var lastAttempt = await db.Set<RideOffer>().Where(o => o.RideId == ride.Id && o.Outcome != "OFFERED").OrderByDescending(o => o.OfferedAt).FirstOrDefaultAsync();
        data["lastDispatchOutcome"] = lastAttempt?.Outcome;
        data["dispatchMode"] = ride.DispatchMode; data["hailingStatus"] = AutoDispatch.State(ride);
        data["offerExpiresAt"] = ride.OfferExpiresAt;
        if (DispatchStatus(previous) != DispatchStatus(data)) Audit("reception.status-changed", row.Id, JsonSerializer.Serialize(new { previous = DispatchStatus(previous), next = DispatchStatus(data) }, Json));
        await SyncQueueStatus(previous, data);
        data["receptionVersion"] = ++row.Version; data["updatedAt"] = DateTimeOffset.UtcNow; row.Payload = data.ToJsonString(); row.LastWriteHash = "";
    }
    private async Task SyncQueueStatus(JsonObject? previous, JsonObject current)
    {
        var oldDriver = previous is null ? "" : Text(previous, "driverId");
        var newDriver = Text(current, "driverId");
        foreach (var text in new[] { oldDriver, newDriver }.Distinct())
        {
            if (!Guid.TryParse(text, out var driver)) continue;
            var entry = await db.Set<ReceptionQueue>().SingleOrDefaultAsync(q => q.DriverId == driver);
            if (entry is not null) entry.Status = text == newDriver && IsActive(current) ? "BUSY" : "WAITING";
        }
    }
    public async Task Queue(ReceptionQueueAction action)
    {
        var shift = await db.Set<ReceptionShift>().SingleOrDefaultAsync(s => s.Id == action.ShiftId && s.Active) ?? throw new ArgumentException("Unknown active shift");
        var entry = await db.Set<ReceptionQueue>().SingleOrDefaultAsync(q => q.ShiftId == action.ShiftId);
        Guid? before = action.BeforeShiftId.HasValue ? (await db.Set<ReceptionShift>().SingleOrDefaultAsync(s => s.Id == action.BeforeShiftId))?.DriverId : null;
        if (action.BeforeShiftId.HasValue && before is null) throw new ArgumentException("Unknown queue target");
        await new DriverOperations(db, tenant, this).Queue(new(action.Type, shift.DriverId, entry?.QueueLocationId, shift.VehicleId, before), true, shift.Id);
    }
    public async Task StartShift(Guid driverId, Guid vehicleId)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(); await Lock();
        if (!await db.Set<Driver>().AnyAsync(d => d.Id == driverId && d.Active && d.DriverAppEnabled && d.Status != DriverStatus.Busy && d.Status != DriverStatus.Suspended) || !await db.Set<Vehicle>().AnyAsync(v => v.Id == vehicleId && v.Active && v.Status == "ACTIVE")) throw new ArgumentException("Unknown or unavailable driver or vehicle");
        if (await db.Set<ReceptionShift>().AnyAsync(s => s.Active && (s.DriverId == driverId || s.VehicleId == vehicleId))) throw new ReceptionConflictException("Driver or vehicle already on shift");
        var shift = new ReceptionShift { DriverId = driverId, VehicleId = vehicleId }; db.Add(shift);
        Audit("reception.shift-started", shift.Id); await db.SaveChangesAsync(); await transaction.CommitAsync();
    }
    public async Task EndShift(Guid id)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(); await Lock();
        var shift = await db.Set<ReceptionShift>().SingleOrDefaultAsync(s => s.Id == id) ?? throw new ArgumentException("Unknown shift");
        if (await Busy(shift.DriverId)) throw new ReceptionConflictException("Cannot end a busy shift");
        shift.Active = false; shift.EndTime = DateTimeOffset.UtcNow;
        var entry = await db.Set<ReceptionQueue>().SingleOrDefaultAsync(q => q.ShiftId == id);
        if (entry is not null) { db.Remove(entry); DriverOperations.Renumber(await db.Set<ReceptionQueue>().Where(q => q.Id != entry.Id).OrderBy(q => q.Position).ToListAsync()); }
        Audit("reception.shift-ended", id); await db.SaveChangesAsync(); await transaction.CommitAsync();
    }
    public async Task<object> Snapshot()
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead);
        var shifts = await db.Set<ReceptionShift>().AsNoTracking().OrderBy(s => s.Id).ToListAsync();
        var drivers = await db.Set<Driver>().AsNoTracking().OrderBy(d => d.Id).ToListAsync();
        var vehicles = await db.Set<Vehicle>().AsNoTracking().OrderBy(v => v.Id).ToListAsync();
        var latest = (await RecentCalls()).FirstOrDefault();
        var jobs = await db.Set<DriverJob>().AsNoTracking().ToListAsync();
        var today = Day(DateTimeOffset.UtcNow);
        // Unfinished office/call drafts have no Ride yet. They must survive midnight.
        var visibleOrders = db.Set<ReceptionOrder>().FromSqlInterpolated($"SELECT * FROM \"ReceptionOrder\" WHERE \"TenantId\"={tenant.TenantId} AND (\"Day\"={today} OR COALESCE(\"Payload\"::jsonb ->> 'status','pending') NOT IN ('completed','cancelled'))").AsNoTracking();
        var liveRides = await db.Set<Ride>().AsNoTracking().Where(r => visibleOrders.Any(o => o.RideRequestId == r.RideRequestId)).ToDictionaryAsync(r => r.RideRequestId);
        JsonObject WithJob(ReceptionOrder order)
        {
            var data = Parse(order);
            // Use the persisted version, not a predicted SaveChanges increment.
            Ride? liveRide = null;
            if (order.RideRequestId.HasValue && liveRides.TryGetValue(order.RideRequestId.Value, out liveRide))
            { data["backendRideId"] = liveRide.Id; data["rideVersion"] = liveRide.Version; RideFare.Project(data,liveRide); }
            var job = jobs.FirstOrDefault(j => j.RideId == liveRide?.Id);
            if (job is not null) { data["queuedDriverId"] = job.DriverId; data["jobPosition"] = job.Position; }
            return data;
        }
        var busyDrivers = await db.Set<Ride>().Where(r => r.DriverId != null && (r.Status >= RideStatus.Assigned && r.Status <= RideStatus.InProgress || r.Status == RideStatus.DriverArriving)).Select(r => r.DriverId!.Value).ToListAsync();
        var snapshot = new
        {
            rides = (await visibleOrders.OrderBy(r => r.Day).ThenBy(r => r.Number).ToListAsync()).Select(WithJob).OrderByDescending(r => DateTimeOffset.Parse(Text(r, "createdAt"))).ThenByDescending(r => Text(r, "id"), StringComparer.Ordinal).ToArray(),
            drivers = drivers.Select(d => new { d.Id, name = d.FullName, phoneNumber = d.Phone, rating = 0, isActive = d.Active, suspended = d.Status == DriverStatus.Suspended, currentVehicleId = d.CurrentVehicleId, status = shifts.Any(s => s.DriverId == d.Id && s.Active) ? "on-shift" : "offline", location = new { x = 0, y = 0 } }),
            vehicles = vehicles.Select(v => new { v.Id, nickname = v.Plate, make = v.Make, model = v.Model, year = v.Year, vin = "", mileage = (int?)null, status = v.Active ? "active" : "inactive", currentShiftId = shifts.FirstOrDefault(s => s.VehicleId == v.Id && s.Active)?.Id, createdAt = DateTimeOffset.UnixEpoch, updatedAt = DateTimeOffset.UnixEpoch }),
            shifts = shifts.Select(s => new { s.Id, s.DriverId, s.VehicleId, status = s.Active ? "active" : "inactive", s.StartTime, s.EndTime }),
            queueLocations = await db.Set<QueueLocation>().AsNoTracking().OrderBy(l => l.SortOrder).ThenBy(l => l.Name).ToListAsync(),
            queue = (await db.Set<ReceptionQueue>().AsNoTracking().OrderBy(q => q.Position).ToListAsync()).Select(q => new { q.Id, q.ShiftId, q.DriverId, q.QueueLocationId, q.Position, q.JoinedAt, enteredAt = q.JoinedAt, status = busyDrivers.Contains(q.DriverId) ? "BUSY" : "WAITING" }),
            latest = latest is null ? null : JsonNode.Parse(latest.Payload)
        };
        await transaction.CommitAsync(); return snapshot;
    }
}
