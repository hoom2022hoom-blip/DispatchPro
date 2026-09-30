namespace DispatchPro.Api.Domain;

public static class RideWorkflow
{
    public static string CustomerState(Ride ride) => ride.Status == RideStatus.Pending && ride.DispatchMode == "MANUAL" ? "REQUESTED" : CustomerState(ride.Status);
    public static bool CanTransition(RideStatus current, RideStatus next) => current == next || ((current, next) switch
    {
        (RideStatus.Pending or RideStatus.Rejected or RideStatus.NoDriverAvailable, RideStatus.Assigned) => true,
        (RideStatus.Assigned, RideStatus.Accepted or RideStatus.Rejected) => true,
        (RideStatus.Accepted, RideStatus.DriverArriving or RideStatus.Arrived) => true,
        (RideStatus.DriverArriving, RideStatus.Arrived) => true,
        (RideStatus.Arrived, RideStatus.InProgress) => true,
        (RideStatus.InProgress, RideStatus.Completed) => true,
        (_, RideStatus.Cancelled) when current is not (RideStatus.Completed or RideStatus.Cancelled) => true,
        _ => false
    });
    public static string CustomerState(RideStatus status) => status switch
    {
        RideStatus.NoDriverAvailable => "NO_DRIVER_AVAILABLE",
        RideStatus.Pending or RideStatus.Assigned or RideStatus.Rejected => "SEARCHING_DRIVER",
        RideStatus.Accepted => "DRIVER_ASSIGNED",
        RideStatus.DriverArriving => "DRIVER_ARRIVING",
        RideStatus.Arrived => "DRIVER_ARRIVED",
        RideStatus.InProgress => "IN_PROGRESS",
        RideStatus.Completed => "COMPLETED",
        _ => "CANCELLED"
    };
    // Additive API projection keeps existing clients' status values compatible.
    public static string State(RideStatus status) => status switch
    {
        RideStatus.NoDriverAvailable => "NO_DRIVER_AVAILABLE",
        RideStatus.Pending => "REQUESTED",
        RideStatus.Assigned => "DRIVER_ASSIGNED",
        RideStatus.Accepted => "ACCEPTED",
        RideStatus.DriverArriving => "DRIVER_ARRIVING",
        RideStatus.Arrived => "DRIVER_ARRIVED",
        RideStatus.InProgress => "IN_TRIP",
        RideStatus.Completed => "COMPLETED",
        RideStatus.Rejected => "REJECTED",
        _ => "CANCELLED"
    };
}
