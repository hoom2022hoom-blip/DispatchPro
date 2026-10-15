using DispatchPro.Api.Domain;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace DispatchPro.Api.Services;

// Reception and GRIDCMS consume the accepted event independently; neither gates the other.
public sealed class OfficeCallsWorker(IServiceScopeFactory scopes, ILogger<OfficeCallsWorker> logger) : BackgroundService
{
    private DateTimeOffset nextRetentionCheck = DateTimeOffset.MinValue;
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunOnce(stoppingToken); }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested) { logger.LogWarning("OfficeCalls worker {ErrorType}", error.GetType().Name); }
            try { await Task.Delay(2000, stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }
    public async Task RunOnce(CancellationToken cancellationToken = default)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<TaxiDb>();
        if (DateTimeOffset.UtcNow >= nextRetentionCheck) {
            var cutoff = DateTimeOffset.UtcNow.AddDays(-30);
            var old = await db.Set<OfficeCallEvent>().IgnoreQueryFilters().Where(e => e.AcceptedAt < cutoff && e.Phone != "").Select(e => new { e.Id, e.TenantId }).Take(1000).ToArrayAsync(cancellationToken);
            foreach (var item in old) {
                using var retentionScope = scopes.CreateScope(); retentionScope.ServiceProvider.GetRequiredService<TenantContext>().TenantId = item.TenantId;
                var retentionDb = retentionScope.ServiceProvider.GetRequiredService<TaxiDb>(); var row = await retentionDb.Set<OfficeCallEvent>().SingleAsync(e => e.Id == item.Id, cancellationToken);
                row.Phone = ""; if (row.DispatchStatus == "PENDING") row.DispatchStatus = "EXPIRED"; if (row.GridStatus == "PENDING") row.GridStatus = "EXPIRED";
                await retentionDb.SaveChangesAsync(cancellationToken);
            }
            nextRetentionCheck = DateTimeOffset.UtcNow.AddHours(1);
        }
        var ids = await db.Set<OfficeCallEvent>().IgnoreQueryFilters().Where(e => (e.DispatchStatus == "PENDING" || e.GridStatus == "PENDING") && e.NextAttempt <= DateTimeOffset.UtcNow).OrderBy(e => e.Timestamp).Take(50).Select(e => new { e.Id, e.TenantId }).ToArrayAsync(cancellationToken);
        foreach (var id in ids)
        {
            using var eventScope = scopes.CreateScope(); var context = eventScope.ServiceProvider.GetRequiredService<TenantContext>(); context.TenantId = id.TenantId;
            var eventDb = eventScope.ServiceProvider.GetRequiredService<TaxiDb>(); var e = await eventDb.Set<OfficeCallEvent>().SingleAsync(x => x.Id == id.Id, cancellationToken);
            context.ActorId = e.DeviceId;
            if (!OfficeCallsEndpointsFresh(e.Timestamp)) {
                if (e.DispatchStatus == "PENDING") e.DispatchStatus = "EXPIRED";
                if (e.GridStatus == "PENDING") e.GridStatus = "EXPIRED";
            } else if (e.DispatchStatus == "PENDING") {
                try {
                    await eventScope.ServiceProvider.GetRequiredService<ReceptionService>().Receive(new ReceptionEvent(e.EventId, "WHATSAPP", e.Phone, e.Timestamp.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")));
                    e.DispatchStatus = "DELIVERED"; e.DispatchError = "";
                } catch (Exception error) { eventDb.ChangeTracker.Clear(); e = await eventDb.Set<OfficeCallEvent>().SingleAsync(x => x.Id == id.Id, cancellationToken); e.DispatchError = error is ReceptionConflictException ? "RECEPTION_CONFLICT_OR_FEATURE_DISABLED" : error.GetType().Name; }
            }
            e.Attempts++; e.NextAttempt = DateTimeOffset.UtcNow.AddSeconds(Math.Min(30, Math.Pow(2, Math.Min(e.Attempts, 5))));
            await eventDb.SaveChangesAsync(cancellationToken);
        }
    }
    private static bool OfficeCallsEndpointsFresh(DateTimeOffset time) => Endpoints.OfficeCallsEndpoints.Fresh(time, DateTimeOffset.UtcNow);
}
