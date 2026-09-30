using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using DispatchPro.Api.Infrastructure;

namespace DispatchPro.Api.Services;

// A wake-up hint only. Durable notices remain in the existing tenant audit log.
public sealed class NotificationSignal
{
    private TaskCompletionSource pulse = NewPulse();
    private static TaskCompletionSource NewPulse() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task Changed => Volatile.Read(ref pulse).Task;
    public void Publish() => Interlocked.Exchange(ref pulse, NewPulse()).TrySetResult();
}

public sealed class NotificationCommitInterceptor(NotificationSignal signal) : DbTransactionInterceptor
{
    public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        // Read-only snapshots must not wake themselves (or other subscribers).
        if (eventData.Context is TaxiDb { PendingNotification: true } db)
        {
            db.PendingNotification = false;
            signal.Publish();
        }
        return Task.CompletedTask;
    }
    public override Task TransactionRolledBackAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        if (eventData.Context is TaxiDb db) db.PendingNotification = false;
        return Task.CompletedTask;
    }
}
