import com.dispatchpro.driver.DriverRequestPolicy;
import java.util.concurrent.*;
public final class DriverRequestPolicyTest {
    public static void main(String[] args)throws Exception {
        ExecutorService polls=Executors.newFixedThreadPool(3),actions=Executors.newFixedThreadPool(3);
        CountDownLatch entered=new CountDownLatch(3),release=new CountDownLatch(1);
        try{
            for(String path:new String[]{"driver/updates?cursor=1","voice/updates?cursor=2","driver/rides/id/chat?after=3&wait=true"}){
                if(!DriverRequestPolicy.longPoll("GET",path))throw new AssertionError(path);
                polls.submit(()->{entered.countDown();try{release.await();}catch(InterruptedException ignored){}});
            }
            if(!entered.await(1,TimeUnit.SECONDS))throw new AssertionError("Poll fixture did not fill the lane");
            for(String path:new String[]{"rides/id/status","driver/location","auth/driver-refresh"}){
                if(DriverRequestPolicy.longPoll("PUT",path))throw new AssertionError(path);
                if(!actions.submit(()->true).get(1,TimeUnit.SECONDS))throw new AssertionError("Mutation blocked behind polls");
            }
            if(DriverRequestPolicy.longPoll("GET","driver/rides/id/chat?before=1"))throw new AssertionError("History is an ordinary read");
            System.out.println("PASS: three occupied long polls do not block Start Trip, GPS or refresh");
        }finally{release.countDown();polls.shutdownNow();actions.shutdownNow();}
    }
}
