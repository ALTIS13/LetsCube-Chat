package com.kub.messenger;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Looper;
import android.os.Process;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

// Child-JVM behavioral source probe with explicit framework doubles, no Android/device effects.
public final class MessagePreviewForegroundAuthorityProbe {
    private interface Action { void run() throws Exception; }
    private static void check(boolean value,String tag){if(!value)throw new AssertionError(tag);}
    private static void unavailable(Action action,String tag) throws Exception {
        try {action.run();throw new AssertionError(tag);}
        catch(MessagePreviewForegroundAuthority.Unavailable denied){
            check("UNAVAILABLE".equals(denied.getMessage())&&denied.getCause()==null
                &&denied.getSuppressed().length==0&&denied.getStackTrace().length==0,"FIXED_UNAVAILABLE");
        }
    }
    private static void otherThread(final Action action) throws Exception {
        final AtomicReference<Throwable> error=new AtomicReference<>();
        Thread worker=new Thread(new Runnable(){public void run(){try{action.run();}catch(Throwable t){error.set(t);}}});
        worker.start();worker.join(2000);check(!worker.isAlive(),"FINITE_WORKER");
        if(error.get()!=null)throw new AssertionError("WORKER_ORACLE",error.get());
    }
    private static MessagePreviewForegroundAuthority resumed(Application app,MainActivity activity) throws Exception {
        MessagePreviewForegroundAuthority owner=MessagePreviewForegroundAuthority.getOrCreate(app);
        app.resume(activity);check(owner.isCurrent(owner.capture()),"HEALTHY_RESUMED_CONTROL");return owner;
    }
    private static void startup() throws Exception {
        final Application app=new Application();final MainActivity a=new MainActivity(app);
        app.resume(a);
        final MessagePreviewForegroundAuthority owner=MessagePreviewForegroundAuthority.getOrCreate(app);
        check(app.registers==1&&app.callbacks.size()==1,"EXACT_ONE_REGISTRATION");
        unavailable(new Action(){public void run()throws Exception{owner.capture();}},"MISSED_RESUME_MUST_NOT_GRANT");
        check(owner==MessagePreviewForegroundAuthority.getOrCreate(app)&&app.registers==1,"SINGLETON_SAME_APP");
        app.resume(a);Object first=owner.capture();check(owner.isCurrent(first),"ACTUAL_CALLBACK_GRANTS");
        check(!owner.isCurrent(null)&&!owner.isCurrent(new Object()),"MALFORMED_SNAPSHOT_REFUSES");
        owner.close();check(!owner.isCurrent(first)&&app.detaches==1&&app.callbacks.isEmpty(),"OWNED_CLOSE_DETACH");
    }
    private static void reentrantRegistration() throws Exception {
        final Application app=new Application();final MainActivity a=new MainActivity(app);
        app.duringRegister=new Runnable(){public void run(){app.last.onActivityResumed(a);}};
        final MessagePreviewForegroundAuthority owner=MessagePreviewForegroundAuthority.getOrCreate(app);
        unavailable(new Action(){public void run()throws Exception{owner.capture();}},"REGISTRATION_NOT_YET_CONFIRMED");
        app.resume(a);check(owner.isCurrent(owner.capture()),"CALLBACK_AFTER_REGISTER_CONTROL");owner.close();
    }
    private static void applications(String mode) throws Exception {
        final Application app=new Application();final MainActivity a=new MainActivity(app);
        if(mode.equals("two-apps")){
            final MessagePreviewForegroundAuthority owner=resumed(app,a);final Object before=owner.capture();
            final Application other=new Application();
            unavailable(new Action(){public void run()throws Exception{MessagePreviewForegroundAuthority.getOrCreate(other);}},"FOREIGN_APPLICATION_REFUSES");
            check(owner.isCurrent(before)&&other.registers==0,"NO_FOREIGN_REGISTRATION_OR_CLOBBER");owner.close();
        } else {
            if(mode.equals("uid"))app.info.uid=10124;
            else app.context=new Application();
            unavailable(new Action(){public void run()throws Exception{MessagePreviewForegroundAuthority.getOrCreate(app);}},"INVALID_APPLICATION_REFUSES");
            check(app.registers==0,"NO_REGISTRATION_BEFORE_OWNER_VALIDATION");
        }
    }
    private static void lifecycle(String mode) throws Exception {
        final Application app=new Application();final MainActivity a=new MainActivity(app),b=new MainActivity(app);
        final MessagePreviewForegroundAuthority owner=resumed(app,a);Object first=owner.capture();
        if(mode.equals("replacement")){
            app.resume(b);Object next=owner.capture();check(!owner.isCurrent(first)&&owner.isCurrent(next),"REPLACEMENT_RETIRES_A");
            app.pause(a);app.stop(a);app.destroy(a);check(owner.isCurrent(next),"OLD_CALLBACK_MUST_NOT_RETIRE_B");
            app.destroy(b);check(!owner.isCurrent(next),"DESTROY_RETIRES_B");
        } else if(mode.equals("pause")){
            app.pause(a);check(!owner.isCurrent(first),"PAUSE_RETIRES_SNAPSHOT");
            app.resume(a);check(!owner.isCurrent(first)&&owner.isCurrent(owner.capture()),"RESUME_NOT_ABA");
        } else if(mode.equals("stop")){
            app.stop(a);check(!owner.isCurrent(first),"STOP_RETIRES_SNAPSHOT");
        } else if(mode.equals("foreign-activity")){
            app.resume(new Activity(app));check(!owner.isCurrent(first),"OTHER_ACTIVITY_RETIRES_MAIN");
            unavailable(new Action(){public void run()throws Exception{owner.capture();}},"OTHER_ACTIVITY_MUST_NOT_GRANT");
            app.resume(a);check(owner.isCurrent(owner.capture()),"MAIN_CAN_RESUME_AFTER_OTHER_ACTIVITY");
        } else if(mode.equals("subclass")){
            class Derived extends MainActivity {Derived(){super(app);}}
            app.resume(new Derived());check(!owner.isCurrent(first),"SUBCLASS_MUST_NOT_GRANT");
            unavailable(new Action(){public void run()throws Exception{owner.capture();}},"SUBCLASS_MUST_NOT_GRANT");
        } else if(mode.equals("foreign-callback")){
            app.last.onActivityResumed(new MainActivity(new Application()));check(!owner.isCurrent(first),"FOREIGN_CALLBACK_MUST_NOT_GRANT");
            unavailable(new Action(){public void run()throws Exception{owner.capture();}},"FOREIGN_CALLBACK_MUST_NOT_GRANT");
        } else if(mode.equals("malformed-callback")){
            app.last.onActivityResumed(null);check(!owner.isCurrent(first),"MALFORMED_CALLBACK_MUST_RETIRE");
        }
        owner.close();
    }
    private static void preRetirement(String mode) throws Exception {
        Application app=new Application();MainActivity a=new MainActivity(app),b=new MainActivity(app);
        MessagePreviewForegroundAuthority owner=resumed(app,a);Object first=owner.capture();
        if(mode.equals("pre-old")){
            app.resume(b);Object next=owner.capture();
            app.last.onActivityPrePaused(a);app.last.onActivityPreStopped(a);app.last.onActivityPreDestroyed(a);
            check(owner.isCurrent(next)&&!owner.isCurrent(first),"PRE_OLD_CALLBACK_PRESERVES_B");
        } else {
            if(mode.equals("pre-pause"))app.last.onActivityPrePaused(a);
            if(mode.equals("pre-stop"))app.last.onActivityPreStopped(a);
            if(mode.equals("pre-destroy"))app.last.onActivityPreDestroyed(a);
            check(!owner.isCurrent(first),"PRE_CALLBACK_RETIRES_BEFORE_ORDINARY");
        }
        owner.close();
    }
    private static void retireBeforeContext() throws Exception {
        final Application app=new Application();MainActivity a=new MainActivity(app);
        final MessagePreviewForegroundAuthority owner=resumed(app,a);final Object before=owner.capture();
        app.duringRead=new Runnable(){public void run(){check(!owner.isCurrent(before),"RETIRE_BEFORE_CONTEXT_READ");}};
        app.pause(a);app.duringRead=null;owner.close();
    }
    private static void threadRules(String mode) throws Exception {
        final Application app=new Application();final MainActivity a=new MainActivity(app);
        if(mode.equals("off-main-create")){
            otherThread(new Action(){public void run()throws Exception{unavailable(new Action(){public void run()throws Exception{
                MessagePreviewForegroundAuthority.getOrCreate(app);}},"OFFMAIN_CREATE_REFUSES");}});
            check(app.registers==0,"OFFMAIN_NO_REGISTER");MessagePreviewForegroundAuthority.getOrCreate(app).close();return;
        }
        final MessagePreviewForegroundAuthority owner=resumed(app,a);final Object snap=owner.capture();
        if(mode.equals("memory-worker")){
            app.forbidReads=true;check(owner.isCurrent(owner.capture()),"MAIN_CAPTURE_MEMORY_ONLY");
            otherThread(new Action(){public void run()throws Exception{check(owner.isCurrent(snap),"WORKER_CURRENT_MEMORY_ONLY");}});
            app.forbidReads=false;
        } else if(mode.equals("off-main-capture")){
            otherThread(new Action(){public void run()throws Exception{unavailable(new Action(){public void run()throws Exception{
                owner.capture();}},"OFFMAIN_CAPTURE_REFUSES");}});check(owner.isCurrent(snap),"REFUSED_CAPTURE_NO_CLOBBER");
        } else if(mode.equals("off-main-callback")){
            otherThread(new Action(){public void run(){app.last.onActivityResumed(a);}});
            check(!owner.isCurrent(snap),"OFFMAIN_CALLBACK_MUST_RETIRE");app.resume(a);
            unavailable(new Action(){public void run()throws Exception{owner.capture();}},"BAD_CALLBACK_TERMINAL");
        } else if(mode.equals("off-main-close")){
            otherThread(new Action(){public void run()throws Exception{unavailable(new Action(){public void run()throws Exception{
                owner.close();}},"OFFMAIN_CLOSE_REFUSES");}});
            check(!owner.isCurrent(snap)&&app.detaches==0,"OFFMAIN_CLOSE_RETIRES_BEFORE_DETACH");
        }
        owner.close();
    }
    private static void closing(String mode) throws Exception {
        final Application app=new Application();final MainActivity a=new MainActivity(app);
        if(mode.equals("registration-failure")){
            app.failRegister=true;
            unavailable(new Action(){public void run()throws Exception{MessagePreviewForegroundAuthority.getOrCreate(app);}},"REGISTER_FAILURE_REFUSES");
            check(app.callbacks.isEmpty()&&app.registers==1&&app.detaches==1,"FAILED_REGISTER_OWNED_DETACH");
            app.failRegister=false;
            unavailable(new Action(){public void run()throws Exception{MessagePreviewForegroundAuthority.getOrCreate(app);}},"FAILED_REGISTRATION_NO_RECREATE");
            check(app.registers==1,"NO_RETRY_REGISTRATION");return;
        }
        final MessagePreviewForegroundAuthority owner=resumed(app,a);Object snap=owner.capture();
        if(mode.equals("detach-failure")){
            app.failDetach=true;
            unavailable(new Action(){public void run()throws Exception{owner.close();}},"DETACH_FAILURE_FIXED_REFUSAL");
            check(!owner.isCurrent(snap),"DETACH_FAILURE_MEMORY_RETIRED");app.resume(a);
            unavailable(new Action(){public void run()throws Exception{owner.capture();}},"DETACH_FAILURE_LATE_NO_GRANT");
            app.failDetach=false;owner.close();
        } else {
            owner.close();app.last.onActivityResumed(a);check(!owner.isCurrent(snap),"CLOSE_LATE_CALLBACK_NO_GRANT");
            unavailable(new Action(){public void run()throws Exception{owner.capture();}},"CLOSED_CAPTURE_REFUSES");
            owner.close();check(app.detaches==1,"CLOSE_IDEMPOTENT_DETACH");
        }
        unavailable(new Action(){public void run()throws Exception{MessagePreviewForegroundAuthority.getOrCreate(app);}},"CLOSED_OWNER_NO_RECREATE");
    }
    private static void overflow() throws Exception {
        Application app=new Application();MainActivity a=new MainActivity(app),b=new MainActivity(app);
        final MessagePreviewForegroundAuthority owner=resumed(app,a);Object old=owner.capture();
        // Fixture-only reflection reaches otherwise impractical arithmetic boundary; no production hook.
        Field epoch=MessagePreviewForegroundAuthority.class.getDeclaredField("epoch");epoch.setAccessible(true);epoch.setLong(owner,Long.MAX_VALUE-1);
        app.resume(b);Object last=owner.capture();check(!owner.isCurrent(old)&&owner.isCurrent(last),"LAST_EPOCH_CONTROL");
        app.pause(b);check(!owner.isCurrent(last),"OVERFLOW_RETIRES_LAST");app.resume(a);
        unavailable(new Action(){public void run()throws Exception{owner.capture();}},"OVERFLOW_TERMINAL_NO_WRAP");owner.close();
    }
    private static void gateWorker() throws Exception {
        final Application app=new Application();MainActivity a=new MainActivity(app);
        final MessagePreviewForegroundAuthority owner=resumed(app,a);
        final CountDownLatch admitted=new CountDownLatch(1),checked=new CountDownLatch(1),paused=new CountDownLatch(1);
        final AtomicReference<Throwable> error=new AtomicReference<>();
        final MessagePreviewInitializationGate[] gates={null};final MessagePreviewInitializationGate.Permit[] permits={null};
        Thread worker=new Thread(new Runnable(){public void run(){try{
            check(admitted.await(2,TimeUnit.SECONDS),"GATE_ADMITTED");gates[0].consume(permits[0]);gates[0].currentBeforeEffect(permits[0]);checked.countDown();
            check(paused.await(2,TimeUnit.SECONDS),"PASSIVE_PAUSE_OBSERVED");
            try {gates[0].currentBeforeEffect(permits[0]);throw new AssertionError("WORKER_AFTER_PAUSE_MUST_REFUSE");}
            catch(MessagePreviewInitializationGate.Unavailable expected){}
        }catch(Throwable t){error.set(t);checked.countDown();}}});
        gates[0]=new MessagePreviewInitializationGate(owner,new MessagePreviewInitializationGate.MonotonicClock(){public long nowMillis(){return 100;}},Thread.currentThread(),worker);
        permits[0]=gates[0].admit(gates[0].capture());worker.start();admitted.countDown();
        check(checked.await(2,TimeUnit.SECONDS)&&error.get()==null,"ACTUAL_GATE_WORKER_CONTROL");app.pause(a);paused.countDown();
        worker.join(2000);check(!worker.isAlive(),"GATE_WORKER_FINISHED");
        if(error.get()!=null)throw new AssertionError("GATE_WORKER_ORACLE",error.get());owner.close();
    }
    public static void main(String[] args) throws Exception {
        Looper.getMainLooper();String mode=args[0];
        if(mode.equals("startup"))startup();
        else if(mode.equals("reentrant-registration"))reentrantRegistration();
        else if(mode.equals("two-apps")||mode.equals("uid")||mode.equals("context"))applications(mode);
        else if(mode.equals("replacement")||mode.equals("pause")||mode.equals("stop")||mode.equals("foreign-activity")||mode.equals("subclass")||mode.equals("foreign-callback")||mode.equals("malformed-callback"))lifecycle(mode);
        else if(mode.startsWith("off-main")||mode.equals("memory-worker"))threadRules(mode);
        else if(mode.equals("close")||mode.equals("detach-failure")||mode.equals("registration-failure"))closing(mode);
        else if(mode.equals("overflow"))overflow();
        else if(mode.equals("gate-worker"))gateWorker();
        else if(mode.startsWith("pre-"))preRetirement(mode);
        else if(mode.equals("retire-before-context"))retireBeforeContext();
        else throw new AssertionError("UNKNOWN_SOURCE_CASE");
        System.out.println("PASS "+mode);
    }
}
