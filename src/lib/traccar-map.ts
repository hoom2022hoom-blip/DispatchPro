import type {TraccarPosition} from './traccar-service';

// The existing service can return an hour of history. One device must have one
// displayed fix, independent of response ordering. Never invent a replacement fix.
export function latestTraccarPositions(rows:TraccarPosition[]){
 const result=new Map<number,TraccarPosition>();
 const order=(p:TraccarPosition)=>{const fix=Date.parse(p.fixTime);return Number.isFinite(fix)?fix:Date.parse(p.serverTime)||0;};
 for(const row of rows){
  if(!row.valid||!Number.isFinite(row.latitude)||!Number.isFinite(row.longitude)||Math.abs(row.latitude)>90||Math.abs(row.longitude)>180||(row.latitude===0&&row.longitude===0))continue;
  const before=result.get(row.deviceId);
  if(!before||order(row)>order(before)||order(row)===order(before)&&Date.parse(row.serverTime)>Date.parse(before.serverTime))result.set(row.deviceId,row);
 }
 return result;
}

export function recordedSpeedLabel(speed:number|undefined){return typeof speed==='number'&&Number.isFinite(speed)&&speed>=0?Math.round(speed*1.852)+' كم/س':'غير متاحة';}
