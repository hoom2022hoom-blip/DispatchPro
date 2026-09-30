using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DriverContactData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OfficeWhatsAppNumber",
                table: "Office",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "HasWhatsApp",
                table: "Driver",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WhatsappCountryCode",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "WhatsappEnabled",
                table: "Driver",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WhatsappPhone",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");
            // Preserve legacy contacts while separating the local number from WhatsApp routing.
            migrationBuilder.Sql("""
                UPDATE "Driver" SET "WhatsappCountryCode" = CASE WHEN "Phone" LIKE '+972%' THEN '+972' ELSE '+970' END;
                UPDATE "Driver" SET "Phone" = '0' || substring("Phone" from 5)
                WHERE "Phone" ~ '^[+](970|972)[0-9]{8,9}$';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OfficeWhatsAppNumber",
                table: "Office");

            migrationBuilder.DropColumn(
                name: "HasWhatsApp",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "WhatsappCountryCode",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "WhatsappEnabled",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "WhatsappPhone",
                table: "Driver");
        }
    }
}
