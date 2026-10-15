export type PressCapture={stream:MediaStream;commit:()=>void;stop:(drain?:boolean)=>Promise<void>};
export type CaptureFactory={prepare:()=>Promise<void>;begin:(id:string,signal:AbortSignal,metric:(name:string,ms:number)=>void)=>Promise<PressCapture>;dispose:()=>void};
export function prepareVoiceBuffer():Promise<void>;
export function voiceBuffer(id:string,signal:AbortSignal,metric:(name:string,ms:number)=>void):Promise<PressCapture&{firstFrame:Promise<void>;attach:(stream:MediaStream)=>void;push:(values:Float32Array)=>void}>;
export function browserPressCapture(id:string,signal:AbortSignal,microphone:()=>Promise<MediaStream>,metric:(name:string,ms:number)=>void,stopInput:()=>void):Promise<PressCapture>;
