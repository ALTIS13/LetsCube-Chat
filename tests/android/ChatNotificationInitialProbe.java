package com.kub.messenger;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongConsumer;

/** Actual cleanup class and threads; the durable store and OS presentation are doubles. */
public final class ChatNotificationInitialProbe {
    static final String CHAT="00000000-0000-0000-0000-000000000001";
    static final String NOTICE="00000000-0000-0000-0000-000000000002";
    static final String MESSAGE="00000000-0000-0000-0000-000000000003";
    static final String INSTANCE="00000000-0000-0000-0000-000000000004";
    static final String USER="00000000-0000-0000-0000-000000000005";
    static final String TAG="message:chat:"+CHAT;
    static final RuntimeException FAILURE=new IllegalStateException("fictional publication uncertainty");
    static Class<?> reservation;
    static Method reserve, current, publish, cancel;

    static void check(boolean value,String code){if(!value)throw new AssertionError(code);}
    static void api(){
        try{
            reservation=Class.forName("com.kub.messenger.ChatNotificationCleanup$Reservation");
            reserve=ChatNotificationCleanup.class.getDeclaredMethod("reserve",ChatNotificationCleanup.IntentStore.class,String.class,String.class,String.class);
            current=ChatNotificationCleanup.class.getDeclaredMethod("isCurrent",reservation);
            publish=ChatNotificationCleanup.class.getDeclaredMethod("publishInitial",reservation,LongConsumer.class);
            cancel=ChatNotificationCleanup.class.getDeclaredMethod("cancelInitial",reservation);
        }catch(ReflectiveOperationException absent){throw new AssertionError("INITIAL_RESERVATION_ENTRY_REQUIRED");}
        check(reserve.getReturnType()==reservation&&current.getReturnType()==boolean.class
            &&publish.getReturnType()==boolean.class&&cancel.getReturnType()==void.class
            &&!Modifier.isPublic(reservation.getModifiers()),"PACKAGE_NATIVE_RESERVATION");
        for(var constructor:reservation.getDeclaredConstructors())check(Modifier.isPrivate(constructor.getModifiers()),"OPAQUE_RESERVATION");
    }
    static Object invoke(Method method,Object... args){
        try{return method.invoke(null,args);}
        catch(InvocationTargetException failure){
            if(failure.getCause() instanceof RuntimeException)throw (RuntimeException)failure.getCause();
            if(failure.getCause() instanceof Error)throw (Error)failure.getCause();
            throw new AssertionError("UNEXPECTED_CHECKED_FAILURE");
        }catch(ReflectiveOperationException failure){throw new AssertionError("REFLECTION_CONTROL");}
    }
    static Object reserve(Store store){return invoke(reserve,store,TAG,NOTICE,MESSAGE);}
    static boolean current(Object value){return (boolean)invoke(current,value);}
    static boolean publish(Object value,LongConsumer posting){return (boolean)invoke(publish,value,posting);}
    static void cancel(Object value){invoke(cancel,value);}

