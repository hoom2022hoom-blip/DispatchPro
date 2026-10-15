using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace DispatchPro.Api.Infrastructure.Migrations;
[DbContext(typeof(TaxiDb))]
[Migration("20261002090000_OfficeSuggestedPlaces")]
public sealed class OfficeSuggestedPlaces : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable("SuggestedPlace", columns: table => new {
            Id = table.Column<Guid>(type: "uuid", nullable: false),
            TenantId = table.Column<Guid>(type: "uuid", nullable: false),
            Name = table.Column<string>(type: "text", nullable: false),
            AddressText = table.Column<string>(type: "text", nullable: false),
            Latitude = table.Column<double>(type: "double precision", nullable: false),
            Longitude = table.Column<double>(type: "double precision", nullable: false),
            SortOrder = table.Column<int>(type: "integer", nullable: false),
            IsActive = table.Column<bool>(type: "boolean", nullable: false),
            IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
            Version = table.Column<long>(type: "bigint", nullable: false)
        }, constraints: table => {
            table.PrimaryKey("PK_SuggestedPlace", x => x.Id);
            table.UniqueConstraint("AK_SuggestedPlace_TenantId_Id", x => new { x.TenantId, x.Id });
            table.ForeignKey("FK_SuggestedPlace_Tenant_TenantId", x => x.TenantId, "Tenant", "Id", onDelete: ReferentialAction.Restrict);
        });
        migrationBuilder.CreateIndex("IX_SuggestedPlace_TenantId_IsActive_SortOrder", "SuggestedPlace", new[] { "TenantId", "IsActive", "SortOrder" });
    }
    // Rollback must not silently delete saved office places.
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Office places require an explicit data-preserving rollback.");
}
