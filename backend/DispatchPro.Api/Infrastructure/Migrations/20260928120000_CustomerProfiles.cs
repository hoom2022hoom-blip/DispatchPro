using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace DispatchPro.Api.Infrastructure.Migrations;

[DbContext(typeof(TaxiDb))]
[Migration("20260928120000_CustomerProfiles")]
public sealed class CustomerProfiles : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("SecondaryPhone", "Customer", type: "text", nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("Notes", "Customer", type: "text", nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<bool>("IsActive", "Customer", type: "boolean", nullable: false, defaultValue: true);
        migrationBuilder.AddColumn<DateTimeOffset>("CreatedAt", "Customer", type: "timestamp with time zone", nullable: false, defaultValueSql: "now()");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn("SecondaryPhone", "Customer");
        migrationBuilder.DropColumn("Notes", "Customer");
        migrationBuilder.DropColumn("IsActive", "Customer");
        migrationBuilder.DropColumn("CreatedAt", "Customer");
    }

    protected override void BuildTargetModel(ModelBuilder modelBuilder) { }
}
