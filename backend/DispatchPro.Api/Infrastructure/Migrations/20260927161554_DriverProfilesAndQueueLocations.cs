using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DriverProfilesAndQueueLocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DriverId",
                table: "ReceptionQueue",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "QueueLocationId",
                table: "ReceptionQueue",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "ReceptionQueue",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "CurrentVehicleId",
                table: "Driver",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "DateOfBirth",
                table: "Driver",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "HireDate",
                table: "Driver",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "LicenseExpiryDate",
                table: "Driver",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "LicenseIssueDate",
                table: "Driver",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LicenseNumber",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "LicenseType",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NationalId",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "DriverVehicleAssignment",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DriverId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ChangedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DriverVehicleAssignment", x => x.Id);
                    table.UniqueConstraint("AK_DriverVehicleAssignment_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DriverVehicleAssignment_Driver_TenantId_DriverId",
                        columns: x => new { x.TenantId, x.DriverId },
                        principalTable: "Driver",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DriverVehicleAssignment_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DriverVehicleAssignment_User_TenantId_ChangedBy",
                        columns: x => new { x.TenantId, x.ChangedBy },
                        principalTable: "User",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DriverVehicleAssignment_Vehicle_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "Vehicle",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "QueueLocation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QueueLocation", x => x.Id);
                    table.UniqueConstraint("AK_QueueLocation_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_QueueLocation_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // Preserve existing queue entries and vehicle links before adding new constraints.
            migrationBuilder.Sql("""
                UPDATE "ReceptionQueue" q SET "DriverId" = s."DriverId", "Status" = 'WAITING'
                FROM "ReceptionShift" s WHERE s."Id" = q."ShiftId" AND s."TenantId" = q."TenantId";
                INSERT INTO "QueueLocation" ("Id", "TenantId", "Name", "IsActive", "SortOrder")
                SELECT gen_random_uuid(), t."Id", CASE WHEN t."Name" = '' THEN t."Slug" ELSE t."Name" END, true, 0
                FROM "Tenant" t WHERE EXISTS (SELECT 1 FROM "ReceptionQueue" q WHERE q."TenantId" = t."Id");
                UPDATE "ReceptionQueue" q SET "QueueLocationId" = l."Id" FROM "QueueLocation" l WHERE l."TenantId" = q."TenantId";
                WITH numbered AS (SELECT "Id", row_number() OVER (PARTITION BY "TenantId", "QueueLocationId" ORDER BY "Position", "JoinedAt", "Id") AS n FROM "ReceptionQueue")
                UPDATE "ReceptionQueue" q SET "Position" = n.n FROM numbered n WHERE n."Id" = q."Id";
                WITH candidates AS (
                  SELECT s."TenantId", s."DriverId", s."VehicleId", 0 AS priority FROM "ReceptionShift" s WHERE s."Active"
                  UNION ALL
                  SELECT v."TenantId", v."DriverId", v."Id", 1 FROM "Vehicle" v
                  WHERE NOT EXISTS (SELECT 1 FROM "ReceptionShift" s WHERE s."VehicleId" = v."Id" AND s."Active" AND s."DriverId" <> v."DriverId")
                ), ranked AS (SELECT *, row_number() OVER (PARTITION BY "TenantId", "DriverId" ORDER BY priority, "VehicleId") AS n FROM candidates)
                UPDATE "Driver" d SET "CurrentVehicleId" = r."VehicleId" FROM ranked r WHERE r.n = 1 AND r."DriverId" = d."Id" AND r."TenantId" = d."TenantId";
                INSERT INTO "DriverVehicleAssignment" ("Id", "TenantId", "DriverId", "VehicleId", "StartedAt", "EndedAt", "ChangedBy", "Notes")
                SELECT gen_random_uuid(), d."TenantId", d."Id", d."CurrentVehicleId", now(), NULL, NULL, 'Current link recovered at migration; original start time unknown'
                FROM "Driver" d WHERE d."CurrentVehicleId" IS NOT NULL;
                INSERT INTO "DriverVehicleAssignment" ("Id", "TenantId", "DriverId", "VehicleId", "StartedAt", "EndedAt", "ChangedBy", "Notes")
                SELECT gen_random_uuid(), v."TenantId", v."DriverId", v."Id", now(), now(), NULL, 'Previous stored vehicle link recovered; original dates unknown'
                FROM "Vehicle" v JOIN "Driver" d ON d."Id" = v."DriverId" AND d."TenantId" = v."TenantId" WHERE d."CurrentVehicleId" IS DISTINCT FROM v."Id";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionQueue_TenantId_DriverId",
                table: "ReceptionQueue",
                columns: new[] { "TenantId", "DriverId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionQueue_TenantId_QueueLocationId",
                table: "ReceptionQueue",
                columns: new[] { "TenantId", "QueueLocationId" });

            migrationBuilder.CreateIndex(
                name: "IX_Driver_TenantId_CurrentVehicleId",
                table: "Driver",
                columns: new[] { "TenantId", "CurrentVehicleId" },
                unique: true,
                filter: "\"CurrentVehicleId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DriverVehicleAssignment_TenantId_ChangedBy",
                table: "DriverVehicleAssignment",
                columns: new[] { "TenantId", "ChangedBy" });

            migrationBuilder.CreateIndex(
                name: "IX_DriverVehicleAssignment_TenantId_DriverId",
                table: "DriverVehicleAssignment",
                columns: new[] { "TenantId", "DriverId" },
                unique: true,
                filter: "\"EndedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DriverVehicleAssignment_TenantId_VehicleId",
                table: "DriverVehicleAssignment",
                columns: new[] { "TenantId", "VehicleId" },
                unique: true,
                filter: "\"EndedAt\" IS NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_Driver_Vehicle_TenantId_CurrentVehicleId",
                table: "Driver",
                columns: new[] { "TenantId", "CurrentVehicleId" },
                principalTable: "Vehicle",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ReceptionQueue_Driver_TenantId_DriverId",
                table: "ReceptionQueue",
                columns: new[] { "TenantId", "DriverId" },
                principalTable: "Driver",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ReceptionQueue_QueueLocation_TenantId_QueueLocationId",
                table: "ReceptionQueue",
                columns: new[] { "TenantId", "QueueLocationId" },
                principalTable: "QueueLocation",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Driver_Vehicle_TenantId_CurrentVehicleId",
                table: "Driver");

            migrationBuilder.DropForeignKey(
                name: "FK_ReceptionQueue_Driver_TenantId_DriverId",
                table: "ReceptionQueue");

            migrationBuilder.DropForeignKey(
                name: "FK_ReceptionQueue_QueueLocation_TenantId_QueueLocationId",
                table: "ReceptionQueue");

            migrationBuilder.DropTable(
                name: "DriverVehicleAssignment");

            migrationBuilder.DropTable(
                name: "QueueLocation");

            migrationBuilder.DropIndex(
                name: "IX_ReceptionQueue_TenantId_DriverId",
                table: "ReceptionQueue");

            migrationBuilder.DropIndex(
                name: "IX_ReceptionQueue_TenantId_QueueLocationId",
                table: "ReceptionQueue");

            migrationBuilder.DropIndex(
                name: "IX_Driver_TenantId_CurrentVehicleId",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "DriverId",
                table: "ReceptionQueue");

            migrationBuilder.DropColumn(
                name: "QueueLocationId",
                table: "ReceptionQueue");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "ReceptionQueue");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "CurrentVehicleId",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "DateOfBirth",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "HireDate",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "LicenseExpiryDate",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "LicenseIssueDate",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "LicenseNumber",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "LicenseType",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "NationalId",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Driver");
        }
    }
}
