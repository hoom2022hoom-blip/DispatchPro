using System.Text.Json.Nodes;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using DispatchPro.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public sealed class CustomerHistoryRow
{
    public string Id { get; set; } = "";
    public Guid? RideId { get; set; }
    public DateTimeOffset Time { get; set; }
    public string Payload { get; set; } = "{}";
    public string State { get; set; } = "";
}
public sealed class CustomerHistoryStats
{
    public Guid Id { get; set; }
    public int Count { get; set; }
    public DateTimeOffset? First { get; set; }
    public DateTimeOffset? Last { get; set; }
}

// Read-only projections of existing tenant-scoped orders, calls, offers and audit records.
public static class CustomerHistoryEndpoints
{
    public static Task<Dictionary<Guid,CustomerHistoryStats>> SearchStats(TaxiDb db,Guid[] ids) => db.Database.SqlQuery<CustomerHistoryStats>($"""
        SELECT c."Id",count(h."Id")::int AS "Count",min(h."Time") AS "First",max(h."Time") AS "Last"
        FROM "Customer" c LEFT JOIN LATERAL (
          SELECT q."Id"::text AS "Id",q."CreatedAt" AS "Time" FROM "RideRequest" q WHERE q."TenantId"=c."TenantId" AND (
            q."CustomerId"=c."Id" OR (q."CustomerId" IS NULL AND
            regexp_replace(regexp_replace(q."PassengerPhone",'[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')<>'' AND
            regexp_replace(regexp_replace(q."PassengerPhone",'[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','') IN (regexp_replace(regexp_replace(c."Phone",'[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)',''),regexp_replace(regexp_replace(to_jsonb(c)->>'SecondaryPhone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)',''))))
          UNION ALL
          SELECT o."ExternalId",(o."Payload"->>'createdAt')::timestamptz FROM "ReceptionOrder" o WHERE o."TenantId"=c."TenantId" AND o."RideRequestId" IS NULL AND (
            o."Payload"->>'customerId'=c."Id"::text OR (coalesce(o."Payload"->>'customerId','') IN ('','00000000-0000-0000-0000-000000000000') AND
            regexp_replace(regexp_replace(o."Payload"->>'passengerPhone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')<>'' AND
            regexp_replace(regexp_replace(o."Payload"->>'passengerPhone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','') IN (regexp_replace(regexp_replace(c."Phone",'[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)',''),regexp_replace(regexp_replace(to_jsonb(c)->>'SecondaryPhone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)',''))))
        ) h ON TRUE WHERE c."TenantId"={db.CurrentTenant} AND c."Id"=ANY({ids}) GROUP BY c."Id"
        """).ToDictionaryAsync(s=>s.Id);
    public static void MapCustomerHistory(this WebApplication app)
    {
        app.MapGet("/api/v1/customers/{id:guid}/history", async (Guid id, string? kind, string? orderId, int? page, TaxiDb db, TenantContext tenant, HttpContext http) =>
        {
            if (page is < 1 or > 100000 || kind is not (null or "orders" or "calls" or "activity")) return Results.BadRequest();
            var ct=http.RequestAborted;
            var profile=await CustomerEndpoints.HasProfileColumns(db)?db.Set<Customer>().AsNoTracking():CustomerEndpoints.LegacyQuery(db).AsNoTracking();
            var customer=await profile.SingleOrDefaultAsync(c=>c.Id==id,ct);
            if(customer is null)return Results.NotFound();
            var phone=CustomerPhone.SearchKey(customer.Phone);var secondary=CustomerPhone.SearchKey(customer.SecondaryPhone);
            var orders=Orders(db,tenant.TenantId,id,phone,secondary);
            var stats=await orders.GroupBy(_=>1).Select(g=>new{totalOrders=g.Count(),completedOrders=g.Count(r=>r.State=="Completed"||r.State=="completed"),firstOrderAt=(DateTimeOffset?)g.Min(r=>r.Time),lastOrderAt=(DateTimeOffset?)g.Max(r=>r.Time)}).SingleOrDefaultAsync(ct);
            var rows=kind=="calls"?Calls(db,tenant.TenantId,id,phone,secondary):kind=="activity"?Activity(db,tenant.TenantId,id,phone,secondary):orders;
            if(orderId is not null)rows=rows.Where(r=>r.Id==orderId);
            var total=await rows.CountAsync(ct);var current=page??1;
            var items=await rows.OrderByDescending(r=>r.Time).ThenByDescending(r=>r.Id).Skip((current-1)*25).Take(25).ToListAsync(ct);
            // Fetch all events for this page in two bounded queries, never one query per ride.
            var rideIds=items.Where(r=>r.RideId.HasValue).Select(r=>r.RideId!.Value).Distinct().ToArray();
            var externalIds=items.Select(r=>r.Id).ToArray();
            var requestIds=kind is null or "orders"?items.Select(r=>Guid.TryParse(JsonNode.Parse(r.Payload)?["requestId"]?.ToString(),out var request)?request:Guid.Empty).Where(id=>id!=Guid.Empty).ToArray():[];
            var pageOrders=kind is null or "orders"?await db.Set<ReceptionOrder>().AsNoTracking().Where(o=>externalIds.Contains(o.ExternalId)).Select(o=>new{o.Id,o.ExternalId,o.RideRequestId}).ToListAsync(ct):[];
            var relatedIds=rideIds.Concat(pageOrders.Select(o=>o.Id)).Concat(requestIds).Concat(pageOrders.Where(o=>o.RideRequestId.HasValue).Select(o=>o.RideRequestId!.Value)).ToArray();
            var audits=kind is null or "orders"?await db.Set<AuditLog>().AsNoTracking().Where(a=>relatedIds.Contains(a.EntityId)).OrderBy(a=>a.CreatedAt).Select(a=>new{a.Id,a.EntityId,a.Action,a.Detail,a.CreatedAt,a.ActorId}).ToListAsync(ct):[];
            var offers=kind is null or "orders"?await (from o in db.Set<RideOffer>().AsNoTracking() join d in db.Set<Driver>() on o.DriverId equals d.Id where rideIds.Contains(o.RideId) orderby o.OfferedAt select new{o.Id,o.RideId,o.DriverId,driver=d.FullName,o.OfferedAt,o.ExpiresAt,o.Outcome}).ToListAsync(ct):[];
            var payloads=items.Select(r=>{
                JsonObject p;try{p=JsonNode.Parse(r.Payload) as JsonObject??new JsonObject();}catch{p=new JsonObject{["detail"]=r.Payload};}p["id"]=r.Id;p["createdAt"]=r.Time;p["eventType"]=r.State;
                if(kind is null or "orders"){
                    var order=pageOrders.FirstOrDefault(o=>o.ExternalId==r.Id);
                    Guid.TryParse(p["requestId"]?.ToString(),out var requestId);
                    var events=audits.Where(a=>a.EntityId==r.RideId||a.EntityId==order?.Id||a.EntityId==order?.RideRequestId||a.EntityId==requestId).ToArray();
                    p["auditEvents"]=System.Text.Json.JsonSerializer.SerializeToNode(events,new System.Text.Json.JsonSerializerOptions{PropertyNamingPolicy=System.Text.Json.JsonNamingPolicy.CamelCase});
                    p["offers"]=System.Text.Json.JsonSerializer.SerializeToNode(offers.Where(o=>o.RideId==r.RideId),new System.Text.Json.JsonSerializerOptions{PropertyNamingPolicy=System.Text.Json.JsonNamingPolicy.CamelCase});
                    foreach(var (action,key) in new[]{("Assigned","sentAt"),("Accepted","acceptedAt"),("DriverArriving","arrivingAt"),("Arrived","arrivedAt"),("InProgress","startedAt"),("Completed","completedAt"),("Cancelled","cancelledAt")}){
                        var recorded=events.FirstOrDefault(a=>a.Action=="ride.notification."+action);if(recorded is not null)p[key]=recorded.CreatedAt;
                    }
                }return p;
            }).ToArray();
            var addresses=await db.Set<SavedAddress>().AsNoTracking().Where(a=>a.CustomerId==id).OrderByDescending(a=>a.IsDefault).ThenBy(a=>a.CreatedAt).Take(50).ToListAsync(ct);
            bool? callHistoryAvailable=kind=="calls"?await db.Set<ReceptionCall>().AsNoTracking().AnyAsync(ct):null;
            return Results.Ok(new{customer=new{customer.Id,customer.FullName,phone=CustomerPhone.Display(customer.Phone),customer.SecondaryPhone,customer.Notes,addresses},summary=new{totalOrders=stats?.totalOrders??0,completedOrders=stats?.completedOrders??0,firstOrderAt=stats?.firstOrderAt,lastOrderAt=stats?.lastOrderAt},total,page=current,pageSize=25,items=payloads,callHistoryAvailable});
        }).RequireAuthorization("customers.read","rides.read");
    }

