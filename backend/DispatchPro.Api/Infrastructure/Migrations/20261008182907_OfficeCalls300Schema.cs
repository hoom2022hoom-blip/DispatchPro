using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OfficeCalls300Schema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OfficeCallDevice",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Approved = table.Column<bool>(type: "boolean", nullable: false),
                    Revoked = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastSeen = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OfficeCallDevice", x => x.Id);
                    table.UniqueConstraint("AK_OfficeCallDevice_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_OfficeCallDevice_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OfficeCallEvent",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<string>(type: "text", nullable: false),
                    Phone = table.Column<string>(type: "text", nullable: false),
                    SourcePackage = table.Column<string>(type: "text", nullable: false),
                    Timestamp = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AcceptedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DispatchStatus = table.Column<string>(type: "text", nullable: false),
                    GridStatus = table.Column<string>(type: "text", nullable: false),
                    DispatchError = table.Column<string>(type: "text", nullable: false),
                    GridError = table.Column<string>(type: "text", nullable: false),
                    GridVisibleConfirmed = table.Column<bool>(type: "boolean", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttempt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OfficeCallEvent", x => x.Id);
                    table.UniqueConstraint("AK_OfficeCallEvent_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_OfficeCallEvent_OfficeCallDevice_TenantId_DeviceId",
                        columns: x => new { x.TenantId, x.DeviceId },
                        principalTable: "OfficeCallDevice",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OfficeCallEvent_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OfficeCallPairing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SecretHash = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DeviceId = table.Column<Guid>(type: "uuid", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OfficeCallPairing", x => x.Id);
                    table.UniqueConstraint("AK_OfficeCallPairing_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_OfficeCallPairing_OfficeCallDevice_TenantId_DeviceId",
                        columns: x => new { x.TenantId, x.DeviceId },
                        principalTable: "OfficeCallDevice",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OfficeCallPairing_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OfficeCallDevice_TokenHash",
                table: "OfficeCallDevice",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OfficeCallEvent_DispatchStatus_NextAttempt",
                table: "OfficeCallEvent",
                columns: new[] { "DispatchStatus", "NextAttempt" });

            migrationBuilder.CreateIndex(
                name: "IX_OfficeCallEvent_TenantId_DeviceId",
                table: "OfficeCallEvent",
                columns: new[] { "TenantId", "DeviceId" });

            migrationBuilder.CreateIndex(
                name: "IX_OfficeCallEvent_TenantId_EventId",
                table: "OfficeCallEvent",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OfficeCallPairing_TenantId_DeviceId",
                table: "OfficeCallPairing",
                columns: new[] { "TenantId", "DeviceId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OfficeCallEvent");

            migrationBuilder.DropTable(
                name: "OfficeCallPairing");

            migrationBuilder.DropTable(
                name: "OfficeCallDevice");
        }
    }
}
