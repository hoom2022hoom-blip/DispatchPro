using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace DispatchPro.Api.Infrastructure.Migrations;

[DbContext(typeof(TaxiDb))]
[Migration("20261002210000_VehicleDocumentExpiry")]
public sealed class VehicleDocumentExpiry : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<DateOnly>(name: "RegistrationExpiryDate", table: "Vehicle", type: "date", nullable: true);
        migrationBuilder.AddColumn<DateOnly>(name: "InsuranceExpiryDate", table: "Vehicle", type: "date", nullable: true);
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "RegistrationExpiryDate", table: "Vehicle");
        migrationBuilder.DropColumn(name: "InsuranceExpiryDate", table: "Vehicle");
    }
}
