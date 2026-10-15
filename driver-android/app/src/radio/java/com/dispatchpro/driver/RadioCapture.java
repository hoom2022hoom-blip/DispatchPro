package com.dispatchpro.driver;
import android.media.*;
import android.media.audiofx.*;
import android.os.*;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.util.*;
import java.util.concurrent.*;

/** Stopped hardware configuration is reusable; PCM exists only during a press. */
final class RadioCapture {
 static final int RATE=48000,FRAME=960,LIMIT=RATE*2*4;
 final ExecutorService worker=Executors.newSingleThreadExecutor();
 final ArrayDeque<byte[]> queue=new ArrayDeque<>();
 final ArrayList<AudioEffect> effects=new ArrayList<>();
 volatile AudioRecord recorder;volatile String attempt="";volatile boolean running,failed;
 int queued;boolean closed;
 synchronized void prepare() {
  if(closed)throw new IllegalStateException("Capture closed");if(recorder!=null)return;
  int minimum=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
  if(minimum<=0)throw new IllegalStateException("Microphone format unavailable");
  recorder=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
   .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
   .setBufferSizeInBytes(Math.max(minimum,FRAME*2*4)).build();
  if(recorder.getState()!=AudioRecord.STATE_INITIALIZED){recorder.release();recorder=null;throw new IllegalStateException("Microphone initialization failed");}
  int session=recorder.getAudioSessionId();
  if(AcousticEchoCanceler.isAvailable())enable(AcousticEchoCanceler.create(session));
  if(NoiseSuppressor.isAvailable())enable(NoiseSuppressor.create(session));
  if(AutomaticGainControl.isAvailable())enable(AutomaticGainControl.create(session));
  // No startRecording(), read(), PCM or microphone-active state during prepare.
 }
 void enable(AudioEffect effect){if(effect!=null){try{effect.setEnabled(true);effects.add(effect);}catch(RuntimeException e){effect.release();}}}
 void prepareAsync(Runnable ready,java.util.function.Consumer<Exception> failure){worker.execute(()->{try{prepare();ready.run();}catch(Exception e){failure.accept(e);}});}
 void start(String id,Runnable ready,java.util.function.Consumer<Exception> failure){
  synchronized(this){if(!attempt.isEmpty())throw new IllegalStateException("Capture already active");clear();failed=false;attempt=id;running=true;}
  worker.execute(()->{long at=SystemClock.elapsedRealtime();boolean notified=false;
   try{android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);prepare();AudioRecord r=recorder;
    synchronized(this){if(!running||!attempt.equals(id))return;r.startRecording();}
    if(r.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException("Microphone did not start");
    while(running&&attempt.equals(id)){
     short[] samples=new short[FRAME];int count=r.read(samples,0,samples.length,AudioRecord.READ_BLOCKING);if(!running||!attempt.equals(id)){Arrays.fill(samples,(short)0);break;}if(count<0)throw new IllegalStateException("Microphone read failed");int size=count*2;byte[] frame=new byte[size];for(int i=0;i<count;i++){frame[i*2]=(byte)samples[i];frame[i*2+1]=(byte)(samples[i]>>8);}Arrays.fill(samples,(short)0);
     synchronized(this){if(!running||!attempt.equals(id)){Arrays.fill(frame,(byte)0);break;}if(queued+size>LIMIT)throw new IllegalStateException("Capture buffer overflow");if(size!=frame.length)frame=Arrays.copyOf(frame,size);queue.add(frame);queued+=size;}
     if(!notified&&size>0){notified=true;android.util.Log.i("TNMMedia","stage=radioCaptureFirstFrameMs ms="+(SystemClock.elapsedRealtime()-at));ready.run();}
    }
   }catch(Exception e){failed=true;stop(id);if(!notified)failure.accept(e);else android.util.Log.i("TNMMedia","stage=radioCaptureFailure ms=1");}
  });
 }
 synchronized String pull(String id){if(!attempt.equals(id))return "";ByteArrayOutputStream result=new ByteArrayOutputStream();while(!queue.isEmpty()&&result.size()<FRAME*2*8){byte[] frame=queue.remove();queued-=frame.length;result.write(frame,0,frame.length);Arrays.fill(frame,(byte)0);}byte[] bytes=result.toByteArray();String value=Base64.encodeToString(bytes,Base64.NO_WRAP);Arrays.fill(bytes,(byte)0);return value;}
 void stop(String id){AudioRecord r;synchronized(this){if(!attempt.equals(id))return;running=false;r=recorder;}if(r!=null&&r.getRecordingState()==AudioRecord.RECORDSTATE_RECORDING)try{r.stop();}catch(RuntimeException ignored){} }
 synchronized void discard(String id){if(!attempt.equals(id))return;stop(id);attempt="";clear();}
 synchronized void clear(){for(byte[] frame:queue)Arrays.fill(frame,(byte)0);queue.clear();queued=0;}
 void close(){synchronized(this){stop(attempt);attempt="";clear();closed=true;}worker.execute(()->{synchronized(this){for(AudioEffect effect:effects)effect.release();effects.clear();if(recorder!=null){recorder.release();recorder=null;}}});worker.shutdown();}
}
