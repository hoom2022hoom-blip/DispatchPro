using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DriverGpsHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DriverGpsPoint",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DriverId = table.Column<Guid>(type: "uuid", nullable: false),
                    RideId = table.Column<Guid>(type: "uuid", nullable: true),
                    Latitude = table.Column<double>(type: "double precision", nullable: false),
                    Longitude = table.Column<double>(type: "double precision", nullable: false),
                    Accuracy = table.Column<double>(type: "double precision", nullable: false),
                    Timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DriverGpsPoint", x => x.Id);
                    table.UniqueConstraint("AK_DriverGpsPoint_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DriverGpsPoint_Driver_TenantId_DriverId",
                        columns: x => new { x.TenantId, x.DriverId },
                        principalTable: "Driver",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DriverGpsPoint_Ride_TenantId_RideId",
                        columns: x => new { x.TenantId, x.RideId },
                        principalTable: "Ride",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DriverGpsPoint_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLog_TenantId_EntityId_CreatedAt",
                table: "AuditLog",
                columns: new[] { "TenantId", "EntityId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DriverGpsPoint_TenantId_DriverId_Timestamp",
                table: "DriverGpsPoint",
                columns: new[] { "TenantId", "DriverId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_DriverGpsPoint_TenantId_RideId_Timestamp",
                table: "DriverGpsPoint",
                columns: new[] { "TenantId", "RideId", "Timestamp" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DriverGpsPoint");

            migrationBuilder.DropIndex(
                name: "IX_AuditLog_TenantId_EntityId_CreatedAt",
                table: "AuditLog");
        }
    }
}
