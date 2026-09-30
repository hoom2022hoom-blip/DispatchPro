"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';

const key = 'dispatchpro.queue-window.geometry.v1';
export function FloatingQueueWindow({open,onClose,children}:{open:boolean;onClose:()=>void;children:React.ReactNode}) {
 const panel=useRef<HTMLDivElement>(null);
 const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null);
 const resizing=useRef<{edge:string;x:number;y:number;left:number;top:number;width:number;height:number}|null>(null);
 const [box,setBox]=useState({left:24,top:60,width:380,height:620});
 const [mounted,setMounted]=useState(false);
 useEffect(()=>{setMounted(true);try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(saved&&['left','top','width','height'].every(k=>Number.isFinite(saved[k])))setBox({left:Math.max(0,Math.min(saved.left,innerWidth-280)),top:Math.max(0,Math.min(saved.top,innerHeight-80)),width:Math.max(280,Math.min(saved.width,innerWidth)),height:Math.max(280,Math.min(saved.height,innerHeight))});}catch{}},[]);
 useEffect(()=>{if(!open||!panel.current)return;const observer=new ResizeObserver(([entry])=>{const rect=entry.target.getBoundingClientRect();setBox(old=>old.width===rect.width&&old.height===rect.height?old:{...old,width:rect.width,height:rect.height});});observer.observe(panel.current);return()=>observer.disconnect();},[open,mounted]);
 useEffect(()=>{if(mounted)try{localStorage.setItem(key,JSON.stringify(box));}catch{}},[box,mounted]);
 if(!open||!mounted)return null;
 return createPortal(<div ref={panel} role="dialog" aria-modal="false" aria-label="نافذة دور السائقين" dir="rtl" style={{left:box.left,top:box.top,width:box.width,height:box.height,resize:'both',maxWidth:`calc(100vw - ${box.left}px)`,maxHeight:`calc(100dvh - ${box.top}px)`}} className="fixed z-40 flex min-h-[280px] min-w-[280px] flex-col overflow-hidden rounded-lg border bg-white shadow-xl">
  <div className="flex shrink-0 touch-none cursor-move items-center justify-between border-b bg-slate-100 px-2 py-1" onPointerDown={e=>{if((e.target as HTMLElement).closest('button'))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,left:box.left,top:box.top};}} onPointerMove={e=>{if(!drag.current)return;const start=drag.current;setBox(old=>({...old,left:Math.max(0,Math.min(innerWidth-280,start.left+e.clientX-start.x)),top:Math.max(0,Math.min(innerHeight-280,start.top+e.clientY-start.y))}));}} onPointerUp={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
   <strong className="text-sm">دور السائقين</strong><Button className="h-7 w-7 p-0" variant="ghost" aria-label="إغلاق نافذة الدور" onClick={onClose}>×</Button>
  </div>
  <div className="min-h-0 flex-1 overflow-hidden [&_aside]:h-full [&_aside]:w-full [&_aside]:max-w-none">{children}</div>
  {(['n','s','e','w','ne','nw','se','sw'] as const).map(edge=><span key={edge} role="separator" aria-label={`Resize queue window ${edge}`} className={`absolute z-50 touch-none ${edge==='n'?'inset-x-2 top-0 h-1 cursor-ns-resize':edge==='s'?'inset-x-2 bottom-0 h-1 cursor-ns-resize':edge==='e'?'inset-y-2 right-0 w-1 cursor-ew-resize':edge==='w'?'inset-y-2 left-0 w-1 cursor-ew-resize':`${edge.includes('n')?'top-0':'bottom-0'} ${edge.includes('e')?'right-0':'left-0'} h-2 w-2 ${edge==='ne'||edge==='sw'?'cursor-nesw-resize':'cursor-nwse-resize'}`}`} onPointerDown={event=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);resizing.current={edge,x:event.clientX,y:event.clientY,...box};}} onPointerMove={event=>{const start=resizing.current;if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;let {left,top,width,height}=start;if(start.edge.includes('e'))width=Math.max(280,Math.min(innerWidth-left,start.width+dx));if(start.edge.includes('s'))height=Math.max(280,Math.min(innerHeight-top,start.height+dy));if(start.edge.includes('w')){width=Math.max(280,Math.min(start.left+start.width,start.width-dx));left=start.left+start.width-width;}if(start.edge.includes('n')){height=Math.max(280,Math.min(start.top+start.height,start.height-dy));top=start.top+start.height-height;}setBox({left,top,width,height});}} onPointerUp={()=>{resizing.current=null;}} onLostPointerCapture={()=>{resizing.current=null;}}/>) }
 </div>,document.body);
}
