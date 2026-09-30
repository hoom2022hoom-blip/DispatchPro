using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class UnifiedReceptionQueue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AddressType",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AlterColumn<Guid>(
                name: "ShiftId",
                table: "ReceptionQueue",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");
            migrationBuilder.Sql("""
                UPDATE "RideRequest" SET "AddressType" = 'FIXED';
                UPDATE "RideRequest" r SET "AddressType" = CASE WHEN o."Payload"->>'addressStatus' = 'variable' THEN 'VARIABLE' ELSE 'FIXED' END
                FROM "ReceptionOrder" o WHERE o."RideRequestId" = r."Id" AND o."TenantId" = r."TenantId";
                WITH numbered AS (SELECT "Id", row_number() OVER (PARTITION BY "TenantId" ORDER BY "JoinedAt", "Position", "Id") AS n FROM "ReceptionQueue")
                UPDATE "ReceptionQueue" q SET "Position" = n.n, "ShiftId" = NULL FROM numbered n WHERE n."Id" = q."Id";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM "ReceptionQueue" WHERE "ShiftId" IS NULL) THEN
                  RAISE EXCEPTION 'Cannot restore shift-required queues while direct queue entries exist';
                END IF; END $$;
                """);
            migrationBuilder.DropColumn(
                name: "AddressType",
                table: "RideRequest");

            migrationBuilder.AlterColumn<Guid>(
                name: "ShiftId",
                table: "ReceptionQueue",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