    private static IQueryable<CustomerHistoryRow> Orders(TaxiDb db,Guid tenant,Guid customer,string phone,string secondary) => db.Database.SqlQuery<CustomerHistoryRow>($"""
        SELECT h."Id",h."RideId",h."Time",h.p::text AS "Payload",coalesce(h.p->>'status','Pending') AS "State" FROM (
          SELECT coalesce(o."ExternalId",q."Id"::text) AS "Id",r."Id" AS "RideId",q."CreatedAt" AS "Time",
            coalesce(o."Payload",jsonb_build_object()) || jsonb_build_object(
              'rideId',r."Id",'requestId',q."Id",'orderNumber',o."Number",'passengerName',q."PassengerName",'passengerPhone',q."PassengerPhone",
              'pickup',q."Pickup",'addressText',q."AddressText",'latitude',q."Latitude",'longitude',q."Longitude",'destination',q."Destination",
              'destinationLatitude',q."DestinationLatitude",'destinationLongitude',q."DestinationLongitude",'source',q."Source",'notes',q."Notes",
              'status',CASE r."Status" WHEN 0 THEN 'Pending' WHEN 1 THEN 'Assigned' WHEN 2 THEN 'Accepted' WHEN 3 THEN 'Arrived' WHEN 4 THEN 'InProgress' WHEN 5 THEN 'Completed' WHEN 6 THEN 'Cancelled' WHEN 7 THEN 'DriverArriving' WHEN 8 THEN 'Rejected' WHEN 9 THEN 'NoDriverAvailable' END,
              'driverId',r."DriverId",'driverName',d."FullName",'vehiclePlate',v."Plate",'vehicleMake',v."Make",'vehicleModel',v."Model",
              'fareMode',r."FareMode",'fareSource',r."FareSource",'currency',r."Currency",'finalFare',r."FinalFare",'meterCalculatedFare',r."MeterCalculatedFare",
              'fareUpdatedAt',r."FareUpdatedAt",'meterStartedAt',r."MeterStartedAt",'meterStoppedAt',r."MeterStoppedAt") AS p
          FROM "RideRequest" q
          LEFT JOIN "ReceptionOrder" o ON o."TenantId"=q."TenantId" AND o."RideRequestId"=q."Id"
          LEFT JOIN "Ride" r ON r."TenantId"=q."TenantId" AND r."RideRequestId"=q."Id"
          LEFT JOIN "Driver" d ON d."TenantId"=q."TenantId" AND d."Id"=r."DriverId"
          LEFT JOIN LATERAL (SELECT a."VehicleId" FROM "DriverVehicleAssignment" a WHERE a."TenantId"=q."TenantId" AND a."DriverId"=r."DriverId" AND a."StartedAt"<=q."CreatedAt" AND (a."EndedAt" IS NULL OR a."EndedAt">=q."CreatedAt") ORDER BY a."StartedAt" DESC LIMIT 1) va ON TRUE
          LEFT JOIN "Vehicle" v ON v."TenantId"=q."TenantId" AND v."Id"=va."VehicleId"
          WHERE q."TenantId"={tenant} AND (q."CustomerId"={customer} OR (q."CustomerId" IS NULL AND (
            ({phone}<>'' AND regexp_replace(regexp_replace(q."PassengerPhone",'[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')={phone}) OR
            ({secondary}<>'' AND regexp_replace(regexp_replace(q."PassengerPhone",'[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')={secondary}))))
          UNION ALL
          SELECT o."ExternalId",NULL::uuid,(o."Payload"->>'createdAt')::timestamptz,o."Payload"
          FROM "ReceptionOrder" o WHERE o."TenantId"={tenant} AND o."RideRequestId" IS NULL AND (
            o."Payload"->>'customerId'={customer.ToString()} OR (coalesce(o."Payload"->>'customerId','') IN ('','00000000-0000-0000-0000-000000000000') AND (
            ({phone}<>'' AND regexp_replace(regexp_replace(o."Payload"->>'passengerPhone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')={phone}) OR
            ({secondary}<>'' AND regexp_replace(regexp_replace(o."Payload"->>'passengerPhone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')={secondary}))))
        ) h
        """);

