using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ReceptionBridge : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReceptionCall",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<string>(type: "text", nullable: false),
                    Fingerprint = table.Column<string>(type: "text", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceptionCall", x => x.Id);
                    table.UniqueConstraint("AK_ReceptionCall_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ReceptionCall_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReceptionCounter",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Day = table.Column<string>(type: "text", nullable: false),
                    Value = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceptionCounter", x => x.Id);
                    table.UniqueConstraint("AK_ReceptionCounter_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ReceptionCounter_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReceptionOrder",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExternalId = table.Column<string>(type: "text", nullable: false),
                    EventId = table.Column<string>(type: "text", nullable: true),
                    Day = table.Column<string>(type: "text", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceptionOrder", x => x.Id);
                    table.UniqueConstraint("AK_ReceptionOrder_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ReceptionOrder_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReceptionShift",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DriverId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    StartTime = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndTime = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceptionShift", x => x.Id);
                    table.UniqueConstraint("AK_ReceptionShift_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ReceptionShift_Driver_TenantId_DriverId",
                        columns: x => new { x.TenantId, x.DriverId },
                        principalTable: "Driver",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReceptionShift_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReceptionShift_Vehicle_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "Vehicle",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ReceptionQueue",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ShiftId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    JoinedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceptionQueue", x => x.Id);
                    table.UniqueConstraint("AK_ReceptionQueue_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ReceptionQueue_ReceptionShift_TenantId_ShiftId",
                        columns: x => new { x.TenantId, x.ShiftId },
                        principalTable: "ReceptionShift",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ReceptionQueue_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionCall_TenantId_EventId",
                table: "ReceptionCall",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionCounter_TenantId_Day",
                table: "ReceptionCounter",
                columns: new[] { "TenantId", "Day" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionOrder_TenantId_Day_Number",
                table: "ReceptionOrder",
                columns: new[] { "TenantId", "Day", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionOrder_TenantId_EventId",
                table: "ReceptionOrder",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionOrder_TenantId_ExternalId",
                table: "ReceptionOrder",
                columns: new[] { "TenantId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionQueue_TenantId_ShiftId",
                table: "ReceptionQueue",
                columns: new[] { "TenantId", "ShiftId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionShift_TenantId_DriverId",
                table: "ReceptionShift",
                columns: new[] { "TenantId", "DriverId" },
                unique: true,
                filter: "\"Active\" = true");

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionShift_TenantId_VehicleId",
                table: "ReceptionShift",
                columns: new[] { "TenantId", "VehicleId" },
                unique: true,
                filter: "\"Active\" = true");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReceptionCall");

            migrationBuilder.DropTable(
                name: "ReceptionCounter");

            migrationBuilder.DropTable(
                name: "ReceptionOrder");

            migrationBuilder.DropTable(
                name: "ReceptionQueue");

            migrationBuilder.DropTable(
                name: "ReceptionShift");
        }
    }
}
