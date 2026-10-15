package com.dispatchpro.driver;
import android.media.AudioRecord;import org.junit.*;import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=34)
public class RadioCaptureTest {
 @Test public void preparedRecorderDoesNotCaptureBeforePress()throws Exception{
  RadioCapture capture=new RadioCapture();try{capture.prepare();assertEquals(AudioRecord.RECORDSTATE_STOPPED,capture.recorder.getRecordingState());assertFalse(capture.running);assertEquals("",capture.attempt);assertEquals(0,capture.queued);AudioRecord previous=capture.recorder;capture.prepare();assertSame(previous,capture.recorder);}finally{capture.close();capture.worker.awaitTermination(2,java.util.concurrent.TimeUnit.SECONDS);}
 }
 @Test public void anotherPressCannotPullBufferedPcmAndDiscardErasesIt()throws Exception{
  RadioCapture capture=new RadioCapture();byte[] speech={1,2,3,4};capture.attempt="first";capture.queue.add(speech);capture.queued=4;
  assertEquals("",capture.pull("second"));assertEquals(4,capture.queued);capture.discard("first");assertEquals(0,capture.queued);assertArrayEquals(new byte[4],speech);assertEquals("",capture.pull("first"));capture.close();
 }
}
