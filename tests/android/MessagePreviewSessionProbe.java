package com.kub.messenger;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import com.getcapacitor.Bridge;
import java.io.File;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** Actual owner/producer/crypto/session; Android lifecycle and HTTP are labeled doubles. */
public final class MessagePreviewSessionProbe {
    static final String USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",SESSION="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    static final String DEVICE="cccccccc-cccc-4ccc-8ccc-ccccccccccc1",ACCESS="fictional-access",KEY="fictional-public-key";
    static Class<?> type,completionType;
    static Object session;
    static int auths,sdkReads,resolvers,replies;
    static Boolean reply;
    static boolean invalidateBeforeVerify;
    static volatile boolean reject;
    static volatile Runnable afterAuth=()->{};
    static volatile Runnable beforeReply=()->{};
    static void need(boolean yes,String oracle){if(!yes)throw new AssertionError(oracle);}
    static Map<String,Object> map(Object...pairs){Map<String,Object> r=new HashMap<>();for(int i=0;i<pairs.length;i+=2)r.put((String)pairs[i],pairs[i+1]);return r;}
    static Object call(String name,Class<?>[] types,Object...args)throws Exception {
        Method m=type.getDeclaredMethod(name,types);m.setAccessible(true);
        try{return m.invoke(Modifier.isStatic(m.getModifiers())?null:session,args);}catch(InvocationTargetException e){
            if(e.getCause() instanceof Error)throw (Error)e.getCause();throw e;}
    }
    static void pump(BooleanSupplier done,String oracle)throws Exception {long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
        while(!done.getAsBoolean()&&System.nanoTime()<end){Runnable r=Handler.take(20);if(r!=null)r.run();}need(done.getAsBoolean(),oracle);}
    static final class App extends Application {
        final File root;final UserManager user=new UserManager();final ApplicationInfo info=new ApplicationInfo();
        App(String path){root=new File(path);info.uid=10123;}
        public Context getApplicationContext(){return this;}public boolean isDeviceProtectedStorage(){return false;}
        public File getNoBackupFilesDir(){return root;}public Object getSystemService(String name){return user;}
        public ApplicationInfo getApplicationInfo(){return info;}
    }
    static MessagePreviewVerificationRuntime verifier(){
        var state=new MessagePreviewVerificationState(new MessagePreviewVerificationState.Clock(){
            public long wallTime(){return System.currentTimeMillis();}public long elapsedTime(){return SystemClock.value;}});
        return new MessagePreviewVerificationRuntime(state,deadline->{sdkReads++;return "fictional-sdk-token";},
            new MessagePreviewVerificationRuntime.Transport(){public void cancel(){}
                public Object request(boolean auth,String access,String key,String hash,long deadline){
                    need(!Thread.holdsLock(session),"NO_SESSION_LOCK_ACROSS_HTTP");need(Thread.currentThread().getName().equals("NmpvPristineOwner"),"SOLE_OWNER_VERIFICATION_THREAD");
                    need(ACCESS.equals(access)&&KEY.equals(key),"EXACT_INPUT");
                    if(auth){auths++;afterAuth.run();return map("id",reject?DEVICE:USER,"is_anonymous",false);}
                    resolvers++;return Arrays.asList(map("binding_v",1,"recipient_id",USER,"session_id",SESSION,"device_id",DEVICE));
                }},value->ACCESS.equals(value)?map("role","authenticated","aud","authenticated","is_anonymous",false,
                    "iss","https://core.letscube.ru/auth/v1","sub",USER,"session_id",SESSION,"exp",System.currentTimeMillis()/1000+300):map("role","anon"));
    }
    static void verify(Object bridge,MessagePreviewVerificationRuntime runtime,long rev)throws Exception {
        verify(bridge,runtime,rev,null);
    }
    static void verify(Object bridge,MessagePreviewVerificationRuntime runtime,long rev,java.util.function.Consumer<Boolean> observer)throws Exception {
        reply=null;replies=0;String epoch=runtime.beginBinding(rev,USER,SESSION,7);need(epoch!=null,"NATIVE_BEGIN");
        if(invalidateBeforeVerify)call("invalidate",new Class<?>[]{Object.class,MessagePreviewVerificationRuntime.class,long.class},bridge,runtime,rev);
        Object completion=Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{completionType},(p,m,a)->{
            if(m.getName().equals("complete")){beforeReply.run();reply=(Boolean)a[0];replies++;if(observer!=null)observer.accept(reply);}return null;});
        call("verify",new Class<?>[]{Object.class,MessagePreviewVerificationRuntime.class,long.class,String.class,String.class,String.class,long.class,String.class,String.class,String.class,long.class,completionType},
            bridge,runtime,rev,epoch,USER,SESSION,7L,DEVICE,ACCESS,KEY,18000L,completion);
    }
    static MessagePreviewMetadataEnvelope.Record record(App app)throws Exception {
        var ns=new File(app.root,"native-message-previews-v1");
        String installation=MessagePreviewInstallationMarker.decode(Files.readAllBytes(new File(ns,"installation-v1.bin").toPath()));
        return MessagePreviewMetadataEnvelope.open(Files.readAllBytes(new File(ns,"journal-v1.bin").toPath()),installation,
            MessagePreviewProducerPlatform.keys.get("letscube.nmpv.metadata.v1."+installation));
    }
    static void invalidate(Object bridge,MessagePreviewVerificationRuntime runtime,long revision)throws Exception {
        runtime.clearBinding(revision);
        call("invalidate",new Class<?>[]{Object.class,MessagePreviewVerificationRuntime.class,long.class},bridge,runtime,revision);
    }
    static boolean retired(App app){try{return MessagePreviewProducerPlatform.credentials()==0
        &&record(app).header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY;}catch(Exception incomplete){return false;}}
    static boolean sessionIdle(){try{
        Field busy=type.getDeclaredField("busy");busy.setAccessible(true);
        return !busy.getBoolean(session)&&Handler.mainQueue.isEmpty();
    }catch(Exception failure){throw new AssertionError("SESSION_IDLE_OBSERVABLE");}}
    static void heldBootstrap(String scenario,App app,MainActivity activity,Object bridge,MessagePreviewVerificationRuntime runtime)throws Exception {
        boolean credential=scenario.equals("credential-held-clear");
        CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1);
        MessagePreviewProducerPlatform.afterGenerate=()->{
            if((MessagePreviewProducerPlatform.credentials()>0)!=credential)return;
            need(Thread.currentThread().getName().equals("NmpvPristineOwner"),"ACTUAL_OWNER_KEYGEN_LATCH");
            held.countDown();try{need(release.await(4,TimeUnit.SECONDS),"RELEASE_KEYGEN");}
            catch(InterruptedException interrupted){throw new AssertionError("INTERRUPTED");}
        };
        List<Boolean> superseded=new ArrayList<>(),latest=new ArrayList<>();
        try{
            if(credential)verify(bridge,runtime,1,latest::add);else invalidate(bridge,runtime,1);
            pump(()->held.getCount()==0,"BOOTSTRAP_KEYGEN_HELD");
            need(MessagePreviewProducerPlatform.keys.size()==(credential?2:1),"ONLY_EXPECTED_KEY_MINTED");
            if(credential){
                invalidate(bridge,runtime,2);
                Object owner=MessagePreviewDocumentProbe.field(session,"owner");
                Object state=MessagePreviewDocumentProbe.field(owner,"initialized");
                Object acquisition=MessagePreviewDocumentProbe.field(state,"acquisition");
                need(Boolean.TRUE.equals(MessagePreviewDocumentProbe.field(acquisition,"cancelled")),"LOADED_CREDENTIAL_OWNER_INVALIDATED");
            }else{
                need(auths==0&&sdkReads==0&&resolvers==0&&MessagePreviewProducerPlatform.credentials()==0,"BOOTSTRAP_HAS_NO_ACCOUNT_AUTHORITY");
                if(scenario.equals("bootstrap-latest")||scenario.equals("bootstrap-clear")||scenario.equals("bootstrap-rebind"))
                    verify(bridge,runtime,2,superseded::add);
                if(scenario.equals("bootstrap-clear"))invalidate(bridge,runtime,3);
                else if(scenario.equals("bootstrap-rebind")){
                    Object replacement=new Object();var replacementRuntime=verifier();
                    call("attach",new Class<?>[]{Object.class,MessagePreviewVerificationRuntime.class},replacement,replacementRuntime);
                    verify(replacement,replacementRuntime,1,latest::add);
                    bridge=replacement;runtime=replacementRuntime;
                }else{
                    if(scenario.equals("bootstrap-pause"))activity.onPause();
                    verify(bridge,runtime,scenario.equals("bootstrap-latest")?3:2,latest::add);
                }
            }
            release.countDown();
            if(credential||scenario.equals("bootstrap-clear")){
                pump(()->sessionIdle()&&retired(app),"HELD_CLEAR_SETTLES_EMPTY");
                List<Boolean> ack=credential?latest:superseded;
                need(ack.equals(Arrays.asList(false))&&MessagePreviewProducerPlatform.credentials()==0,"HELD_CLEAR_FALSE_ONCE");
                if(!credential)need(auths==0&&sdkReads==0&&resolvers==0,"CLEARED_BOOTSTRAP_NEVER_AUTHORIZES");
                return;
            }
            pump(()->!latest.isEmpty(),"BOOTSTRAP_OVERLAP_ACK");
            if(scenario.equals("bootstrap-pause")){
                need(latest.equals(Arrays.asList(false))&&auths==0&&MessagePreviewProducerPlatform.credentials()==0,"PAUSED_BOOTSTRAP_REFUSES");
                var namespace=new File(app.root,"native-message-previews-v1");
                var marker=new File(namespace,"installation-v1.bin");byte[] before=Files.readAllBytes(marker.toPath());
                var keys=new HashMap<>(MessagePreviewProducerPlatform.keys);
                need(!new File(namespace,"journal-v1.bin").exists(),"PAUSED_BOOTSTRAP_NO_JOURNAL");
                MessagePreviewProducerPlatform.afterGenerate=null;activity.onResume();
                List<Boolean> retry=new ArrayList<>();verify(bridge,runtime,3,retry::add);
                pump(()->!retry.isEmpty(),"PAUSED_LATER_VERIFY_REFUSED");
                need(retry.equals(Arrays.asList(false))&&keys.equals(MessagePreviewProducerPlatform.keys)
                    &&Arrays.equals(before,Files.readAllBytes(marker.toPath()))&&auths==0,"PAUSED_BOOTSTRAP_RESIDUE_NEVER_RESET");
                return;
            }
            need(latest.equals(Arrays.asList(true))&&auths==1&&sdkReads==2&&resolvers==1,"BOOTSTRAP_OVERLAP_COMMITS_LATEST");
            if(!superseded.isEmpty())need(superseded.equals(Arrays.asList(false)),"SUPERSEDED_BOOTSTRAP_ACK_FALSE_ONCE");
            if(scenario.equals("bootstrap-latest")||scenario.equals("bootstrap-rebind"))
                need(superseded.equals(Arrays.asList(false)),"SUPERSEDED_BOOTSTRAP_ACK_FALSE_ONCE");
            var head=record(app);need(head.header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED&&head.header.generation==2
                &&head.header.vaultRevision==2&&MessagePreviewProducerPlatform.credentials()==1,"BOOTSTRAP_LATEST_EXACT_COMMIT");
        }finally{release.countDown();MessagePreviewProducerPlatform.afterGenerate=null;}
    }
    static void idleClear(String scenario,App app,Object bridge,MessagePreviewVerificationRuntime runtime)throws Exception {
        File namespace=new File(app.root,"native-message-previews-v1"),journal=new File(namespace,"journal-v1.bin");
        boolean damaged=!scenario.equals("idle-clear-login");
        if(scenario.equals("idle-clear-corrupt")||scenario.equals("idle-clear-missing-key")){
            MessagePreviewDocumentProbe.seed(app);
            if(scenario.equals("idle-clear-corrupt")){
                byte[] bytes=Files.readAllBytes(journal.toPath());bytes[bytes.length-1]^=1;Files.write(journal.toPath(),bytes);
            }else MessagePreviewProducerPlatform.keys.remove("letscube.nmpv.metadata.v1.11111111111111111111111111111111");
        }else if(scenario.equals("idle-clear-unknown-namespace")){
            need(namespace.mkdir(),"FIXTURE_NAMESPACE");Files.write(new File(namespace,"unknown.bin").toPath(),new byte[]{1,2,3});
        }else if(scenario.equals("idle-clear-orphan-key")){
            MessagePreviewProducerPlatform.keys.put("letscube.nmpv.metadata.v1.11111111111111111111111111111111",new MessagePreviewProducerPlatform.Handle());
        }
        Map<String,byte[]> before=new TreeMap<>();
        if(namespace.exists())for(File file:namespace.listFiles())before.put(file.getName(),Files.readAllBytes(file.toPath()));
        var keysBefore=new HashMap<>(MessagePreviewProducerPlatform.keys);
        invalidate(bridge,runtime,1);pump(MessagePreviewSessionProbe::sessionIdle,"INITIAL_CLEAR_SETTLES_WITHOUT_LOGIN");
        need(auths==0&&sdkReads==0&&resolvers==0&&reply==null,"SIGNED_OUT_CLEAR_HAS_NO_AUTH_OR_ACK");
        boolean cleared=!damaged&&retired(app)&&record(app).header.generation==1&&record(app).header.vaultRevision==1
            &&MessagePreviewSession.captureContent()==null;
        verify(bridge,runtime,2);pump(()->reply!=null,"LATER_LOGIN_ACK");
        if(damaged){
            need(Boolean.FALSE.equals(reply)&&replies==1&&auths==0&&sdkReads==0&&resolvers==0,"DAMAGED_CLEAR_NEVER_AUTHORIZES");
            need(keysBefore.equals(MessagePreviewProducerPlatform.keys)&&MessagePreviewProducerPlatform.trace.isEmpty(),"DAMAGED_CLEAR_NO_KEY_RESET");
            Map<String,byte[]> after=new TreeMap<>();
            if(namespace.exists())for(File file:namespace.listFiles())after.put(file.getName(),Files.readAllBytes(file.toPath()));
            need(before.keySet().equals(after.keySet()),"DAMAGED_CLEAR_NO_NAMESPACE_RESET");
            for(String name:before.keySet())need(Arrays.equals(before.get(name),after.get(name)),"DAMAGED_CLEAR_BYTES_RETAINED");
            return;
        }
        need(Boolean.TRUE.equals(reply)&&replies==1&&auths==1&&sdkReads==2&&resolvers==1,"IDLE_CLEAR_LATER_LOGIN_COMMITS");
        need(cleared,"IDLE_CLEAR_CONFIRMED_EMPTY");
        var committed=record(app);need(committed.header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED
            &&committed.header.generation==2&&committed.header.vaultRevision==2&&MessagePreviewProducerPlatform.credentials()==1,"IDLE_CLEAR_LOGIN_NEW_COMMITTED_HEAD");
        need(MessagePreviewCredentialEnvelope.verifyMatch(committed,committed.header,new MessagePreviewVaultFence.Owner(USER,SESSION,DEVICE,7),ACCESS,
            committed.header.expiresWallMillis,MessagePreviewProducerPlatform.keys.get(committed.header.alias)),"IDLE_CLEAR_LOGIN_EXACT_CREDENTIAL");
    }
    static void run(String scenario,String path)throws Exception {
        try{type=Class.forName("com.kub.messenger.MessagePreviewSession");completionType=Class.forName(type.getName()+"$Completion");}
        catch(ClassNotFoundException absent){throw new AssertionError("ORDINARY_SESSION_ENTRY_REQUIRED");}
        Looper.getMainLooper();SystemClock.value=10000;MessagePreviewProducerPlatform.install();
        App app=new App(path);var activity=new MainActivity();activity.application=app;Bridge bridge=new Bridge(activity);activity.bridge=bridge;
        session=call("getOrCreate",new Class<?>[]{Application.class},app);activity.onCreate(null);activity.onResume();
        var runtime=verifier();call("attach",new Class<?>[]{Object.class,MessagePreviewVerificationRuntime.class},bridge,runtime);
        if(scenario.startsWith("bootstrap-")||scenario.equals("credential-held-clear")){heldBootstrap(scenario,app,activity,bridge,runtime);return;}
        if(scenario.startsWith("idle-clear-")){idleClear(scenario,app,bridge,runtime);return;}
        if(scenario.equals("reject"))reject=true;
        CountDownLatch held=new CountDownLatch(1),release=new CountDownLatch(1);
        if(scenario.equals("held-logout"))afterAuth=()->{held.countDown();try{need(release.await(4,TimeUnit.SECONDS),"RELEASE");}catch(InterruptedException e){throw new AssertionError("INTERRUPTED");}};
        invalidateBeforeVerify=scenario.equals("begin-invalidate");
        verify(bridge,runtime,1);
        if(scenario.equals("queued-ack-invalidate")||scenario.equals("queued-ack-deadline")){
            pump(()->((MessagePreviewSession)session).binding(bridge,runtime)!=null,"COMMIT_BEFORE_QUEUED_ACK");
            need(reply==null,"ACK_IS_DEFERRED_TO_MAIN_QUEUE");
            if(scenario.equals("queued-ack-invalidate"))invalidate(bridge,runtime,2);
            else SystemClock.value=18000;
            pump(()->reply!=null,"QUEUED_ACK_DELIVERED");
            need(Boolean.FALSE.equals(reply)&&replies==1,"QUEUED_ACK_REVALIDATES_ONCE");
            if(scenario.equals("queued-ack-invalidate"))pump(()->retired(app),"QUEUED_ACK_CANCEL_ERASURE");
            return;
        }
        if(scenario.equals("held-logout")){
            pump(()->held.getCount()==0,"HELD_HTTP");invalidate(bridge,runtime,2);release.countDown();
            pump(()->Boolean.FALSE.equals(reply)&&retired(app),"LOGOUT_RETIRES_HELD");
            need(replies==1,"ONCE_FALSE");return;
        }
        pump(()->reply!=null,"BOUNDED_ACK");
        if(scenario.equals("reject")){need(Boolean.FALSE.equals(reply)&&sdkReads==0,"NO_COMMIT_REFUSED_AUTH");return;}
        need(Boolean.TRUE.equals(reply)&&replies==1&&auths==1&&sdkReads==2&&resolvers==1,"ONE_VERIFIED_COMMIT");
        var first=record(app);need(first.header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED&&MessagePreviewProducerPlatform.credentials()==1,"COMMITTED_KEY");
        need(MessagePreviewCredentialEnvelope.verifyMatch(first,first.header,new MessagePreviewVaultFence.Owner(USER,SESSION,DEVICE,7),ACCESS,first.header.expiresWallMillis,
            MessagePreviewProducerPlatform.keys.get(first.header.alias)),"EXACT_CREDENTIAL");
        if(scenario.equals("pause")){activity.onPause();need(record(app).header.generation==first.header.generation&&MessagePreviewProducerPlatform.credentials()==1,"PAUSE_NOT_LOGOUT");}
        if(scenario.equals("begin-collision")||scenario.equals("retire-collision")){
            Field ownerField=type.getDeclaredField("owner");ownerField.setAccessible(true);
            var owner=(MessagePreviewPristineInitializer)ownerField.get(session);
            String pinned=owner.nextOperationId(first.header.vaultRevision+1);
            Field stateField=MessagePreviewPristineInitializer.class.getDeclaredField("initialized");stateField.setAccessible(true);
            Object state=stateField.get(owner);Field fenceField=state.getClass().getDeclaredField("fence");fenceField.setAccessible(true);
            Object fence=fenceField.get(state);Field ids=fence.getClass().getDeclaredField("seenIds");ids.setAccessible(true);
            // Model the one imported legacy replay pin; actual authenticated loading has its own probe.
            @SuppressWarnings("unchecked") Set<String> pins=(Set<String>)ids.get(fence);pins.add(pinned);
            Field accepted=state.getClass().getDeclaredField("acceptedOperations");accepted.setAccessible(true);
            @SuppressWarnings("unchecked") Set<String> ownerPins=(Set<String>)accepted.get(state);ownerPins.add(pinned);
            if(scenario.equals("retire-collision")){
                invalidate(bridge,runtime,2);pump(()->retired(app),"PINNED_RETIRE_REACHES_EMPTY");
                need(record(app).header.vaultRevision==first.header.vaultRevision+2&&pins.contains(pinned),"PINNED_RETIRE_SKIPS_ONCE");return;
            }
            verify(bridge,runtime,2);pump(()->reply!=null,"PINNED_BEGIN_ACK");
            need(Boolean.TRUE.equals(reply)&&record(app).header.vaultRevision==first.header.vaultRevision+2
                &&pins.contains(pinned),"PINNED_BEGIN_SKIPS_ONCE");return;
        }
        if(scenario.equals("logout")){
            invalidate(bridge,runtime,2);pump(()->retired(app),"LOGOUT_EXACT_ERASURE");
            need(record(app).header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY,"LOGOUT_EMPTY");
        }
        if(scenario.equals("refresh")||scenario.equals("singleton")){
            if(scenario.equals("singleton"))need(call("getOrCreate",new Class<?>[]{Application.class},app)==session,"ONE_APPLICATION_OWNER");
            verify(bridge,runtime,2);pump(()->reply!=null,"REFRESH_ACK");
            need(Boolean.TRUE.equals(reply)&&auths==2&&sdkReads==4&&resolvers==2,"REFRESH_ONE_NEW_TICKET");
            var second=record(app);need(second.header.generation>first.header.generation&&second.header.vaultRevision>first.header.vaultRevision
                &&!second.header.alias.equals(first.header.alias)&&MessagePreviewProducerPlatform.credentials()==1
                &&!MessagePreviewProducerPlatform.keys.containsKey(first.header.alias),"REFRESH_REPLACES_EXACT_OLD_KEY");
        }
        if(scenario.equals("stale")){
            invalidate(bridge,runtime,0);need(record(app).header.generation==first.header.generation&&MessagePreviewProducerPlatform.credentials()==1,"OLD_RETIREMENT_REFUSED");
        }
        if(scenario.equals("content-retirement")||scenario.equals("auth-denial")){
            var binding=(MessagePreviewSession.Binding)call("binding",new Class<?>[]{Object.class,MessagePreviewVerificationRuntime.class},bridge,runtime);
            need(binding!=null&&((MessagePreviewSession)session).allowContent(binding,"message"),"CONTENT_GRANTED_AFTER_NATIVE_CHOICE");
            var old=MessagePreviewSession.captureContent();need(old!=null&&MessagePreviewSession.contentCurrent(old),"CONTENT_PERMIT");
            if(scenario.equals("auth-denial")){
                invalidate(bridge,runtime,2);
                need(!MessagePreviewSession.contentCurrent(old),"AUTH_DENIES_BEFORE_ASYNC_ERASURE");
                pump(()->retired(app),"LOGOUT_EXACT_ERASURE");return;
            }
            need(((MessagePreviewSession)session).blockContent(binding),"CONTENT_BLOCKED");
            need(((MessagePreviewSession)session).allowContent(binding,"message"),"SUCCESSOR_CHOICE");
            need(!MessagePreviewSession.contentCurrent(old),"RETIRED_CONTENT_NEVER_REOPENS");
            int[] posts={0};need(!MessagePreviewSession.publishContent(old,()->posts[0]++)&&posts[0]==0,"NO_RETIRED_PUBLICATION");
        }
    }
    public static void main(String[] args){try{run(args[0],args[1]);System.out.println("PASS "+args[0]);}
        catch(Throwable e){System.err.println("FAIL "+(e instanceof AssertionError?e.getMessage():"UNEXPECTED"));System.exit(1);}}
}
