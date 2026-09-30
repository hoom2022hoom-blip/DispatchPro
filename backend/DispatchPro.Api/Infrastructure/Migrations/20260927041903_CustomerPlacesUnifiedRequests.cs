using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CustomerPlacesUnifiedRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "CustomerId",
                table: "RideRequest",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "AddressText",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "RideRequest",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LocationSource",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "RideRequest",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Neighborhood",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PassengerName",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PassengerPhone",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "SavedAddressId",
                table: "RideRequest",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Street",
                table: "RideRequest",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "RideRequestId",
                table: "ReceptionOrder",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "SavedAddress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    Icon = table.Column<string>(type: "text", nullable: false),
                    AddressText = table.Column<string>(type: "text", nullable: false),
                    Neighborhood = table.Column<string>(type: "text", nullable: false),
                    Street = table.Column<string>(type: "text", nullable: false),
                    Latitude = table.Column<double>(type: "double precision", nullable: true),
                    Longitude = table.Column<double>(type: "double precision", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedAddress", x => x.Id);
                    table.UniqueConstraint("AK_SavedAddress_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_SavedAddress_Customer_TenantId_CustomerId",
                        columns: x => new { x.TenantId, x.CustomerId },
                        principalTable: "Customer",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SavedAddress_Tenant_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenant",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // Upgrade existing reception records in-place, retaining their IDs, day and number.
            migrationBuilder.Sql("""
                UPDATE "RideRequest" SET "AddressText" = "Pickup", "LocationSource" = 'MANUAL_TEXT',
                    "Source" = CASE WHEN "Source" = 'LANDLINE_ICALL' THEN 'LANDLINE' ELSE "Source" END;
                INSERT INTO "RideRequest" ("Id", "TenantId", "CustomerId", "Pickup", "Destination", "Notes", "Source", "CreatedAt", "AddressText", "Neighborhood", "Street", "LocationSource", "PassengerName", "PassengerPhone")
                SELECT "Id", "TenantId", NULL, COALESCE("Payload"->'pickup'->>'name',''), COALESCE("Payload"->'dropoff'->>'name',''), COALESCE("Payload"->>'notes',''),
                    CASE WHEN "Payload"->>'source' = 'LANDLINE_ICALL' THEN 'LANDLINE' ELSE COALESCE("Payload"->>'source','MANUAL') END,
                    COALESCE(("Payload"->>'createdAt')::timestamptz, now()), COALESCE("Payload"->'pickup'->>'name',''), '', '', 'MANUAL_TEXT', COALESCE("Payload"->>'passengerName',''), COALESCE("Payload"->>'passengerPhone','')
                FROM "ReceptionOrder";
                UPDATE "ReceptionOrder" SET "RideRequestId" = "Id", "LastWriteHash" = '', "Payload" = "Payload" || jsonb_build_object('rideRequestId', "Id", 'addressText', COALESCE("Payload"->'pickup'->>'name',''), 'latitude', NULL, 'longitude', NULL, 'locationSource', 'MANUAL_TEXT');
                INSERT INTO "Ride" ("Id", "TenantId", "RideRequestId", "DriverId", "Status", "Version")
                SELECT "Id", "TenantId", "RideRequestId", NULLIF("Payload"->>'driverId','')::uuid,
                    CASE "Payload"->>'status' WHEN 'assigned' THEN 1 WHEN 'driver-accepted' THEN 2 WHEN 'driver-arriving' THEN 2 WHEN 'arrived' THEN 3 WHEN 'in-progress' THEN 4 WHEN 'completed' THEN 5 WHEN 'cancelled' THEN 6 ELSE 0 END, 1 FROM "ReceptionOrder";
                """);
            // Add projections for API requests created before this migration, without changing them.
            migrationBuilder.Sql("""
                WITH missing AS (
                    SELECT r."Id" AS ride_id, r."TenantId" AS tenant_id, r."RideRequestId" AS request_id, r."DriverId" AS driver_id, r."Status" AS status,
                        q."CreatedAt" AS created_at, q."AddressText" AS address, q."Source" AS source, q."CustomerId" AS customer_id,
                        to_char(q."CreatedAt" AT TIME ZONE 'Asia/Jerusalem','YYYY-MM-DD') AS day,
                        COALESCE(c."FullName", q."PassengerName") AS name, COALESCE(c."Phone", q."PassengerPhone") AS phone
                    FROM "Ride" r JOIN "RideRequest" q ON r."RideRequestId" = q."Id" AND r."TenantId" = q."TenantId"
                    LEFT JOIN "Customer" c ON c."Id" = q."CustomerId" AND c."TenantId" = q."TenantId"
                    WHERE NOT EXISTS (SELECT 1 FROM "ReceptionOrder" o WHERE o."TenantId" = r."TenantId" AND o."RideRequestId" = q."Id")
                ), numbered AS (
                    SELECT m.*, COALESCE((SELECT "Value" FROM "ReceptionCounter" WHERE "TenantId" = tenant_id AND "Day" = day),0) + row_number() OVER(PARTITION BY tenant_id, day ORDER BY created_at, ride_id) AS number FROM missing m
                ) INSERT INTO "ReceptionOrder" ("Id", "TenantId", "RideRequestId", "ExternalId", "Day", "Number", "Payload", "Version", "LastWriteHash")
                SELECT ride_id, tenant_id, request_id, ride_id::text, day, number, jsonb_build_object('id',ride_id,'rideRequestId',request_id,'customerId',customer_id,'source',CASE WHEN source='LANDLINE' THEN 'LANDLINE_ICALL' ELSE source END,'passengerName',name,'passengerPhone',phone,'pickup',jsonb_build_object('name',address,'coords',jsonb_build_object('x',0,'y',0)),'addressText',address,'locationSource','MANUAL_TEXT','totalFare',0,'movingFee',false,'status',CASE status WHEN 1 THEN 'assigned' WHEN 2 THEN 'driver-accepted' WHEN 3 THEN 'arrived' WHEN 4 THEN 'in-progress' WHEN 5 THEN 'completed' WHEN 6 THEN 'cancelled' ELSE 'pending' END,'driverId',driver_id,'shiftId',NULL,'createdAt',created_at,'updatedAt',created_at,'orderDay',day,'orderNumber',number,'receptionVersion',1),1,'' FROM numbered;
                INSERT INTO "ReceptionCounter" ("Id", "TenantId", "Day", "Value") SELECT gen_random_uuid(), "TenantId", "Day", MAX("Number") FROM "ReceptionOrder" GROUP BY "TenantId", "Day"
                ON CONFLICT ("TenantId", "Day") DO UPDATE SET "Value" = GREATEST("ReceptionCounter"."Value", EXCLUDED."Value");
                """);

            migrationBuilder.CreateIndex(
                name: "IX_RideRequest_TenantId_SavedAddressId",
                table: "RideRequest",
                columns: new[] { "TenantId", "SavedAddressId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReceptionOrder_TenantId_RideRequestId",
                table: "ReceptionOrder",
                columns: new[] { "TenantId", "RideRequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SavedAddress_TenantId_CustomerId",
                table: "SavedAddress",
                columns: new[] { "TenantId", "CustomerId" },
                unique: true,
                filter: "\"IsDefault\" = true");

            migrationBuilder.AddForeignKey(
                name: "FK_ReceptionOrder_RideRequest_TenantId_RideRequestId",
                table: "ReceptionOrder",
                columns: new[] { "TenantId", "RideRequestId" },
                principalTable: "RideRequest",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_RideRequest_SavedAddress_TenantId_SavedAddressId",
                table: "RideRequest",
                columns: new[] { "TenantId", "SavedAddressId" },
                principalTable: "SavedAddress",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ReceptionOrder_RideRequest_TenantId_RideRequestId",
                table: "ReceptionOrder");

            migrationBuilder.DropForeignKey(
                name: "FK_RideRequest_SavedAddress_TenantId_SavedAddressId",
                table: "RideRequest");

            migrationBuilder.DropTable(
                name: "SavedAddress");

            migrationBuilder.DropIndex(
                name: "IX_RideRequest_TenantId_SavedAddressId",
                table: "RideRequest");

            migrationBuilder.DropIndex(
                name: "IX_ReceptionOrder_TenantId_RideRequestId",
                table: "ReceptionOrder");

            migrationBuilder.DropColumn(
                name: "AddressText",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "LocationSource",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "Neighborhood",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "PassengerName",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "PassengerPhone",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "SavedAddressId",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "Street",
                table: "RideRequest");

            migrationBuilder.DropColumn(
                name: "RideRequestId",
                table: "ReceptionOrder");

            migrationBuilder.AlterColumn<Guid>(
                name: "CustomerId",
                table: "RideRequest",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
