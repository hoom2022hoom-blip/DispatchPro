using System;
using DispatchPro.Api.Infrastructure;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace DispatchPro.Api.Infrastructure.Migrations;
[DbContext(typeof(TaxiDb))]
[Migration("20261001190000_RideFareMeter")]
public sealed class RideFareMeter : Migration {
 protected override void Up(MigrationBuilder migrationBuilder){
  migrationBuilder.AddColumn<string>(name:"FareMode",table:"Ride",type:"text",nullable:false,defaultValue:"OFFICE_MANUAL");
  migrationBuilder.AddColumn<string>(name:"FareSource",table:"Ride",type:"text",nullable:true);
  migrationBuilder.AddColumn<string>(name:"Currency",table:"Ride",type:"text",nullable:false,defaultValue:"ILS");
  migrationBuilder.AddColumn<decimal>(name:"FinalFare",table:"Ride",type:"numeric(18,4)",nullable:true);
  migrationBuilder.AddColumn<decimal>(name:"MeterCalculatedFare",table:"Ride",type:"numeric(18,4)",nullable:true);
  migrationBuilder.AddColumn<decimal>(name:"DistanceKm",table:"Ride",type:"numeric(18,4)",nullable:true);
  migrationBuilder.AddColumn<int>(name:"DurationSeconds",table:"Ride",type:"integer",nullable:true);
  migrationBuilder.AddColumn<int>(name:"WaitingSeconds",table:"Ride",type:"integer",nullable:true);
  migrationBuilder.AddColumn<DateTimeOffset>(name:"FareCalculatedAt",table:"Ride",type:"timestamp with time zone",nullable:true);
  migrationBuilder.AddColumn<DateTimeOffset>(name:"FareUpdatedAt",table:"Ride",type:"timestamp with time zone",nullable:true);
  migrationBuilder.AddColumn<Guid>(name:"FareUpdatedBy",table:"Ride",type:"uuid",nullable:true);
  migrationBuilder.AddColumn<DateTimeOffset>(name:"MeterStartedAt",table:"Ride",type:"timestamp with time zone",nullable:true);
  migrationBuilder.AddColumn<DateTimeOffset>(name:"MeterStoppedAt",table:"Ride",type:"timestamp with time zone",nullable:true);
  migrationBuilder.AddColumn<string>(name:"MeterTariff",table:"Ride",type:"text",nullable:true);
  migrationBuilder.AddColumn<DateTimeOffset>(name:"MeterLastAt",table:"Ride",type:"timestamp with time zone",nullable:true);
  migrationBuilder.AddColumn<double>(name:"MeterLastLatitude",table:"Ride",type:"double precision",nullable:true);
  migrationBuilder.AddColumn<double>(name:"MeterLastLongitude",table:"Ride",type:"double precision",nullable:true);
  migrationBuilder.AddColumn<double>(name:"MeterLastAccuracy",table:"Ride",type:"double precision",nullable:true);
  migrationBuilder.AddColumn<decimal>(name:"IncludedDistanceKm",table:"PricingRule",type:"numeric(18,4)",nullable:false,defaultValue:0m);
  migrationBuilder.AddColumn<decimal>(name:"ExtraFee",table:"PricingRule",type:"numeric(18,4)",nullable:false,defaultValue:0m);
  migrationBuilder.Sql("UPDATE \"Ride\" r SET \"FinalFare\"=p.\"FinalPrice\",\"FareSource\"='OFFICE_MANUAL' FROM \"RidePrice\" p WHERE p.\"TenantId\"=r.\"TenantId\" AND p.\"RideId\"=r.\"Id\" AND p.\"FinalPrice\" IS NOT NULL");
  migrationBuilder.Sql("UPDATE \"Ride\" r SET \"FinalFare\"=(o.\"Payload\"->>'totalFare')::numeric,\"FareSource\"='OFFICE_MANUAL' FROM \"ReceptionOrder\" o WHERE o.\"TenantId\"=r.\"TenantId\" AND o.\"RideRequestId\"=r.\"RideRequestId\" AND r.\"FinalFare\" IS NULL AND (o.\"Payload\"->>'totalFare')::numeric>0");
 }
 protected override void Down(MigrationBuilder migrationBuilder)=>throw new NotSupportedException("Fare data must be preserved; roll forward instead.");
}
