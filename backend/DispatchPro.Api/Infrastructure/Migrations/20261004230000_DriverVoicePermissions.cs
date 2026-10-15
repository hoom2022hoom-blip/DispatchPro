using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace DispatchPro.Api.Infrastructure.Migrations;
[DbContext(typeof(TaxiDb))]
[Migration("20261004230000_DriverVoicePermissions")]
public sealed class DriverVoicePermissions : Migration
{
    protected override void Up(MigrationBuilder m)
    {
        foreach (var name in new[] { "VoiceEnabled", "CanListen", "CanTalkPublic", "CanTalkPrivate" })
            m.AddColumn<bool>(name: name, table: "Driver", type: "boolean", nullable: false, defaultValue: true);
        m.AddColumn<bool>(name: "IsVoiceBlocked", table: "Driver", type: "boolean", nullable: false, defaultValue: false);
    }
    protected override void Down(MigrationBuilder m)
    {
        foreach (var name in new[] { "VoiceEnabled", "CanListen", "CanTalkPublic", "CanTalkPrivate", "IsVoiceBlocked" }) m.DropColumn(name, "Driver");
    }
}
