using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace DispatchPro.Api.Infrastructure.Migrations;

[DbContext(typeof(TaxiDb))]
[Migration("20261002190000_ReceptionDestinationDrafts")]
public sealed class ReceptionDestinationDrafts : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.AlterColumn<Guid>(
        name: "RideRequestId", table: "ReceptionOrder", type: "uuid", nullable: true,
        oldClrType: typeof(Guid), oldType: "uuid");

    // Existing rides remain valid. Reverting null drafts requires an explicit preservation plan.
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM "ReceptionOrder" WHERE "RideRequestId" IS NULL) THEN
                    RAISE EXCEPTION 'Preserve reception drafts before reverting this migration.';
                END IF;
            END $$;
            """);
        migrationBuilder.AlterColumn<Guid>(
            name: "RideRequestId", table: "ReceptionOrder", type: "uuid", nullable: false,
            oldClrType: typeof(Guid), oldType: "uuid", oldNullable: true);
    }
}
