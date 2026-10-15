import type {DriverRide} from './driver-api';

const nonnegative = (value:unknown) => typeof value==='number'&&Number.isFinite(value)?Math.max(0,value):0;
// A meter may not have a first GPS sample yet. Never format null/invalid values
// directly in the render path, and never fabricate a fare for a missing reading.
export function driverTripMetrics(ride:DriverRide, now:number) {
  const started=Date.parse(ride.meterStartedAt??ride.startedAt??'');
  const elapsed=Number.isFinite(started)&&Number.isFinite(now)?Math.max(0,(now-started)/1000):0;
  return {distance:nonnegative(ride.distanceKm).toFixed(1),minutes:Math.floor(Math.max(nonnegative(ride.durationSeconds),elapsed)/60),fare:typeof ride.meterCalculatedFare==='number'&&Number.isFinite(ride.meterCalculatedFare)?ride.meterCalculatedFare:null};
}
