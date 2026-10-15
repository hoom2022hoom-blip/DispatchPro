export type DriverJob = { id:string; rideId:string; driverId:string; position:number; version:number; pickup:string; destination:string; createdAt:string };
export type DriverJobAction = { type:'send'|'add'|'move'|'remove'|'withdraw'; rideId:string; version:number; driverId?:string; position?:number; shareCustomerPhone?:boolean };
