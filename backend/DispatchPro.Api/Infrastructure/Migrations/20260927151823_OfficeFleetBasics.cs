using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DispatchPro.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OfficeFleetBasics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Active",
                table: "Vehicle",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "Color",
                table: "Vehicle",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Make",
                table: "Vehicle",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Model",
                table: "Vehicle",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Vehicle",
                type: "text",
                nullable: false,
                defaultValue: "ACTIVE");

            migrationBuilder.AddColumn<int>(
                name: "Year",
                table: "Vehicle",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Active",
                table: "Driver",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Driver",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Active",
                table: "Vehicle");

            migrationBuilder.DropColumn(
                name: "Color",
                table: "Vehicle");

            migrationBuilder.DropColumn(
                name: "Make",
                table: "Vehicle");

            migrationBuilder.DropColumn(
                name: "Model",
                table: "Vehicle");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Vehicle");

            migrationBuilder.DropColumn(
                name: "Year",
                table: "Vehicle");

            migrationBuilder.DropColumn(
                name: "Active",
                table: "Driver");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Driver");
        }
    }
}