    private static IQueryable<CustomerHistoryRow> Calls(TaxiDb db,Guid tenant,Guid customer,string phone,string secondary)=>db.Database.SqlQuery<CustomerHistoryRow>($"""
        SELECT c."EventId" AS "Id",r."Id" AS "RideId",coalesce((c."Payload"->>'timestamp')::timestamptz,c."ReceivedAt") AS "Time",''::text AS "State",
          (c."Payload" || jsonb_build_object('receivedAt',c."ReceivedAt",'orderId',o."ExternalId",'rideId',r."Id",'driverName',d."FullName"))::text AS "Payload"
        FROM "ReceptionCall" c LEFT JOIN "ReceptionOrder" o ON o."TenantId"=c."TenantId" AND o."EventId"=c."EventId"
        LEFT JOIN "RideRequest" q ON q."TenantId"=o."TenantId" AND q."Id"=o."RideRequestId"
        LEFT JOIN "Ride" r ON r."TenantId"=c."TenantId" AND r."RideRequestId"=o."RideRequestId"
        LEFT JOIN "Driver" d ON d."TenantId"=c."TenantId" AND d."Id"=r."DriverId"
        WHERE c."TenantId"={tenant} AND (q."CustomerId"={customer} OR (q."CustomerId" IS NULL AND (
          ({phone}<>'' AND regexp_replace(regexp_replace(c."Payload"->>'phone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')={phone}) OR
          ({secondary}<>'' AND regexp_replace(regexp_replace(c."Payload"->>'phone','[^0-9+]','','g'),'^(00970|00972|\+?970|\+?972|0)','')={secondary}))))
        """);

