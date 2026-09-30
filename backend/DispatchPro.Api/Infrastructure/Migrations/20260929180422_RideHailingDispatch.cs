using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RideHailingDispatch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "DestinationLatitude",
                table: "RideRequest",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "DestinationLongitude",
                table: "RideRequest",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DispatchMode",
                table: "Ride",
                type: "text",
                nullable: false,
                defaultValue: "MANUAL");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OfferExpiresAt",
                table: "Ride",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DispatchPolicy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Mode = table.Column<string>(type: "text", nullable: false),
                    LocationMaxAgeSeconds = table.Column<int>(type: "integer", nullable: false),
                    OfferTimeoutSeconds = table.Column<int>(type: "integer", nullable: false),
                    ShowDriverPhone = table.Column<bool>(type: "boolean", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DispatchPolicy", x => x.Id);
                    table.UniqueConstraint("AK_DispatchPolicy_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DispatchPolicy_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DriverLocation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DriverId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<Point>(type: "geography (point,4326)", nullable: false),
                    Accuracy = table.Column<double>(type: "double precision", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DriverLocation", x => x.Id);
                    table.UniqueConstraint("AK_DriverLocation_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DriverLocation_Driver_TenantId_DriverId",
                        columns: x => new { x.TenantId, x.DriverId },
                        principalTable: "Driver",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DriverLocation_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RideOffer",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RideId = table.Column<Guid>(type: "uuid", nullable: false),
                    DriverId = table.Column<Guid>(type: "uuid", nullable: false),
                    OfferedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Outcome = table.Column<string>(type: "text", nullable: false),
                    DistanceMeters = table.Column<double>(type: "double precision", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RideOffer", x => x.Id);
                    table.UniqueConstraint("AK_RideOffer_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_RideOffer_Driver_TenantId_DriverId",
                        columns: x => new { x.TenantId, x.DriverId },
                        principalTable: "Driver",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RideOffer_Ride_TenantId_RideId",
                        columns: x => new { x.TenantId, x.RideId },
                        principalTable: "Ride",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RideOffer_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DispatchPolicy_TenantId",
                table: "DispatchPolicy",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DriverLocation_Position",
                table: "DriverLocation",
                column: "Position")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "IX_DriverLocation_TenantId_DriverId",
                table: "DriverLocation",
                columns: new[] { "TenantId", "DriverId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RideOffer_TenantId_DriverId",
                table: "RideOffer",
                columns: new[] { "TenantId", "DriverId" });

            migrationBuilder.CreateIndex(
                name: "IX_RideOffer_TenantId_RideId_DriverId",
                table: "RideOffer",
                columns: new[] { "TenantId", "RideId", "DriverId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DispatchPolicy");

            migrationBuilder.DropTable(
                name: "DriverLocation");

            migrationBuilder.DropTable(
                name: "RideOffer");

            migrationBuilder.DropColumn(
                name: "DestinationLatitude",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "DestinationLongitude",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "DispatchMode",
                table: "Ride");

            migrationBuilder.DropColumn(
                name: "OfferExpiresAt",
                table: "Ride");
        }
    }
}
