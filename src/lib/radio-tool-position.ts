export type RadioPosition={x:number;y:number};
export function savedRadioPosition(raw:string|null):RadioPosition|null {
 try{const value=JSON.parse(raw??'null');return value&&Number.isFinite(value.x)&&Number.isFinite(value.y)?{x:Math.max(0,Math.min(1,value.x)),y:Math.max(0,Math.min(1,value.y))}:null;}catch{return null;}
}
export function radioToolBounds(width:number,height:number,toolWidth:number,toolHeight:number){
 // Leave the left map toolbar visible on short maps. Taller maps have room
 // beneath its three controls, so retain the original left inset there.
 const belowToolbar=height>=toolHeight+276;
 const left=belowToolbar?12:Math.min(64,Math.max(12,width-toolWidth-12)),top=belowToolbar?240:12;
 return {left,top,right:Math.max(left,width-toolWidth-12),bottom:Math.max(top,height-toolHeight-36)};
}
export function radioToolPoint(position:RadioPosition|null,bounds:ReturnType<typeof radioToolBounds>){
 return {left:bounds.left+(bounds.right-bounds.left)*(position?.x??0),top:bounds.top+(bounds.bottom-bounds.top)*(position?.y??1)};
}
export function radioToolPosition(left:number,top:number,bounds:ReturnType<typeof radioToolBounds>):RadioPosition {
 return {x:Math.max(0,Math.min(1,(left-bounds.left)/Math.max(1,bounds.right-bounds.left))),y:Math.max(0,Math.min(1,(top-bounds.top)/Math.max(1,bounds.bottom-bounds.top)))};
}
