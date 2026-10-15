import {nativeCall} from './native-bridge';
import {prepareVoiceBuffer,voiceBuffer,type CaptureFactory} from '../../src/lib/voice-preroll.js';
export const radioCapture:CaptureFactory={
 async prepare(){await Promise.all([prepareVoiceBuffer(),nativeCall('capture.prepare')]);},
 async begin(id,signal,metric){
  const stopHardware=()=>nativeCall('capture.stop',{attemptId:id}).catch(()=>{});
  const discard=()=>nativeCall('capture.discard',{attemptId:id}).catch(()=>{});
  const abort=()=>{void discard();};signal.addEventListener('abort',abort,{once:true});
  const at=performance.now(),recording=nativeCall('capture.start',{attemptId:id},signal);void recording.catch(()=>{});
  let buffer:Awaited<ReturnType<typeof voiceBuffer>>|null=null,stopped=false,timer:ReturnType<typeof setTimeout>|null=null;
  const push=async()=>{const value=await nativeCall<{pcm:string;failed?:boolean}>('capture.pull',{attemptId:id});if(value.failed)throw new Error('Microphone capture failed');if(!value.pcm)return false;const bytes=atob(value.pcm),samples=new Float32Array(bytes.length/2);for(let i=0;i<samples.length;i++){const n=bytes.charCodeAt(i*2)|(bytes.charCodeAt(i*2+1)<<8);samples[i]=(n>32767?n-65536:n)/32768;}buffer!.push(samples);return true;};
  const poll=async()=>{try{await push();}catch{stopped=true;metric('pttCaptureFailure',1);void discard();void buffer?.stop(false);}if(!stopped)timer=setTimeout(()=>void poll(),20);};
  try{buffer=await voiceBuffer(id,signal,metric);await recording;metric('pttNativeFirstFrameMs',performance.now()-at);if(signal.aborted)throw new DOMException('Aborted','AbortError');await push();void poll();
   return {stream:buffer.stream,commit:buffer.commit,stop:async drain=>{if(stopped)return;stopped=true;if(timer)clearTimeout(timer);await stopHardware();if(drain&&!signal.aborted)while(await push()){}await buffer!.stop(drain);await discard();signal.removeEventListener('abort',abort);}};
  }catch(e){stopped=true;await discard();void buffer?.stop(false);signal.removeEventListener('abort',abort);throw e;}
 },
 dispose(){void nativeCall('capture.close').catch(()=>{});}
};
