package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.SystemClock;
import java.io.File;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.LongSupplier;

/** Actual Session/provisioning/vault/credential/choice crypto. Android and capability HTTP are doubles. */
public final class MessagePreviewConsentProbe {
    static final String USER=MessagePreviewSessionProbe.USER,SESSION=MessagePreviewSessionProbe.SESSION,DEVICE=MessagePreviewSessionProbe.DEVICE;
    static final String ACCESS=MessagePreviewSessionProbe.ACCESS,KEY=MessagePreviewSessionProbe.KEY;
    static Class<?> type,completion;
    static Object consent;
    static MessagePreviewSession session;
    static MessagePreviewSession.Binding binding;
    static MessagePreviewSessionProbe.App app;
    static final AtomicLong wall=new AtomicLong();
    static final AtomicInteger requests=new AtomicInteger();
    static final AtomicReference<Throwable> portError=new AtomicReference<>();
    static volatile String server="message";
    static volatile Runnable duringHttp=()->{};
    static volatile Runnable beforeSaveWrite=()->{};
    static final AtomicInteger saveWallReads=new AtomicInteger();
    static Class<?> httpType;
    static Object httpPort;
    static volatile byte[] borrowed;
    static void need(boolean value,String code){if(!value)throw new AssertionError(code);}
    static Object field(Object object,String name)throws Exception{Field f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
    static Object invoke(String name,Class<?>[] types,Object... args)throws Exception{
        try{return type.getDeclaredMethod(name,types).invoke(consent,args);}
        catch(InvocationTargetException failure){if(failure.getCause() instanceof Error)throw (Error)failure.getCause();throw (Exception)failure.getCause();}
    }
    static final class Ack {
        final CountDownLatch done=new CountDownLatch(1);final AtomicInteger calls=new AtomicInteger();volatile Boolean result;boolean throwing;
        Object callback(){return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{completion},(p,m,a)->{
            result=(Boolean)a[0];calls.incrementAndGet();done.countDown();if(throwing)throw new IllegalStateException("fictional callback failure");return null;
        });}
        boolean value()throws Exception{need(done.await(6,TimeUnit.SECONDS),"BOUNDED_CONSENT_ACK");need(calls.get()==1,"COMPLETION_EXACTLY_ONCE");
            if(portError.get()!=null)throw new AssertionError("HTTP_PORT_CONTRACT");return Boolean.TRUE.equals(result);}
    }
    static Ack refresh()throws Exception{Ack a=new Ack();invoke("refresh",new Class<?>[]{MessagePreviewSession.Binding.class,completion},binding,a.callback());return a;}
    static Ack begin(long revision)throws Exception{Ack a=new Ack();invoke("begin",new Class<?>[]{MessagePreviewSession.Binding.class,long.class,completion},binding,revision,a.callback());return a;}
    static Ack confirm(long revision,String choice)throws Exception{Ack a=new Ack();invoke("confirm",new Class<?>[]{MessagePreviewSession.Binding.class,long.class,String.class,completion},binding,revision,choice,a.callback());return a;}
    static void allowed(boolean expected,String code){need((MessagePreviewSession.captureContent()!=null)==expected,code);}
    static void await(CountDownLatch latch){try{need(latch.await(5,TimeUnit.SECONDS),"LATCH_CONTROL");}catch(InterruptedException e){throw new AssertionError("INTERRUPTED");}}
    static MessagePreviewChoiceStore.Choice choice()throws Exception{
        AtomicReference<MessagePreviewChoiceStore.Choice> result=new AtomicReference<>();AtomicReference<Throwable> error=new AtomicReference<>();
        Thread t=new Thread(()->{try{var vault=MessagePreviewExistingVault.open(app);result.set(new MessagePreviewChoiceStore(app).read(vault.readCommitted(System.currentTimeMillis())));}catch(Throwable e){error.set(e);}});
        t.start();t.join(4000);need(!t.isAlive()&&error.get()==null,"DURABLE_CHOICE_READ");return result.get();
    }
    static void seed(long revision)throws Exception{
        AtomicReference<Throwable> error=new AtomicReference<>();Thread t=new Thread(()->{try{var head=MessagePreviewExistingVault.open(app).readCommitted(System.currentTimeMillis());
            need(new MessagePreviewChoiceStore(app).write(head,"none",KEY,revision),"SEED_CONTROL");}catch(Throwable e){error.set(e);}});
        t.start();t.join(4000);need(!t.isAlive()&&error.get()==null,"SEED_CONTROL");
    }
    static long clock(){
        boolean saving=Arrays.stream(Thread.currentThread().getStackTrace()).anyMatch(e->e.getClassName().equals(type.getName())&&e.getMethodName().equals("save"));
        // Yield after save's final pre-write head check, not inside a Session/state monitor.
        if(saving&&saveWallReads.incrementAndGet()==4)beforeSaveWrite.run();
        return wall.get();
    }
    static Object newConsent()throws Exception{
        return type.getDeclaredConstructor(Context.class,MessagePreviewSession.class,httpType,LongSupplier.class,LongSupplier.class)
            .newInstance(app,session,httpPort,(LongSupplier)MessagePreviewConsentProbe::clock,(LongSupplier)()->SystemClock.value);
    }
    static void setup(String path)throws Exception{
        try{type=Class.forName("com.kub.messenger.MessagePreviewConsent");completion=Class.forName(type.getName()+"$Completion");}
        catch(ClassNotFoundException absent){throw new AssertionError("NATIVE_CONSENT_ENTRY_REQUIRED");}
        MessagePreviewSessionProbe.run("commit",path);session=(MessagePreviewSession)MessagePreviewSessionProbe.session;
        app=(MessagePreviewSessionProbe.App)field(session,"application");binding=(MessagePreviewSession.Binding)field(session,"binding");
        need(binding!=null&&session.current(binding),"REAL_COMMITTED_BINDING");wall.set(System.currentTimeMillis());
        httpType=Class.forName(type.getName()+"$Http");
        httpPort=Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{httpType},(p,m,a)->{
            try{
                need(Looper.myLooper()!=Looper.getMainLooper()&&!Thread.holdsLock(session),"NO_MAIN_OR_SESSION_LOCK_HTTP");
                Field fileLock=MessagePreviewChoiceStore.class.getDeclaredField("FILE_LOCK");fileLock.setAccessible(true);
                need(!Thread.holdsLock(fileLock.get(null))&&!Thread.holdsLock(field(consent,"state")),"NO_FILE_OR_STATE_LOCK_HTTP");
                borrowed=(byte[])a[0];need(Arrays.equals(borrowed,ACCESS.getBytes(java.nio.charset.StandardCharsets.US_ASCII))
                    &&KEY.equals(a[1])&&DEVICE.equals(a[2])&&(Long)a[3]==18000L,"EXACT_NATIVE_CREDENTIAL_HTTP");
                requests.incrementAndGet();duringHttp.run();
                return List.of(MessagePreviewSessionProbe.map("preview_v",1,"recipient_id",USER,"session_id",SESSION,"device_id",DEVICE,"preview_level",server));
            }catch(Throwable e){portError.set(e);throw e;}
        });
        consent=newConsent();
        type.getDeclaredConstructor(Context.class,MessagePreviewSession.class);
    }
    static void run(String name,String path)throws Exception{
        setup(path);
        if(name.equals("refresh")||name.equals("none")||name.equals("sender")){
            if(!name.equals("refresh"))server=name;
            need(refresh().value(),"REFRESH_AUTHENTICATED_CHOICE");var saved=choice();
            need(saved.level.equals(server)&&saved.publicKey.equals(KEY)&&saved.revision==1,"EXACT_REFRESH_DURABLE_CHOICE");
            allowed(!server.equals("none"),"SERVER_NONE_DENIES");
            need(borrowed!=null&&Arrays.equals(borrowed,new byte[borrowed.length]),"BORROWED_CREDENTIAL_SCRUBBED");
        }else if(name.equals("begin-confirm")){
            need(refresh().value(),"REFRESH_CONTROL");allowed(true,"ALLOW_CONTROL");Ack began=begin(7);allowed(false,"BEGIN_SYNCHRONOUS_DENY");
            need(began.value()&&choice().level.equals("none")&&choice().revision==8,"BEGIN_DURABLE_NONE");
            server="sender";need(confirm(7,"sender").value()&&choice().level.equals("sender")&&choice().revision==9,"EXACT_CONFIRM_CHOICE");
            allowed(true,"CONFIRM_ALLOWS");need(!confirm(7,"sender").value(),"CONFIRM_REPLAY_REFUSED");
        }else if(name.equals("invalid-begin")||name.equals("replayed-begin")||name.equals("closed-begin")){
            need(refresh().value(),"CONFIRMED_CONTROL");allowed(true,"CONFIRMED_CONTENT");
            if(name.equals("replayed-begin")){
                need(begin(4).value()&&confirm(4,"message").value(),"CONFIRMED_CHOICE_CONTROL");
                for(long revision:new long[]{4,3}){need(!begin(revision).value(),"REPLAY_REFUSED");allowed(true,"REJECTED_BEGIN_PRESERVES_CONTENT");}
            }else if(name.equals("closed-begin")){
                invoke("close",new Class<?>[]{});need(!begin(1).value(),"CLOSED_BEGIN_REFUSED");allowed(true,"REJECTED_BEGIN_PRESERVES_CONTENT");
            }else for(long revision:new long[]{-1,9007199254740991L,9007199254740992L}){
                need(!begin(revision).value(),"INVALID_BEGIN_REFUSED");allowed(true,"REJECTED_BEGIN_PRESERVES_CONTENT");
            }
        }else if(name.equals("stale-head-choice")||name.equals("closed-worker-choice")){
            seed(4);Object oldConsent=consent;CountDownLatch paused=new CountDownLatch(1),release=new CountDownLatch(1);
            beforeSaveWrite=()->{try{need(!Thread.holdsLock(session)&&!Thread.holdsLock(field(oldConsent,"state")),"NO_SESSION_STATE_LOCK_DURING_STORAGE");}
                catch(Exception e){throw new AssertionError("LOCK_CONTROL");}paused.countDown();await(release);};
            Ack stale=refresh();await(paused);byte[] fresh;
            try{
                if(name.equals("closed-worker-choice"))invoke("close",new Class<?>[]{});
                Object bridge=field(session,"bridge");var runtime=(MessagePreviewVerificationRuntime)field(session,"runtime");
                MessagePreviewSessionProbe.verify(bridge,runtime,2);MessagePreviewSessionProbe.pump(()->MessagePreviewSessionProbe.reply!=null,"NEW_BINDING_ACK");
                need(Boolean.TRUE.equals(MessagePreviewSessionProbe.reply),"NEW_BINDING_COMMITTED");
                binding=(MessagePreviewSession.Binding)field(session,"binding");wall.set(System.currentTimeMillis());consent=newConsent();server="none";
                need(refresh().value(),"NEW_CHOICE_ACK");fresh=Files.readAllBytes(new File(app.root,"native-message-previews-v1/choice-v1.bin").toPath());
            }finally{release.countDown();}
            need(!stale.value(),"STALE_WORKER_REFUSED");
            need(Arrays.equals(fresh,Files.readAllBytes(new File(app.root,"native-message-previews-v1/choice-v1.bin").toPath())),"STALE_WORKER_CANNOT_CLOBBER_CHOICE");
            need(choice().level.equals("none")&&session.current(binding),"NEW_HEAD_CHOICE_PRESERVED");
            type.getDeclaredMethod("close").invoke(oldConsent);
        }else if(name.equals("confirm-none")){
            need(begin(1).value(),"BEGIN_CONTROL");server="none";need(confirm(1,"none").value()&&choice().level.equals("none"),"NONE_CONFIRMED");allowed(false,"SERVER_NONE_DENIES");
        }else if(name.equals("floor")){
            seed(40);need(begin(3).value()&&choice().revision==41,"MAX_DURABLE_REVISION");
        }else if(name.equals("invalid")){
            for(long rev:new long[]{-1,9007199254740991L,9007199254740992L})need(!begin(rev).value(),"INVALID_REVISION_REFUSED");
            need(!confirm(1,"message").value()&&!confirm(1,"rich").value()&&requests.get()==0,"NO_PENDING_NO_HTTP");
        }else if(name.equals("replay")){
            need(begin(4).value(),"BEGIN_CONTROL");need(!begin(4).value()&&!begin(3).value()&&!confirm(3,"message").value(),"STALE_REVISION_REFUSED");
            need(confirm(4,"message").value()&&requests.get()==1,"ONLY_EXACT_PENDING_HTTP");
        }else if(name.equals("mismatch")||name.equals("unknown")){
            need(begin(1).value(),"BEGIN_CONTROL");server=name.equals("unknown")?"rich":"sender";
            need(!confirm(1,"message").value()&&choice().level.equals("none"),"SERVER_EXACT_CHOICE_REQUIRED");allowed(false,"FAILED_CONFIRM_DENIES");
            need(!confirm(1,"message").value()&&requests.get()==1,"FAILED_CONFIRM_NOT_RETRIED");
        }else if(name.equals("refresh-after-begin")){
            need(begin(2).value(),"BEGIN_CONTROL");need(!refresh().value()&&requests.get()==0,"REFRESH_CANNOT_OVERRIDE_BEGIN");
            need(confirm(2,"message").value(),"CONFIRM_CONTROL");need(!refresh().value()&&requests.get()==1,"REFRESH_CANNOT_OVERRIDE_BEGIN");
        }else if(name.equals("begin-during-refresh")){
            CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);duringHttp=()->{entered.countDown();await(release);};
            Ack refreshing=refresh();await(entered);Ack began=begin(6);allowed(false,"BEGIN_SYNCHRONOUS_DENY");release.countDown();
            need(!refreshing.value()&&began.value()&&choice().level.equals("none"),"LATE_REFRESH_REFUSED");allowed(false,"LATE_REFRESH_NO_ALLOW");
        }else if(name.equals("new-begin-during-confirm")){
            need(begin(1).value(),"BEGIN_CONTROL");CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
            duringHttp=()->{entered.countDown();await(release);};Ack confirming=confirm(1,"message");await(entered);Ack next=begin(2);release.countDown();
            need(!confirming.value()&&next.value()&&choice().level.equals("none"),"REPLACED_PENDING_REFUSED");allowed(false,"REPLACED_PENDING_NO_ALLOW");
        }else if(name.equals("double-confirm")){
            need(begin(1).value(),"BEGIN_CONTROL");CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
            duringHttp=()->{entered.countDown();await(release);};Ack first=confirm(1,"message");await(entered);
            try{need(!confirm(1,"message").value(),"INFLIGHT_CONFIRM_REPLAY_REFUSED");}finally{release.countDown();}
            need(first.value()&&requests.get()==1,"ONE_INFLIGHT_CONFIRM_RPC");
        }else if(name.equals("store-failure")||name.equals("corrupt-choice")||name.equals("begin-write-failure")){
            File file=new File(app.root,"native-message-previews-v1/choice-v1.bin");byte[] prior=null;
            if(name.equals("corrupt-choice")){seed(4);prior=Files.readAllBytes(file.toPath());prior[prior.length-1]^=1;Files.write(file.toPath(),prior);}
            else android.util.AtomicFile.finishThrows=true;
            if(name.equals("begin-write-failure")){
                need(!begin(1).value()&&!confirm(1,"message").value()&&requests.get()==0,"FAILED_BEGIN_NO_CONFIRM_HTTP");
            }else need(!refresh().value(),"DURABLE_CHOICE_REQUIRED");
            allowed(false,"FAILED_STORE_DENIES");
            if(prior!=null)need(Arrays.equals(prior,Files.readAllBytes(file.toPath())),"NO_CORRUPT_CHOICE_RESET");
        }else if(name.equals("rollback")||name.equals("expired")||name.equals("deadline")||name.equals("head-change")
            ||name.startsWith("owner-")||name.startsWith("binding-")||name.equals("logout")){
            if(name.startsWith("owner-")||name.startsWith("binding-")){
                var head=MessagePreviewSessionProbe.record(app);var h=head.header;
                var expected=new MessagePreviewMetadataEnvelope.Header(h.installation,h.generation+(name.equals("binding-generation")?1:0),h.kind,h.alias,
                    h.expiresWallMillis,h.wallHighWaterMillis,h.operationId,h.baseGeneration+(name.equals("binding-generation")?1:0),
                    h.vaultRevision+(name.equals("binding-revision")?1:0));
                var wrong=new MessagePreviewVaultFence.Owner(name.equals("owner-change")?DEVICE:USER,
                    name.equals("owner-session")?DEVICE:SESSION,name.equals("owner-device")?USER:DEVICE,name.equals("owner-epoch")?8:7);
                byte[] blob=MessagePreviewCredentialEnvelope.seal(expected,wrong,ACCESS,expected.expiresWallMillis,MessagePreviewProducerPlatform.keys.get(h.alias));
                Files.write(new File(app.root,"native-message-previews-v1/journal-v1.bin").toPath(),MessagePreviewMetadataEnvelope.seal(expected,blob,
                    MessagePreviewProducerPlatform.keys.get("letscube.nmpv.metadata.v1."+h.installation)));
            }else duringHttp=()->{
                try{
                    if(name.equals("rollback"))wall.addAndGet(-1);
                    if(name.equals("expired"))wall.set(binding.expiresAt);
                    if(name.equals("deadline"))SystemClock.value=18000;
                    if(name.equals("head-change")){File file=new File(app.root,"native-message-previews-v1/journal-v1.bin");byte[] bytes=Files.readAllBytes(file.toPath());bytes[bytes.length-1]^=1;Files.write(file.toPath(),bytes);}
                    if(name.equals("logout")){Field committed=session.getClass().getDeclaredField("committed");committed.setAccessible(true);committed.setBoolean(session,false);session.blockContent(binding);}
                }catch(Exception e){throw new IllegalStateException("FIXTURE");}
            };
            need(!refresh().value(),"CURRENT_HEAD_OWNER_CLOCK_REQUIRED");allowed(false,"INVALID_CURRENT_DENIES");
            if(name.startsWith("owner-")||name.startsWith("binding-"))need(requests.get()==0,"OWNER_CHECK_BEFORE_HTTP");
        }else if(name.equals("callback")){
            Ack a=new Ack();a.throwing=true;invoke("refresh",new Class<?>[]{MessagePreviewSession.Binding.class,completion},binding,a.callback());
            need(a.value(),"CALLBACK_CONTROL");need(begin(2).value()&&a.calls.get()==1,"CALLBACK_UNKNOWN_NOT_REPLAYED");
        }else if(name.equals("close")){
            invoke("close",new Class<?>[]{});need(!refresh().value()&&!begin(1).value()&&requests.get()==0,"CLOSED_NO_IO");allowed(false,"CLOSE_DENIES");
        }else if(name.equals("close-confirmed")){
            need(refresh().value(),"CONFIRMED_CONTROL");allowed(true,"CONFIRMED_CONTENT");
            invoke("close",new Class<?>[]{});allowed(true,"DOCUMENT_DETACH_IS_NOT_LOGOUT");
            need(!refresh().value()&&!begin(1).value()&&requests.get()==1,"DETACHED_NO_NEW_IO");
        }else if(name.equals("close-pending")){
            need(refresh().value()&&begin(1).value(),"PENDING_CONTROL");
            invoke("close",new Class<?>[]{});allowed(false,"PENDING_DETACH_STAYS_CLOSED");
            need(!confirm(1,"message").value(),"DETACHED_NO_LATE_CONFIRM");
        }else throw new AssertionError("UNKNOWN_CASE");
    }
    public static void main(String[] args){try{run(args[0],args[1]);if(consent!=null)invoke("close",new Class<?>[]{});System.out.println("PASS "+args[0]);}
        catch(Throwable e){System.err.println("FAIL "+(e instanceof AssertionError?e.getMessage():"UNEXPECTED"));System.exit(1);}}
}