    static final class Store implements ChatNotificationCleanup.IntentStore,ChatNotificationCleanup.Cards {
        final Map<String,ChatNotificationCleanup.Posted> stored=new ConcurrentHashMap<>();
        volatile List<ChatNotificationCleanup.Card> visible=List.of();
        boolean writable=true, readFailure, writeFailure, cancelFailure;
        int writes, cancellations;
        Runnable onRead=()->{};
        public ChatNotificationCleanup.Posted read(String tag){
            onRead.run();if(readFailure)throw FAILURE;
            var p=stored.get(tag);
            return p==null?null:new ChatNotificationCleanup.Posted(p.notificationId,p.messageId,p.generation);
        }
        public boolean write(String tag,ChatNotificationCleanup.Posted p){
            writes++;if(writeFailure)throw FAILURE;if(!writable)return false;
            stored.put(tag,new ChatNotificationCleanup.Posted(p.notificationId,p.messageId,p.generation));return true;
        }
        public ChatNotificationCleanup.IntentStore intents(){return this;}
        public List<ChatNotificationCleanup.Card> active(){return visible;}
        public void cancel(String tag,int id){cancellations++;if(cancelFailure)throw FAILURE;}
        long generation(){return stored.get(TAG).generation;}
        void oldPost(String notice){check(ChatNotificationCleanup.post(this,TAG,notice,MESSAGE,g->{}),"EXISTING_POST_CONTROL");}
    }
    static ChatNotificationCleanup.Owner owner(){
        ChatNotificationCleanup.activate(INSTANCE);
        check(ChatNotificationCleanup.bind(INSTANCE,1,USER,1),"OWNER_CONTROL");
        return ChatNotificationCleanup.matches(INSTANCE,1,USER,1);
    }
    static ChatNotificationCleanup.Result read(Store store,ChatNotificationCleanup.Owner owner,String notice){
        return ChatNotificationCleanup.reconcileRead(owner,CHAT,List.of(new ChatNotificationCleanup.Read(notice,MESSAGE)),store);
    }
    static void await(CountDownLatch latch){
        try{check(latch.await(3,TimeUnit.SECONDS),"LATCH_CONTROL");}
        catch(InterruptedException failure){Thread.currentThread().interrupt();throw new AssertionError("INTERRUPTED_CONTROL");}
    }
    static void join(Thread thread)throws Exception{thread.join(4000);check(!thread.isAlive(),"THREAD_COMPLETED");}
    static void blocked(Thread thread){
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(thread.isAlive()&&System.nanoTime()<until){if(thread.getState()==Thread.State.BLOCKED)return;Thread.yield();}
        throw new AssertionError("INITIAL_PUBLICATION_SERIALIZES_REPLACEMENT");
    }
    static void scenario(String name)throws Exception{
        api();Store store=new Store();var owner=owner();AtomicInteger calls=new AtomicInteger();
        LongConsumer posting=g->{check(g==store.generation(),"EXACT_RESERVED_GENERATION");calls.incrementAndGet();};
        if(name.equals("invalid")){
            for(String tag:new String[]{null,"","message:chat:invalid","call:"+CHAT})
                check(invoke(reserve,store,tag,NOTICE,MESSAGE)==null,"INVALID_RESERVATION_REFUSED");
            check(invoke(reserve,null,TAG,NOTICE,MESSAGE)==null
                &&invoke(reserve,store,TAG,null,MESSAGE)==null&&invoke(reserve,store,TAG,NOTICE,"invalid")==null
                &&store.writes==0,"INVALID_RESERVATION_REFUSED");return;
        }
        if(name.equals("null")){
            check(!current(null)&&!publish(null,posting),"NULL_RESERVATION_REFUSED");cancel(null);return;
        }
        if(name.equals("cold-generation"))store.stored.put(TAG,new ChatNotificationCleanup.Posted(NOTICE,MESSAGE,41));
        if(name.equals("exhausted")){
            store.stored.put(TAG,new ChatNotificationCleanup.Posted(NOTICE,MESSAGE,Long.MAX_VALUE));
            check(reserve(store)==null&&store.writes==0,"GENERATION_EXHAUSTED");return;
        }
        Object r=reserve(store);check(r!=null,"RESERVATION_CREATED");
        if(name.equals("current")||name.equals("cold-generation")){
            check(store.generation()==(name.equals("current")?1:42)&&store.writes==1&&calls.get()==0,"RESERVE_WITHOUT_PUBLICATION");
            check(current(r)&&current(r),"EXACT_CURRENT_RESERVATION");
            check(publish(r,posting)&&calls.get()==1&&store.writes==1,"INITIAL_PUBLISHED_ONCE");
            check(!current(r)&&!publish(r,posting)&&calls.get()==1,"NO_LATE_UPGRADE");
        }else if(name.equals("exactly-once")){
            check(publish(r,posting),"INITIAL_PUBLISHED_ONCE");
            check(!publish(r,posting)&&calls.get()==1,"NO_LATE_UPGRADE");
        }else if(name.equals("null-callback")){
            check(!publish(r,null)&&current(r)&&publish(r,posting)&&calls.get()==1,"NULL_CALLBACK_NO_EFFECT");
        }else if(name.equals("exception")||name.equals("error")){
            Error fatal=new AssertionError("FICTIONAL_CALLBACK_ERROR");boolean propagated=false;
            try{publish(r,g->{calls.incrementAndGet();if(name.equals("error"))throw fatal;throw FAILURE;});}
            catch(RuntimeException failure){check(failure==FAILURE,"EXACT_CALLBACK_FAILURE");propagated=true;}
            catch(Error failure){check(failure==fatal,"EXACT_CALLBACK_FAILURE");propagated=true;}
            check(propagated&&calls.get()==1&&!current(r)&&!publish(r,posting)&&calls.get()==1,"UNKNOWN_EFFECT_NEVER_RETRIED");
        }else if(name.equals("reentrant")){
            check(publish(r,g->{calls.incrementAndGet();check(!current(r)&&!publish(r,posting),"REENTRANT_PUBLICATION_REFUSED");}),"INITIAL_PUBLISHED_ONCE");
            check(calls.get()==1,"NO_LATE_UPGRADE");
        }else if(name.equals("two-publishers")){
            CountDownLatch start=new CountDownLatch(1);AtomicInteger successes=new AtomicInteger();AtomicReference<Throwable> error=new AtomicReference<>();
            Runnable attempt=()->{try{await(start);if(publish(r,posting))successes.incrementAndGet();}catch(Throwable failure){error.set(failure);}};
            Thread a=new Thread(attempt),b=new Thread(attempt);a.start();b.start();start.countDown();join(a);join(b);
            check(error.get()==null&&successes.get()==1&&calls.get()==1,"TWO_THREADS_ONE_PUBLICATION");
        }else if(name.equals("replacement-serialized")){
            CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);AtomicReference<Throwable> error=new AtomicReference<>();
            Thread publishing=new Thread(()->{try{check(publish(r,g->{calls.incrementAndGet();entered.countDown();await(release);}),"INITIAL_PUBLISHED_ONCE");}catch(Throwable failure){error.set(failure);}});
            Thread replacing=new Thread(()->{try{store.oldPost(USER);}catch(Throwable failure){error.set(failure);}});
            publishing.start();await(entered);replacing.start();
            try{blocked(replacing);}finally{release.countDown();join(publishing);join(replacing);}
            check(error.get()==null&&calls.get()==1&&USER.equals(store.read(TAG).notificationId),"REPLACEMENT_SURVIVES_INITIAL_PUBLICATION");
        }else if(name.equals("read-inflight")){
            CountDownLatch lookup=new CountDownLatch(1),complete=new CountDownLatch(1);AtomicReference<Throwable> error=new AtomicReference<>();
            Thread delivery=new Thread(()->{try{lookup.countDown();await(complete);check(!publish(r,posting),"READ_INFLIGHT_REFUSED");}catch(Throwable failure){error.set(failure);}});
            delivery.start();await(lookup);
            try{check(read(store,owner,NOTICE).pending,"READ_PENDING_UNCHANGED");}finally{complete.countDown();join(delivery);}
            check(error.get()==null&&calls.get()==0&&!current(r),"READ_INFLIGHT_REFUSED");
        }else if(name.equals("new-after-cancel")||name.equals("new-after-read")){
            if(name.equals("new-after-cancel"))cancel(r);else read(store,owner,NOTICE);
            Object next=reserve(store);cancel(r);
            check(!publish(r,posting)&&current(next)&&publish(next,posting)&&calls.get()==1,"NEW_GENERATION_NOT_POISONED");
        }else if(name.equals("durable-highwater")){
            store.stored.put(TAG,new ChatNotificationCleanup.Posted(NOTICE,MESSAGE,900));
            Object next=reserve(store);check(next!=null&&store.generation()==901&&!current(r)&&publish(next,posting),"FRESH_DURABLE_GENERATION");
        }else if(name.equals("store-read-exception")){
            store.readFailure=true;boolean propagated=false;
            try{publish(r,posting);}catch(RuntimeException failure){check(failure==FAILURE,"EXACT_STORE_FAILURE");propagated=true;}
            check(propagated&&calls.get()==0,"STORE_FAILURE_NO_CALLBACK");
        }else{
            if(name.equals("cancel")){cancel(r);cancel(r);check(store.writes==1&&store.cancellations==0,"CANCEL_NO_OS_OR_STORE_EFFECT");}
            else if(name.equals("replaced"))reserve(store);
            else if(name.equals("legacy-replaced"))store.oldPost(USER);
            else if(name.equals("durable-missing"))store.stored.clear();
            else if(name.equals("durable-notification"))store.stored.put(TAG,new ChatNotificationCleanup.Posted(USER,MESSAGE,1));
            else if(name.equals("durable-message"))store.stored.put(TAG,new ChatNotificationCleanup.Posted(NOTICE,USER,1));
            else if(name.equals("durable-generation"))store.stored.put(TAG,new ChatNotificationCleanup.Posted(NOTICE,MESSAGE,2));
            else if(name.equals("write-refused")||name.equals("write-exception")){
                store.writable=false;store.writeFailure=name.equals("write-exception");
                if(store.writeFailure){boolean propagated=false;try{reserve(store);}catch(RuntimeException failure){check(failure==FAILURE,"EXACT_STORE_FAILURE");propagated=true;}check(propagated,"STORE_FAILURE_PROPAGATED");}
                else check(reserve(store)==null,"DURABLE_WRITE_REQUIRED");
            }else if(name.equals("queued-read")){check(read(store,owner,NOTICE).pending,"READ_PENDING_UNCHANGED");}
            else if(name.equals("read-cancel-failure")){
                store.visible=List.of(new ChatNotificationCleanup.Card(TAG,0,false,1,CHAT,NOTICE,MESSAGE,1));store.cancelFailure=true;
                boolean propagated=false;try{read(store,owner,NOTICE);}catch(RuntimeException failure){check(failure==FAILURE,"EXACT_CANCEL_FAILURE");propagated=true;}check(propagated,"CANCEL_FAILURE_CONTROL");
            }else if(name.equals("unrelated-read")||name.equals("stale-owner-read")){
                if(name.equals("stale-owner-read"))ChatNotificationCleanup.bind(INSTANCE,2,null,2);
                read(store,owner,name.equals("unrelated-read")?USER:NOTICE);
                check(current(r)&&publish(r,posting)&&calls.get()==1,"UNRELATED_READ_NOT_RETIRED");return;
            }else throw new AssertionError("UNKNOWN_SCENARIO");
            check(!current(r)&&!publish(r,posting)&&calls.get()==0,"STALE_INITIAL_NOT_PUBLISHED");
        }
    }
    public static void main(String[] args){
        try{scenario(args[0]);System.out.println("PASS "+args[0]);}
        catch(Throwable failure){String code=failure instanceof AssertionError?failure.getMessage():null;
            System.err.println("FAIL "+(code!=null&&code.matches("[A-Z0-9_]+")?code:"UNEXPECTED_FAILURE"));System.exit(1);}
    }
}
