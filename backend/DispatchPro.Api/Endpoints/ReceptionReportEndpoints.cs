using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed class ReceptionReportRow
{
    public string Id { get; set; } = "";
    public string Day { get; set; } = "";
    public string Payload { get; set; } = "";
    public DateTimeOffset Time { get; set; }
    public string State { get; set; } = "";
    public string Origin { get; set; } = "";
    public string Driver { get; set; } = "";
    public string Area { get; set; } = "";
    public string FareMode { get; set; } = "";
    public string Currency { get; set; } = "ILS";
    public decimal Fare { get; set; }
    public decimal Distance { get; set; }
}

public static class ReceptionReportEndpoints
{
    public static string PhoneKey(string phone) => Regex.Replace(Regex.Replace(phone, @"[^0-9+]", ""), @"^(00970|00972|\+970|\+972|0)", "");

    public static void MapReceptionReports(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/reception/reports").RequireAuthorization("rides.read");
        api.MapGet("/drivers", async (string? search, int? page, TaxiDb db, CancellationToken cancellationToken) => {
            if(page < 1 || page > 100000) return Results.BadRequest();
            var query = db.Set<Driver>().AsNoTracking();
            if (!string.IsNullOrWhiteSpace(search)) { var value=search.Trim(); var phone=PhoneKey(value); query = query.Where(d => d.FullName.Contains(value) || (phone!="" && d.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(phone))); }
            return Results.Ok(await query.OrderBy(d => d.FullName).ThenBy(d=>d.Id).Skip(((page??1)-1)*50).Take(50).Select(d => new { d.Id, d.FullName, d.Phone }).ToListAsync(cancellationToken));
        });
        api.MapGet("/history", async (Guid? driverId, Guid? customerId, DateOnly? from, DateOnly? to, int? page, string? sort, string? kind, string? search, string? status, string? source, string? fareMode, string? fareSource, TaxiDb db, TenantContext tenant, HttpContext http) => {
            var cancellationToken = http.RequestAborted;
            var orders = kind == "orders";
            if ((orders ? customerId.HasValue : driverId.HasValue == customerId.HasValue) || from > to || page < 1 || page > 100000 || search?.Length > 150 || status?.Length > 40 || source?.Length > 30) return Results.BadRequest();
            var needle = search?.Trim().ToLowerInvariant() ?? ""; var state = status ?? ""; var origin = source ?? "";
            if(fareMode is not null && !Services.RideFare.Modes.Contains(fareMode))return Results.BadRequest();
            var fareFilter=fareMode??"";
            if(fareSource is not null && !Services.RideFare.Modes.Contains(fareSource))return Results.BadRequest();
            var fareSourceFilter=fareSource??"";
            var phone = ""; var secondary = "";
            if (customerId.HasValue) {
                if (!http.User.HasClaim("permission", "customers.read")) return Results.Forbid();
                // Read only existing profile columns so older office databases remain supported.
                var customer = await CustomerEndpoints.LegacyQuery(db).AsNoTracking().SingleOrDefaultAsync(c => c.Id == customerId, cancellationToken);
                if (customer is null) return Results.NotFound();
                phone = PhoneKey(customer.Phone);
                if (await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Customer' AND column_name='SecondaryPhone') AS \"Value\"").SingleAsync(cancellationToken))
                    secondary = PhoneKey(await db.Set<Customer>().Where(c => c.Id == customerId).Select(c => c.SecondaryPhone).SingleAsync(cancellationToken));
            }
            var driver = driverId?.ToString() ?? ""; var customerKey = customerId?.ToString() ?? "";
            var start = from?.ToString("yyyy-MM-dd") ?? "0001-01-01"; var end = to?.ToString("yyyy-MM-dd") ?? "9999-12-31";
            // Filter and count in PostgreSQL; only one page of payloads leaves the server.
            // Calls already represented by an order are counted once.
            var rows = db.Database.SqlQuery<ReceptionReportRow>($"""
                SELECT h."Id", h."Day", h."Time", h.p::text AS "Payload",
                  coalesce(h.p->>'status','') AS "State", coalesce(h.p->>'source','MANUAL') AS "Origin",
                  coalesce(h.p->>'driverId','') AS "Driver", coalesce(h.p->>'neighborhood','') AS "Area", coalesce(h.p->>'fareMode','OFFICE_MANUAL') AS "FareMode", coalesce(h.p->>'currency','ILS') AS "Currency",
                  coalesce((h.p->>'finalFare')::numeric,(h.p->>'totalFare')::numeric,0) AS "Fare", coalesce((h.p->>'distanceKm')::numeric,0) AS "Distance" FROM (
                  SELECT o."ExternalId" AS "Id", o."Day", (o."Payload"->>'createdAt')::timestamptz AS "Time", o."Payload" || jsonb_build_object('destination',q."Destination",'driverName',d."FullName") || CASE WHEN r."Id" IS NULL THEN jsonb_build_object() ELSE jsonb_build_object('fareMode',r."FareMode",'fareSource',r."FareSource",'finalFare',r."FinalFare",'meterCalculatedFare',r."MeterCalculatedFare",'currency',r."Currency",'distanceKm',r."DistanceKm",'durationSeconds',r."DurationSeconds",'waitingSeconds',r."WaitingSeconds",'fareUpdatedBy',r."FareUpdatedBy",'fareUpdatedAt',r."FareUpdatedAt") END AS p
                  FROM "ReceptionOrder" o LEFT JOIN "Ride" r ON r."TenantId"=o."TenantId" AND r."RideRequestId"=o."RideRequestId" LEFT JOIN "RideRequest" q ON q."TenantId"=o."TenantId" AND q."Id"=o."RideRequestId" LEFT JOIN "Driver" d ON d."TenantId"=o."TenantId" AND d."Id"=r."DriverId" WHERE o."TenantId"={tenant.TenantId} AND o."Day">={start} AND o."Day"<={end}
                  UNION ALL
                  SELECT c."EventId", to_char((c."Payload"->>'timestamp')::timestamptz AT TIME ZONE 'Asia/Jerusalem','YYYY-MM-DD'),
                    (c."Payload"->>'timestamp')::timestamptz,
                    c."Payload" || jsonb_build_object('id',c."EventId",'createdAt',c."Payload"->>'timestamp','passengerPhone',c."Payload"->>'phone','recordType','CALL')
                  FROM "ReceptionCall" c WHERE c."TenantId"={tenant.TenantId} AND {driver}='' AND NOT {orders}
                    AND NOT EXISTS (SELECT 1 FROM "ReceptionOrder" o LEFT JOIN "Ride" r ON r."TenantId"=o."TenantId" AND r."RideRequestId"=o."RideRequestId" WHERE o."TenantId"=c."TenantId" AND o."EventId"=c."EventId")
                ) h
                WHERE h."Day">={start} AND h."Day"<={end} AND (
                  {orders} OR ({driver}<>'' AND (h.p->>'driverId'={driver} OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.p->'reassignmentLog')='array' THEN h.p->'reassignmentLog' ELSE '[]'::jsonb END) a
                    WHERE a->>'previousDriverId'={driver} OR a->>'newDriverId'={driver})))
                  OR ({customerKey}<>'' AND (h.p->>'customerId'={customerKey}
                    OR (coalesce(h.p->>'customerId','') IN ('','00000000-0000-0000-0000-000000000000') AND (
                      ({phone}<>'' AND regexp_replace(regexp_replace(h.p->>'passengerPhone','[^0-9+]','','g'),'^(00970|00972|\+970|\+972|0)','')={phone})
                      OR ({secondary}<>'' AND regexp_replace(regexp_replace(h.p->>'passengerPhone','[^0-9+]','','g'),'^(00970|00972|\+970|\+972|0)','')={secondary})))))
                )
                AND (NOT {orders} OR {driver}='' OR h.p->>'driverId'={driver})
                AND ({state}='' OR h.p->>'status'={state} OR ({state}='active' AND h.p->>'status' NOT IN ('completed','cancelled')))
                AND ({origin}='' OR h.p->>'source'={origin})
                AND ({fareFilter}='' OR coalesce(h.p->>'fareMode','OFFICE_MANUAL')={fareFilter})
                AND ({fareSourceFilter}='' OR h.p->>'fareSource'={fareSourceFilter} OR ({fareSourceFilter}='OFFICE_MANUAL' AND h.p->>'fareSource'='OFFICE_OVERRIDE'))
                AND ({needle}='' OR strpos(lower(concat_ws(' ',h."Id",h.p->>'passengerName',h.p->>'passengerPhone',h.p->>'orderNumber',h.p->>'addressText',h.p->'pickup'->>'name',h.p->'dropoff'->>'name',h.p->>'destination',h.p->>'notes',h.p->>'neighborhood',h.p->>'street',h.p->>'status',h.p->>'source',h.p->>'finalFare',h.p->>'totalFare',
                  CASE h.p->>'status' WHEN 'pending' THEN 'بانتظار سائق' WHEN 'waiting' THEN 'انتظار' WHEN 'assigned' THEN 'تم الإرسال' WHEN 'driver-accepted' THEN 'مقبول' WHEN 'driver-arriving' THEN 'في الطريق' WHEN 'arrived' THEN 'وصل' WHEN 'in-progress' THEN 'الرحلة جارية' WHEN 'completed' THEN 'مكتمل' WHEN 'cancelled' THEN 'ملغي' END,
                  CASE h.p->>'source' WHEN 'CUSTOMER_APP' THEN 'تطبيق الزبون' WHEN 'MANUAL' THEN 'المكتب' WHEN 'WHATSAPP' THEN 'واتساب' WHEN 'LANDLINE_ICALL' THEN 'الهاتف الأرضي' END,
                  h.p->>'driverName')),{needle})>0)
                """);
            var total = await rows.CountAsync(cancellationToken);
            var totalOrders = orders ? await db.Set<ReceptionOrder>().CountAsync(cancellationToken) : total;
            var currentPage = page ?? 1;
            var ordered=sort=="oldest"?rows.OrderBy(r=>r.Time).ThenBy(r=>r.Id):rows.OrderByDescending(r=>r.Time).ThenByDescending(r=>r.Id);
            var items = await ordered.Skip((currentPage - 1) * 50).Take(50).ToListAsync(cancellationToken);
            var fareTotals=await rows.Where(r=>r.State=="completed").GroupBy(r=>new{r.FareMode,r.Currency}).Select(g=>new{mode=g.Key.FareMode,currency=g.Key.Currency,count=g.Count(),value=g.Sum(r=>r.Fare),distanceKm=g.Sum(r=>r.Distance)}).ToListAsync(cancellationToken);
            var driverTotals=await rows.Where(r=>r.State=="completed").GroupBy(r=>new{r.Driver,r.FareMode,r.Currency}).Select(g=>new{driverId=g.Key.Driver,mode=g.Key.FareMode,currency=g.Key.Currency,count=g.Count(),value=g.Sum(r=>r.Fare),distanceKm=g.Sum(r=>r.Distance)}).OrderBy(g=>g.driverId).ThenBy(g=>g.mode).Take(600).ToListAsync(cancellationToken);
            var summary = orders ? new {
                statuses = await rows.GroupBy(r => r.State).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync(cancellationToken),
                sources = await rows.GroupBy(r => r.Origin).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync(cancellationToken),
                drivers = await rows.GroupBy(r => r.Driver).Select(g => new { key = g.Key, count = g.Count() }).OrderByDescending(r => r.count).Take(200).ToListAsync(cancellationToken),
                areas = await rows.Where(r => r.Area != "").GroupBy(r => r.Area).Select(g => new { key = g.Key, count = g.Count() }).OrderByDescending(r => r.count).Take(8).ToListAsync(cancellationToken)
            } : null;
            var ids = items.Select(i => i.Id).ToList();
            var pageRides = await (from o in db.Set<ReceptionOrder>() join r in db.Set<Ride>() on o.RideRequestId equals r.RideRequestId where ids.Contains(o.ExternalId) select new { o.ExternalId, r.Id, r.DriverId }).ToListAsync(cancellationToken);
            var rideIds = pageRides.Select(r => r.Id).ToList();
            var times = await db.Set<AuditLog>().Where(a => rideIds.Contains(a.EntityId) && (a.Action == "ride.notification.Accepted" || a.Action == "ride.notification.DriverArriving" || a.Action == "ride.notification.Arrived" || a.Action == "ride.notification.InProgress" || a.Action == "ride.notification.Completed"))
                .GroupBy(a => new { a.EntityId, a.Action }).Select(g => new { g.Key.EntityId, g.Key.Action, Time = g.Min(a => a.CreatedAt) }).ToListAsync(cancellationToken);
            var driverIds = pageRides.Where(r => r.DriverId.HasValue).Select(r => r.DriverId!.Value).ToList();
            var names = await db.Set<Driver>().Where(d => driverIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.FullName, cancellationToken);
            var projected = items.Select(item => {
                var data = JsonNode.Parse(item.Payload)!.AsObject();
                var ride = pageRides.FirstOrDefault(r => r.ExternalId == item.Id);
                if (ride is not null) {
                    if (ride.DriverId.HasValue) data["driverName"] = names.GetValueOrDefault(ride.DriverId.Value);
                    foreach (var (action, key) in new[] { ("Accepted", "acceptedAt"), ("DriverArriving", "arrivingAt"), ("Arrived", "arrivedAt"), ("InProgress", "startedAt"), ("Completed", "completedAt") }) {
                        var time = times.FirstOrDefault(t => t.EntityId == ride.Id && t.Action == "ride.notification." + action);
                        if (time is not null) data[key] = time.Time;
                    }
                }
                return data;
            });
            return Results.Ok(new { total, totalOrders, page = currentPage, pageSize = 50, summary, fareTotals, driverTotals, items = projected });
        });
    }
}
