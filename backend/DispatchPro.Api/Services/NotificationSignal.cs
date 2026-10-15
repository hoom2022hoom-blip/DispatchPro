using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using DispatchPro.Api.Infrastructure;

namespace DispatchPro.Api.Services;

// A wake-up hint only. Durable notices remain in the existing tenant audit log.
public sealed class NotificationSignal
{
    private readonly object gate = new();
    private readonly Dictionary<Guid, Channel> channels = new();
    private TaskCompletionSource all = NewPulse();
    public Task AnyChange { get { lock (gate) return all.Task; } }
    private sealed class Channel
    {
        public int Subscribers;
        public TaskCompletionSource Pulse = NewPulse();
    }
    private static TaskCompletionSource NewPulse() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Subscription Subscribe(Guid tenantId)
    {
        lock (gate)
        {
            if (!channels.TryGetValue(tenantId, out var channel)) channels[tenantId] = channel = new();
            channel.Subscribers++;
            return new Subscription(channel.Pulse.Task, () => {
                lock (gate)
                {
                    if (--channel.Subscribers == 0) channels.Remove(tenantId);
                }
            });
        }
    }

    public void Publish(Guid tenantId)
    {
        TaskCompletionSource any;
        lock (gate) { any = all; all = NewPulse(); }
        any.TrySetResult();
        TaskCompletionSource pulse;
        lock (gate)
        {
            if (!channels.TryGetValue(tenantId, out var channel)) return;
            pulse = channel.Pulse;
            channel.Pulse = NewPulse();
        }
        pulse.TrySetResult();
    }

    // Only live requests retain a tenant channel; no permanent per-tenant cache.
    public sealed class Subscription(Task changed, Action release) : IDisposable
    {
        private Action? release = release;
        public Task Changed { get; } = changed;
        public void Dispose() => Interlocked.Exchange(ref release, null)?.Invoke();
    }
}

public sealed class NotificationCommitInterceptor(NotificationSignal signal) : DbTransactionInterceptor
{
    public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        // Read-only snapshots must not wake themselves (or other subscribers).
        if (eventData.Context is TaxiDb { PendingNotification: true } db)
        {
            db.PendingNotification = false;
            signal.Publish(db.CurrentTenant);
        }
        return Task.CompletedTask;
    }
    public override Task TransactionRolledBackAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is TaxiDb db) db.PendingNotification = false;
        return Task.CompletedTask;
    }
}
