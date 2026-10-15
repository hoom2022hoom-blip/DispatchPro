using System.Linq.Expressions;
using DispatchPro.Api.Domain;
using Microsoft.EntityFrameworkCore;
using DispatchPro.Api.Services;

namespace DispatchPro.Api.Infrastructure;

public sealed class TenantContext
{
    public Guid TenantId { get; set; }
    public Guid ActorId { get; set; }
}

public sealed class TaxiDb(DbContextOptions<TaxiDb> options, TenantContext tenant, NotificationSignal? notifications = null) : DbContext(options)
{
    public Guid CurrentTenant => tenant.TenantId;
    internal bool PendingNotification { get; set; }
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.HasPostgresExtension("postgis");
        model.Entity<OfficeCallDevice>().HasIndex(x => x.TokenHash).IsUnique();
        model.Entity<OfficeCallEvent>().HasIndex(x => new { x.TenantId, x.EventId }).IsUnique();
        model.Entity<OfficeCallEvent>().HasIndex(x => new { x.DispatchStatus, x.NextAttempt });
        Link<OfficeCallEvent, OfficeCallDevice>(model, nameof(OfficeCallEvent.DeviceId));
        Link<OfficeCallPairing, OfficeCallDevice>(model, nameof(OfficeCallPairing.DeviceId));
        model.Entity<SuggestedPlace>().Property(p => p.Version).IsConcurrencyToken();
        model.Entity<SuggestedPlace>().HasIndex(p => new { p.TenantId, p.IsActive, p.SortOrder });
        model.Entity<Driver>().Property(d => d.Active).HasDefaultValue(true);
        model.Entity<Driver>().Property(d => d.VoiceEnabled).HasDefaultValue(true);
        model.Entity<Driver>().Property(d => d.CanListen).HasDefaultValue(true);
        model.Entity<Driver>().Property(d => d.CanTalkPublic).HasDefaultValue(true);
        model.Entity<Driver>().Property(d => d.CanTalkPrivate).HasDefaultValue(true);
        model.Entity<Vehicle>().Property(v => v.Active).HasDefaultValue(true);
        model.Entity<Tenant>().HasIndex(x => x.Slug).IsUnique();
        foreach (var type in typeof(TenantEntity).Assembly.GetTypes().Where(t => !t.IsAbstract && typeof(TenantEntity).IsAssignableFrom(t)))
        {
            var entity = model.Entity(type);
            entity.HasKey(nameof(TenantEntity.Id));
            entity.HasAlternateKey(nameof(TenantEntity.TenantId), nameof(TenantEntity.Id));
            entity.HasOne(typeof(Tenant)).WithMany().HasForeignKey(nameof(TenantEntity.TenantId)).OnDelete(DeleteBehavior.Restrict);
            var parameter = Expression.Parameter(type, "row");
            entity.HasQueryFilter(Expression.Lambda(Expression.Equal(Expression.Property(parameter, nameof(TenantEntity.TenantId)), Expression.Property(Expression.Constant(this), nameof(CurrentTenant))), parameter));
        }
        Link<User, Role>(model, nameof(User.RoleId));
        Link<Permission, Role>(model, nameof(Permission.RoleId));
        Link<Driver, User>(model, nameof(Driver.UserId));
        Link<Driver, Vehicle>(model, nameof(Driver.CurrentVehicleId));
        Link<DriverVehicleAssignment, Driver>(model, nameof(DriverVehicleAssignment.DriverId));
        Link<DriverVehicleAssignment, Vehicle>(model, nameof(DriverVehicleAssignment.VehicleId));
        Link<DriverVehicleAssignment, User>(model, nameof(DriverVehicleAssignment.ChangedBy));
        Link<ReceptionQueue, Driver>(model, nameof(ReceptionQueue.DriverId));
        Link<ReceptionQueue, QueueLocation>(model, nameof(ReceptionQueue.QueueLocationId));
        model.Entity<Driver>().HasIndex(d => new { d.TenantId, d.CurrentVehicleId }).IsUnique().HasFilter("\"CurrentVehicleId\" IS NOT NULL");
        model.Entity<DriverVehicleAssignment>().HasIndex(a => new { a.TenantId, a.DriverId }).IsUnique().HasFilter("\"EndedAt\" IS NULL");
        model.Entity<DriverVehicleAssignment>().HasIndex(a => new { a.TenantId, a.VehicleId }).IsUnique().HasFilter("\"EndedAt\" IS NULL");
        model.Entity<ReceptionQueue>().HasIndex(q => new { q.TenantId, q.DriverId }).IsUnique();
        Link<Vehicle, Driver>(model, nameof(Vehicle.DriverId));
        Link<Vehicle, VehicleClass>(model, nameof(Vehicle.VehicleClassId));
        Link<RideRequest, Customer>(model, nameof(RideRequest.CustomerId));
        Link<SavedAddress, Customer>(model, nameof(SavedAddress.CustomerId));
        Link<RideRequest, SavedAddress>(model, nameof(RideRequest.SavedAddressId));
        Link<ReceptionOrder, RideRequest>(model, nameof(ReceptionOrder.RideRequestId));
        model.Entity<ReceptionOrder>().HasIndex(x => new { x.TenantId, x.RideRequestId }).IsUnique();
        model.Entity<SavedAddress>().HasIndex(x => new { x.TenantId, x.CustomerId }).IsUnique().HasFilter("\"IsDefault\" = true");
        model.Entity<SavedAddress>().Property(x => x.Version).IsConcurrencyToken();
        Link<Ride, RideRequest>(model, nameof(Ride.RideRequestId));
        Link<Ride, Driver>(model, nameof(Ride.DriverId));
        Link<DriverJob, Driver>(model, nameof(DriverJob.DriverId));
        Link<DriverJob, Ride>(model, nameof(DriverJob.RideId));
        model.Entity<DriverJob>().HasIndex(j => new { j.TenantId, j.RideId }).IsUnique();
        model.Entity<DriverJob>().HasIndex(j => new { j.TenantId, j.DriverId, j.Position });
        model.Entity<DriverJob>().Property(j => j.Version).IsConcurrencyToken();
        model.Entity<Driver>().Property(d => d.DriverAppEnabled).HasDefaultValue(true);
        model.Entity<Driver>().Property(d => d.GpsEnabled).HasDefaultValue(true);
        model.Entity<DriverLocation>().Property(l => l.Source).HasDefaultValue("driver");
        model.Entity<DriverGpsPoint>().Property(p => p.Source).HasDefaultValue("driver");
        model.Entity<DriverGpsPoint>().Property(p => p.LocationAccepted).HasDefaultValue(true);
        Link<DriverLocation, Driver>(model, nameof(DriverLocation.DriverId));
        Link<DriverGpsPoint, Driver>(model, nameof(DriverGpsPoint.DriverId));
        Link<DriverGpsPoint, Ride>(model, nameof(DriverGpsPoint.RideId));
        model.Entity<DriverGpsPoint>().HasIndex(p => new { p.TenantId, p.DriverId, p.Timestamp });
        model.Entity<DriverGpsPoint>().HasIndex(p => new { p.TenantId, p.RideId, p.Timestamp });
        model.Entity<AuditLog>().HasIndex(p => new { p.TenantId, p.EntityId, p.CreatedAt });
        Link<RideOffer, Driver>(model, nameof(RideOffer.DriverId));
        Link<RideOffer, Ride>(model, nameof(RideOffer.RideId));
        model.Entity<DispatchPolicy>().HasIndex(x => x.TenantId).IsUnique();
        model.Entity<DriverLocation>().HasIndex(x => new { x.TenantId, x.DriverId }).IsUnique();
        model.Entity<DriverLocation>().Property(x => x.Position).HasColumnType("geography (point,4326)");
        model.Entity<DriverLocation>().HasIndex(x => x.Position).HasMethod("gist");
        model.Entity<RideOffer>().HasIndex(x => new { x.TenantId, x.RideId, x.DriverId }).IsUnique();
        Link<PricingRule, PricingProfile>(model, nameof(PricingRule.PricingProfileId));
        Link<FixedRoutePrice, PricingRule>(model, nameof(FixedRoutePrice.PricingRuleId));
        Link<ZonePrice, PricingRule>(model, nameof(ZonePrice.PricingRuleId));
        Link<RidePrice, Ride>(model, nameof(RidePrice.RideId));
        Link<RidePrice, PricingRule>(model, nameof(RidePrice.PricingRuleId));
        Link<PriceAdjustment, RidePrice>(model, nameof(PriceAdjustment.RidePriceId));
        Link<ReceptionShift, Driver>(model, nameof(ReceptionShift.DriverId));
        Link<ReceptionShift, Vehicle>(model, nameof(ReceptionShift.VehicleId));
        Link<ReceptionQueue, ReceptionShift>(model, nameof(ReceptionQueue.ShiftId));
        model.Entity<ReceptionOrder>().HasIndex(x => new { x.TenantId, x.ExternalId }).IsUnique();
        model.Entity<ReceptionOrder>().HasIndex(x => new { x.TenantId, x.EventId }).IsUnique();
        model.Entity<ReceptionOrder>().HasIndex(x => new { x.TenantId, x.Day, x.Number }).IsUnique();
        model.Entity<ReceptionOrder>().Property(x => x.Payload).HasColumnType("jsonb");
        model.Entity<ReceptionOrder>().Property(x => x.Version).IsConcurrencyToken();
        model.Entity<ReceptionCall>().HasIndex(x => new { x.TenantId, x.EventId }).IsUnique();
        model.Entity<ReceptionCall>().Property(x => x.Payload).HasColumnType("jsonb");
        model.Entity<ReceptionCounter>().HasIndex(x => new { x.TenantId, x.Day }).IsUnique();
        model.Entity<ReceptionShift>().HasIndex(x => new { x.TenantId, x.DriverId }).IsUnique().HasFilter("\"Active\" = true");
        model.Entity<ReceptionShift>().HasIndex(x => new { x.TenantId, x.VehicleId }).IsUnique().HasFilter("\"Active\" = true");
        model.Entity<ReceptionQueue>().HasIndex(x => new { x.TenantId, x.ShiftId }).IsUnique();
        model.Entity<User>().HasIndex(x => new { x.TenantId, x.Username }).IsUnique();
        model.Entity<Customer>().HasIndex(x => new { x.TenantId, x.Phone }).IsUnique();
        model.Entity<Driver>().HasIndex(x => new { x.TenantId, x.UserId }).IsUnique();
        model.Entity<FeatureFlag>().HasIndex(x => new { x.TenantId, x.Key }).IsUnique();
        model.Entity<Permission>().HasIndex(x => new { x.TenantId, x.RoleId, x.Code }).IsUnique();
        model.Entity<RidePrice>().HasIndex(x => new { x.TenantId, x.RideId }).IsUnique();
        model.Entity<Ride>().HasIndex(x => new { x.TenantId, x.RideRequestId }).IsUnique();
        model.Entity<Ride>().HasIndex(x => new { x.TenantId, x.DriverId }).IsUnique().HasFilter("\"DriverId\" IS NOT NULL AND \"Status\" IN (1, 2, 3, 4, 7)");
        model.Entity<Ride>().Property(x => x.Version).IsConcurrencyToken();
        model.Entity<RidePrice>().Property(x => x.Version).IsConcurrencyToken();
        model.Entity<ZonePrice>().Property(x => x.Boundary).HasColumnType("geometry");
        foreach (var property in model.Model.GetEntityTypes().SelectMany(e => e.GetProperties()).Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?))) { property.SetPrecision(18); property.SetScale(4); }
    }
    private static void Link<T, TParent>(ModelBuilder model, string key) where T : TenantEntity where TParent : TenantEntity =>
        model.Entity<T>().HasOne<TParent>().WithMany().HasForeignKey(nameof(TenantEntity.TenantId), key).HasPrincipalKey(nameof(TenantEntity.TenantId), nameof(TenantEntity.Id)).OnDelete(DeleteBehavior.Restrict);

    public override int SaveChanges() => throw new NotSupportedException("Use tenant-validated SaveChangesAsync");
    public override int SaveChanges(bool acceptAllChangesOnSuccess) => throw new NotSupportedException("Use tenant-validated SaveChangesAsync");
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) => SaveChangesAsync(true, cancellationToken);
    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        // Cover assignments/status changes from both office entry points without changing reception.
        foreach (var entry in ChangeTracker.Entries<Ride>().Where(e => e.State is EntityState.Added or EntityState.Modified).ToArray())
        {
            var ride = entry.Entity;
            var oldDriver = entry.State == EntityState.Added ? null : entry.Property(r => r.DriverId).OriginalValue;
            var changed = entry.State == EntityState.Added || entry.Property(r => r.Status).IsModified || entry.Property(r => r.DriverId).IsModified;
            if (changed || entry.Property(r => r.DispatchMode).IsModified)
                Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "ride.state", Detail = System.Text.Json.JsonSerializer.Serialize(new {
                    previous = entry.State == EntityState.Added ? null : RideWorkflow.CustomerState(entry.Property(r => r.Status).OriginalValue),
                    status = RideWorkflow.CustomerState(ride), driverId = ride.DriverId, dispatchMode = ride.DispatchMode
                }) });
            if (!changed) continue;
            if (oldDriver.HasValue && oldDriver != ride.DriverId)
                Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "ride.notification.Removed", Detail = oldDriver.Value.ToString() });
            if (ride.DriverId.HasValue)
                Add(new AuditLog { ActorId = tenant.ActorId, EntityId = ride.Id, Action = "ride.notification." + ride.Status, Detail = ride.DriverId.Value.ToString() });
        }
        foreach (var entry in ChangeTracker.Entries<RideOffer>().Where(e => e.State == EntityState.Added || e.State == EntityState.Modified && e.Property(o => o.Outcome).IsModified).ToArray())
            Add(new AuditLog { ActorId = tenant.ActorId, EntityId = entry.Entity.RideId, Action = "ride.dispatch", Detail = System.Text.Json.JsonSerializer.Serialize(new {
                attemptId = entry.Entity.Id, driverId = entry.Entity.DriverId, outcome = entry.Entity.Outcome,
                offeredAt = entry.Entity.OfferedAt, expiresAt = entry.Entity.ExpiresAt, distanceMeters = entry.Entity.DistanceMeters
            }) });
        foreach (var entry in ChangeTracker.Entries<TenantEntity>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            if (CurrentTenant == Guid.Empty) throw new UnauthorizedAccessException("Tenant required");
            if (entry.State == EntityState.Added && entry.Entity.TenantId == Guid.Empty) entry.Entity.TenantId = CurrentTenant;
            if (entry.Entity.TenantId != CurrentTenant || (entry.State != EntityState.Added && entry.Property(x => x.TenantId).OriginalValue != CurrentTenant)) throw new UnauthorizedAccessException("Tenant mismatch");
            if (entry.Entity is AuditLog or PriceAdjustment && entry.State != EntityState.Added) throw new InvalidOperationException("Audit records are immutable");
            if (entry.Entity is Ride ride) ride.Version++;
            if (entry.Entity is RidePrice price) price.Version++;
        }
        var result = await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        if (result > 0)
        {
            if (Database.CurrentTransaction is null) notifications?.Publish(CurrentTenant);
            else PendingNotification = true;
        }
        return result;
    }
}
