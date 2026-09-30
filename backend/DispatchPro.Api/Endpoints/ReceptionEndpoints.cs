using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DispatchPro.Api.Services;
using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;
public sealed record ReceptionShiftInput(Guid DriverId, Guid VehicleId);
public sealed record BridgeCallInput(string Source, string CallerNumber, string EventId, string ReceivedAt, Guid TenantId, string? Line = null, LocationInput? Location = null);
public static class ReceptionEndpoints
{
    public static void MapReceptionEndpoints(this WebApplication app)
    {
        app.MapReceptionReports();
        var api = app.MapGroup("/api/v1/reception").RequireAuthorization();
        api.MapPost("/bridge/calls", async (BridgeCallInput input, TenantContext tenant, ReceptionService reception) => {
            if (input.TenantId != tenant.TenantId) return Results.Forbid();
            if (input.Source is not ("LANDLINE" or "WHATSAPP")) return Results.BadRequest();
            return Results.Ok(await reception.Receive(new ReceptionEvent(input.EventId, input.Source == "LANDLINE" ? "LANDLINE_ICALL" : "WHATSAPP", input.CallerNumber, input.ReceivedAt, input.Line, input.Location)));
        }).RequireAuthorization("reception.ingest");
        api.MapGet("/latest-call", async (ReceptionService reception) => {
            var call = (await reception.RecentCalls()).FirstOrDefault();
            return Results.Json(call is null ? null : JsonNode.Parse(call.Payload));
        }).RequireAuthorization("rides.read");
        api.MapPost("/calls", async (ReceptionEvent input, ReceptionService reception) => Results.Ok(await reception.Receive(input)))
            .RequireAuthorization(p => p.RequireAssertion(c => c.User.HasClaim("permission", "reception.ingest") || c.User.HasClaim("permission", "rides.write")));
        api.MapGet("/snapshot", async (bool? wait, ReceptionService reception, NotificationSignal signal, TaxiDb db, HttpContext context) =>
        {
            var deadline = DateTimeOffset.UtcNow.AddSeconds(25);
            while (true)
            {
                var changed = signal.Changed;
                db.ChangeTracker.Clear();
                var body = JsonSerializer.Serialize(await reception.Snapshot(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                var etag = "\"" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body))) + "\"";
                context.Response.Headers.ETag = etag; context.Response.Headers.CacheControl = "private, no-cache";
                if (context.Request.Headers.IfNoneMatch != etag) return Results.Text(body, "application/json");
                if (wait != true || DateTimeOffset.UtcNow >= deadline) return Results.StatusCode(304);
                try { await changed.WaitAsync(TimeSpan.FromMilliseconds(Math.Max(1, (deadline - DateTimeOffset.UtcNow).TotalMilliseconds)), context.RequestAborted); }
                catch (TimeoutException) { }
            }
        }).RequireAuthorization("rides.read");
        api.MapPut("/rides/{id}", async (string id, JsonObject input, ReceptionService reception, HttpContext http) => Results.Ok(await reception.Save(id, input, http.User.HasClaim("permission", "pricing.adjust")))).RequireAuthorization("rides.write");
        api.MapPost("/queue", async (ReceptionQueueAction input, ReceptionService reception) => { await reception.Queue(input); return Results.NoContent(); }).RequireAuthorization("rides.write");
        api.MapPost("/shifts", async (ReceptionShiftInput input, ReceptionService reception) => { await reception.StartShift(input.DriverId, input.VehicleId); return Results.NoContent(); }).RequireAuthorization("rides.write");
        api.MapPost("/shifts/{id:guid}/end", async (Guid id, ReceptionService reception) => { await reception.EndShift(id); return Results.NoContent(); }).RequireAuthorization("rides.write");
    }
}
