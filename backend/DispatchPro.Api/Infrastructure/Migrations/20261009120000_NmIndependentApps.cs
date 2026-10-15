using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace DispatchPro.Api.Infrastructure.Migrations;
[DbContext(typeof(TaxiDb))]
[Migration("20261009120000_NmIndependentApps")]
public sealed class NmIndependentApps : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) {
        migrationBuilder.AddColumn<bool>("DriverAppEnabled", "Driver", "boolean", nullable: false, defaultValue: true);
        migrationBuilder.AddColumn<bool>("GpsEnabled", "Driver", "boolean", nullable: false, defaultValue: true);
        migrationBuilder.AddColumn<string>("Source", "DriverLocation", "text", nullable: false, defaultValue: "driver");
        migrationBuilder.AddColumn<string>("Source", "DriverGpsPoint", "text", nullable: false, defaultValue: "driver");
        migrationBuilder.AddColumn<bool>("LocationAccepted", "DriverGpsPoint", "boolean", nullable: false, defaultValue: true);
    }
    protected override void Down(MigrationBuilder migrationBuilder) {
        migrationBuilder.DropColumn("DriverAppEnabled", "Driver");
        migrationBuilder.DropColumn("GpsEnabled", "Driver");
        migrationBuilder.DropColumn("Source", "DriverLocation");
        migrationBuilder.DropColumn("Source", "DriverGpsPoint");
        migrationBuilder.DropColumn("LocationAccepted", "DriverGpsPoint");
    }
}
