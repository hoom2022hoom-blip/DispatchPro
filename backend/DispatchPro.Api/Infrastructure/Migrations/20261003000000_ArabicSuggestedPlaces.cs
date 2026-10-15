using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace DispatchPro.Api.Infrastructure.Migrations;
[DbContext(typeof(TaxiDb))]
[Migration("20261003000000_ArabicSuggestedPlaces")]
public sealed class ArabicSuggestedPlaces : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("Area", "SuggestedPlace", type: "text", nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("Category", "SuggestedPlace", type: "text", nullable: false, defaultValue: "");
        // Schema repair only: preserve every existing place and its activation state.
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("يتطلب التراجع حفظ بيانات المواقع العربية.");
}
