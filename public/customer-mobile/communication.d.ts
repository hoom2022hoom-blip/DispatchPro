export class RideCommunication {
 constructor(request:<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>,options?:{native?:(type:string,data?:unknown)=>Promise<any>;update?:(unread:Record<string,number>)=>void});
 connect():Promise<void>;start(rideId:string):Promise<void>;dispose():void;open(callId:string,action?:string):void;
}