    private static IQueryable<CustomerHistoryRow> Activity(TaxiDb db,Guid tenant,Guid customer,string phone,string secondary)
    {
        // Compose SQL subqueries with parameters retained by EF. UNION is translated in PostgreSQL.
        var orders=Orders(db,tenant,customer,phone,secondary);
        var creation=orders.Select(r=>new CustomerHistoryRow{Id=r.Id,RideId=r.RideId,Time=r.Time,State="order.created",Payload=r.Payload});
        var ids=orders.Where(r=>r.RideId.HasValue).Select(r=>r.RideId!.Value);
        var externalIds=orders.Select(r=>r.Id);
        var receptionIds=db.Set<ReceptionOrder>().Where(o=>externalIds.Contains(o.ExternalId)).Select(o=>o.Id);
        var requestIds=db.Set<Ride>().Where(r=>ids.Contains(r.Id)).Select(r=>r.RideRequestId);
        var audits=db.Set<AuditLog>().AsNoTracking().Where(a=>ids.Contains(a.EntityId)||receptionIds.Contains(a.EntityId)||requestIds.Contains(a.EntityId)).Select(a=>new CustomerHistoryRow{Id=a.Id.ToString(),RideId=a.EntityId,Time=a.CreatedAt,State=a.Action,Payload=a.Detail==""?"{}":a.Detail});
        var calls=Calls(db,tenant,customer,phone,secondary).Select(r=>new CustomerHistoryRow{Id=r.Id,RideId=r.RideId,Time=r.Time,State="call",Payload=r.Payload});
        var offers=db.Set<RideOffer>().AsNoTracking().Where(o=>ids.Contains(o.RideId)).Select(o=>new CustomerHistoryRow{Id=o.Id.ToString(),RideId=o.RideId,Time=o.OfferedAt,State="offer.sent",Payload="{\"driverId\":\""+o.DriverId.ToString()+"\"}"});
        return creation.Concat(audits).Concat(calls).Concat(offers);
    }
}
