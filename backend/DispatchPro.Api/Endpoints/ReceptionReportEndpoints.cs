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
}

public static class ReceptionReportEndpoints
{
    public static string PhoneKey(string phone) => Regex.Replace(Regex.Replace(phone, @"[^0-9+]", ""), @"^(00970|00972|\+970|\+972|0)", "");

    public static void MapReceptionReports(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/reception/reports").RequireAuthorization("rides.read");
        api.MapGet("/drivers", async (string? search, int? page, TaxiDb db) => {
            if(page < 1 || page > 100000) return Results.BadRequest();
            var query = db.Set<Driver>().AsNoTracking();
            if (!string.IsNullOrWhiteSpace(search)) { var value=search.Trim(); var phone=PhoneKey(value); query = query.Where(d => d.FullName.Contains(value) || (phone!="" && d.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(phone))); }
            return Results.Ok(await query.OrderBy(d => d.FullName).ThenBy(d=>d.Id).Skip(((page??1)-1)*50).Take(50).Select(d => new { d.Id, d.FullName, d.Phone }).ToListAsync());
        });
        api.MapGet("/history", async (Guid? driverId, Guid? customerId, DateOnly? from, DateOnly? to, int? page, string? sort, string? kind, string? search, string? status, string? source, TaxiDb db, TenantContext tenant, HttpContext http) => {
            var orders = kind == "orders";
            if ((orders ? driverId.HasValue || customerId.HasValue : driverId.HasValue == customerId.HasValue) || from > to || page < 1 || page > 100000 || search?.Length > 150 || status?.Length > 40 || source?.Length > 30) return Results.BadRequest();
            var needle = search?.Trim().ToLowerInvariant() ?? ""; var state = status ?? ""; var origin = source ?? "";
            var phone = ""; var secondary = "";
            if (customerId.HasValue) {
                if (!http.User.HasClaim("permission", "customers.read")) return Results.Forbid();
                // Read only existing profile columns so older office databases remain supported.
                var customer = await CustomerEndpoints.LegacyQuery(db).AsNoTracking().SingleOrDefaultAsync(c => c.Id == customerId);
                if (customer is null) return Results.NotFound();
                phone = PhoneKey(customer.Phone);
                if (await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Customer' AND column_name='SecondaryPhone') AS \"Value\"").SingleAsync())
                    secondary = PhoneKey(await db.Set<Customer>().Where(c => c.Id == customerId).Select(c => c.SecondaryPhone).SingleAsync());
            }
            var driver = driverId?.ToString() ?? ""; var customerKey = customerId?.ToString() ?? "";
            var start = from?.ToString("yyyy-MM-dd") ?? "0001-01-01"; var end = to?.ToString("yyyy-MM-dd") ?? "9999-12-31";
            // Filter and count in PostgreSQL; only one page of payloads leaves the server.
            // Calls already represented by an order are counted once.
            var rows = db.Database.SqlQuery<ReceptionReportRow>($"""
                SELECT h."Id", h."Day", h."Time", h.p::text AS "Payload",
                  coalesce(h.p->>'status','') AS "State", coalesce(h.p->>'source','MANUAL') AS "Origin",
                  coalesce(h.p->>'driverId','') AS "Driver", coalesce(h.p->>'neighborhood','') AS "Area" FROM (
                  SELECT o."ExternalId" AS "Id", o."Day", (o."Payload"->>'createdAt')::timestamptz AS "Time", o."Payload" AS p
                  FROM "ReceptionOrder" o WHERE o."TenantId"={tenant.TenantId} AND o."Day">={start} AND o."Day"<={end}
                  UNION ALL
                  SELECT c."EventId", to_char((c."Payload"->>'timestamp')::timestamptz AT TIME ZONE 'Asia/Jerusalem','YYYY-MM-DD'),
                    (c."Payload"->>'timestamp')::timestamptz,
                    c."Payload" || jsonb_build_object('id',c."EventId",'createdAt',c."Payload"->>'timestamp','passengerPhone',c."Payload"->>'phone','recordType','CALL')
                  FROM "ReceptionCall" c WHERE c."TenantId"={tenant.TenantId} AND {driver}='' AND NOT {orders}
                    AND NOT EXISTS (SELECT 1 FROM "ReceptionOrder" o WHERE o."TenantId"=c."TenantId" AND o."EventId"=c."EventId")
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
                AND ({state}='' OR h.p->>'status'={state})
                AND ({origin}='' OR h.p->>'source'={origin})
                AND ({needle}='' OR strpos(lower(concat_ws(' ',h.p->>'passengerName',h.p->>'passengerPhone',h.p->>'orderNumber',h.p->>'addressText',h.p->'pickup'->>'name')),{needle})>0)
                """);
            var total = await rows.CountAsync();
            var currentPage = page ?? 1;
            var ordered=sort=="oldest"?rows.OrderBy(r=>r.Time).ThenBy(r=>r.Id):rows.OrderByDescending(r=>r.Time).ThenByDescending(r=>r.Id);
            var items = await ordered.Skip((currentPage - 1) * 50).Take(50).ToListAsync();
            var summary = orders ? new {
                statuses = await rows.GroupBy(r => r.State).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync(),
                sources = await rows.GroupBy(r => r.Origin).Select(g => new { key = g.Key, count = g.Count() }).ToListAsync(),
                drivers = await rows.GroupBy(r => r.Driver).Select(g => new { key = g.Key, count = g.Count() }).OrderByDescending(r => r.count).Take(200).ToListAsync(),
                areas = await rows.Where(r => r.Area != "").GroupBy(r => r.Area).Select(g => new { key = g.Key, count = g.Count() }).OrderByDescending(r => r.count).Take(8).ToListAsync()
            } : null;
            return Results.Ok(new { total, page = currentPage, pageSize = 50, summary, items = items.Select(r => JsonNode.Parse(r.Payload)) });
        });
    }
}
