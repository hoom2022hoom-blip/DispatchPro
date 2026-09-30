using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ActiveDriverConstraint : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Ride_TenantId_DriverId",
                table: "Ride");

            migrationBuilder.CreateIndex(
                name: "IX_Ride_TenantId_DriverId",
                table: "Ride",
                columns: new[] { "TenantId", "DriverId" },
                unique: true,
                filter: "\"DriverId\" IS NOT NULL AND \"Status\" IN (1, 2, 3, 4)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Ride_TenantId_DriverId",
                table: "Ride");

            migrationBuilder.CreateIndex(
                name: "IX_Ride_TenantId_DriverId",
                table: "Ride",
                columns: new[] { "TenantId", "DriverId" });
        }
    }
}
