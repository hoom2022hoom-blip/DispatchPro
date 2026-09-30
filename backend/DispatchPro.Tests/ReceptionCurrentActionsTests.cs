using DispatchPro.Api.Domain;
using DispatchPro.Api.Services;
using Xunit;

namespace DispatchPro.Tests;

public sealed class ReceptionCurrentActionsTests
{
    [Fact]
    public void OptionalReceptionAddressPreservesOtherLocationValidation()
    {
        var location = new LocationInput("");
        Locations.Validate(location, allowEmpty: true);
        var request = new RideRequest();
        Locations.Apply(request, location);
        Assert.Equal("", request.AddressText);
        Assert.Equal("", request.Pickup);
        Assert.Null(request.Latitude);
        Assert.Throws<ArgumentException>(() => Locations.Validate(location with { Latitude = 32 }, allowEmpty: true));
        Assert.Throws<ArgumentException>(() => Locations.Validate(location with { AddressText = new string('x', 501) }, allowEmpty: true));
        Assert.Throws<ArgumentException>(() => Locations.Validate(location with { LocationSource = "invalid" }, allowEmpty: true));
        Assert.Throws<ArgumentException>(() => Locations.Validate(location));
    }

    [Fact]
    public void RemainingQueueIsRenumberedWithoutChangingDriversOrEntryTime()
    {
        var rows = new[] { new ReceptionQueue { DriverId = Guid.NewGuid(), Position = 1 }, new ReceptionQueue { DriverId = Guid.NewGuid(), Position = 3 } };
        var ids = rows.Select(r => r.DriverId).ToArray();
        DriverOperations.Renumber(rows);
        Assert.Equal(new[] { 1, 2 }, rows.Select(r => r.Position));
        Assert.Equal(ids, rows.Select(r => r.DriverId));
    }
}
