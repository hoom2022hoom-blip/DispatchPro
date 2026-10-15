export type MapCamera={longitude:number;latitude:number;zoom:number;bearing:number;pitch:number};
export const mapAnimationDuration=(milliseconds:number)=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:milliseconds;
// A distant fly-over loads tiles along its entire path. Jump to off-screen cars;
// keep the short animation when the selected car is already in view.
export function mapFocusDuration(point:{x:number;y:number},width:number,height:number){
 return Number.isFinite(point.x)&&Number.isFinite(point.y)&&width>0&&height>0&&point.x>=0&&point.x<=width&&point.y>=0&&point.y<=height?mapAnimationDuration(450):0;
}
export function savedMapCamera(raw:string|null):MapCamera|null {
 try {const x=JSON.parse(raw??'null');return x&&[x.longitude,x.latitude,x.zoom,x.bearing,x.pitch].every(Number.isFinite)&&Math.abs(x.longitude)<=180&&Math.abs(x.latitude)<=85&&x.zoom>=1&&x.zoom<=22&&Math.abs(x.bearing)<=360&&x.pitch>=0&&x.pitch<=60?x:null;}catch{return null;}
}
