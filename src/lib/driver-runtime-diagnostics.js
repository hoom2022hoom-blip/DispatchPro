/** @typedef {{at:number,stage:string,status?:string,http?:number,kind?:string,stack?:string,field?:string}} Entry */
/** @type {Entry[]} */
const entries=[];
const statuses=new Set(['Assigned','Accepted','DriverArriving','Arrived','InProgress','Completed','Cancelled','Rejected','Pending']);
/** @type {string|undefined} */ let currentStatus;
/** @param {string} stage @param {Partial<Omit<Entry,'at'|'stage'>>} data */
export function driverTrace(stage,data={}){
 /** @type {Entry} */ const entry={at:Date.now(),stage:stage.replace(/[^a-zA-Z0-9._-]/g,'').slice(0,60)};
 if(data.status&&statuses.has(data.status)){entry.status=data.status;currentStatus=data.status;}
 if(data.http!==undefined&&Number.isInteger(data.http))entry.http=data.http;
 if(data.kind)entry.kind=data.kind.replace(/[^a-zA-Z0-9]/g,'').slice(0,40);
 if(data.field)entry.field=data.field.replace(/[^a-zA-Z0-9._]/g,'').slice(0,60);
 // Keep only source positions, never exception messages, URLs, payloads or identities.
 if(data.stack)entry.stack=(data.stack.match(/(?:app\.js|driver-[a-z-]+\.(?:tsx?|js)):\d+:\d+/g)??[]).slice(0,8).join(' ');
 const last=entries.at(-1);if(last&&last.stage===entry.stage&&last.status===entry.status&&last.kind===entry.kind&&last.http===entry.http&&last.field===entry.field)return;
 entries.push(entry);if(entries.length>64)entries.shift();
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dispatchpro-driver-runtime',{detail:{...entry,status:entry.status??currentStatus}}));
}
export function driverDiagnostics(){return entries.map(e=>({...e}));}
export function installDriverErrorLogging(){
 /** @param {ErrorEvent} e */ const error=e=>driverTrace('uncaught',{kind:e.error?.name??'Error',stack:e.error?.stack});
 /** @param {PromiseRejectionEvent} e */ const rejection=e=>driverTrace('unhandled-rejection',{kind:e.reason?.name??'Error',stack:e.reason?.stack});
 window.addEventListener('error',error);window.addEventListener('unhandledrejection',rejection);
 return()=>{window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',rejection);};
}
