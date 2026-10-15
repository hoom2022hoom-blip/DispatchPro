using System.Diagnostics;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DispatchPro.Api.Endpoints;

public static class HealthReadiness
{
    public static void MapReadiness(this WebApplication app) => app.MapGet("/health/ready", Check);

    public static async Task<IResult> Check(HttpContext http, TaxiDb db, IConfiguration config, ILoggerFactory loggers)
    {
        var logger = loggers.CreateLogger("DispatchPro.HealthReadiness");
        var elapsed = Stopwatch.StartNew();
        var probeId = Guid.TryParse(http.Request.Headers["X-DispatchPro-Probe-Id"], out var supplied) ? supplied.ToString() : "none";
        if (probeId != "none") http.Response.Headers["X-DispatchPro-Probe-Id"] = probeId;
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
        budget.CancelAfter(Math.Clamp(config.GetValue<int?>("Health:ReadinessTimeoutMilliseconds") ?? 5000, 100, 10000));
        var phase = "connection";
        var status = 503;
        var code = "READINESS_DATABASE_UNAVAILABLE";
        try
        {
            var connected = await db.Database.CanConnectAsync(budget.Token);
            // CanConnectAsync may translate provider cancellation into false.
            budget.Token.ThrowIfCancellationRequested();
            if (connected)
            {
                phase = "migrations";
                var pending = await db.Database.GetPendingMigrationsAsync(budget.Token);
                budget.Token.ThrowIfCancellationRequested();
                if (!pending.Any()) status = 200;
                else code = "READINESS_PENDING_MIGRATIONS";
            }
        }
        catch (OperationCanceledException) when (budget.IsCancellationRequested)
        {
            status = http.RequestAborted.IsCancellationRequested ? 499 : 503;
            code = status == 499 ? "READINESS_CLIENT_ABORTED" : "READINESS_TIMEOUT";
        }
        catch (Exception error)
        {
            code = "READINESS_DATABASE_ERROR";
            logger.LogWarning("Readiness database failure trace {TraceId} phase {Phase} type {ErrorType}", http.TraceIdentifier, phase, error.GetType().Name);
        }
        logger.LogInformation("Readiness probe {ProbeId} trace {TraceId} status {Status} code {Code} phase {Phase} elapsedMs {ElapsedMs} clientAborted {ClientAborted}",
            probeId, http.TraceIdentifier, status, status == 200 ? "READY" : code, phase, elapsed.ElapsedMilliseconds, http.RequestAborted.IsCancellationRequested);
        return status == 200 ? Results.Ok(new { status = "ready" }) : Results.Json(new { status = "unavailable", code, phase }, statusCode: status);
    }
}
