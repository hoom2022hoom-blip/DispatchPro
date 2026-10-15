// Explicitly read-only operational diagnosis: no credentials or customer fields in output.
const fs=require('node:fs'),path=require('node:path');
const {sql}=require('../../artifacts/home-runtime-update-20261010/pg-tools.cjs');
const out=path.resolve(process.argv[2]);
const result=JSON.parse(sql(`BEGIN TRANSACTION READ ONLY;SET LOCAL statement_timeout='5s';
 SELECT coalesce(json_agg(row_to_json(x)),'[]') FROM (
 SELECT left(md5(r."Id"::text),8) AS "rideRef",left(md5(r."DriverId"::text),8) AS "driverRef",r."Status" AS "status",r."Version" AS "version",r."FareMode" AS "fareMode",r."FareSource" AS "fareSource",r."FinalFare" IS NOT NULL AS "hasFinalFare",r."MeterCalculatedFare" IS NOT NULL AS "hasMeterFare",r."MeterStartedAt" IS NOT NULL AS "meterStarted",length(trim(q."Destination"))>0 AS "hasDestination",q."Source" AS "source",d."Status" AS "driverStatus",d."Active" AS "driverActive",d."DriverAppEnabled" AS "driverAppEnabled",
 (SELECT count(*) FROM "DriverJob" j WHERE j."DriverId"=r."DriverId") AS "queuedJobs",
 (SELECT max(a."CreatedAt") FROM "AuditLog" a WHERE a."EntityId"=r."Id" AND a."Action"='ride.status') AS "lastTransitionAt",
 (SELECT coalesce(json_agg(json_build_object('at',a."CreatedAt",'status',a."Detail") ORDER BY a."CreatedAt"),'[]') FROM "AuditLog" a WHERE a."EntityId"=r."Id" AND a."Action"='ride.status') AS "transitions"
 FROM "Ride" r JOIN "RideRequest" q ON q."Id"=r."RideRequestId" JOIN "Driver" d ON d."Id"=r."DriverId"
 WHERE r."Status" IN (1,2,3,4,7) AND (SELECT count(*) FROM "DriverJob" j WHERE j."DriverId"=r."DriverId")=3
 ORDER BY r."Id" LIMIT 5
 ) x;ROLLBACK;`));
const statuses=['Pending','Assigned','Accepted','Arrived','InProgress','Completed','Cancelled','DriverArriving','Rejected','NoDriverAvailable'];
const drivers=['Offline','Available','Busy','Suspended'];
for(const r of result){r.status=statuses[r.status];r.driverStatus=drivers[r.driverStatus];}
const report={at:new Date().toISOString(),readOnlyTransaction:true,customerFieldsRead:false,productionWrites:false,matches:result};
fs.writeFileSync(path.join(out,'server-readonly-state.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
