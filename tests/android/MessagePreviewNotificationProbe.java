package com.kub.messenger;

import android.app.Notification;
import android.content.Context;
import com.google.firebase.messaging.RemoteMessage;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

// Fictional identities only. Actual receiver, cleanup, lookup, HTTP, parser and JCA codecs.
// Durable/Session authority is a boundary double, not authenticated device evidence.
public final class MessagePreviewNotificationProbe {
    static final String USER="11111111-1111-4111-8111-111111111111", SESSION="22222222-2222-4222-8222-222222222222";
    static final String DEVICE="33333333-3333-4333-8333-333333333333", CHAT="44444444-4444-4444-8444-444444444444";
    static final String NOTICE="55555555-5555-4555-8555-555555555555", MESSAGE="66666666-6666-4666-8666-666666666666";
    static final String OTHER="77777777-7777-4777-8777-777777777777", TAG="message:chat:"+CHAT;
    static final String INSTALL="11111111111111111111111111111111", OP="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    static final String ALIAS="letscube.nmpv.credential.v1."+INSTALL+".bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    static final String KEY="sb_publishable_abcdefghijklmno", GENERIC="\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435";
    static final SecretKey AES=new SecretKeySpec(new byte[32],"AES");
    static MessagePreviewMetadataEnvelope.Record head;
    static String level="message", publicKey=KEY, access;
    static boolean headCurrent=true, choiceCurrent=true, missing, keyLoss;
    static int vaultReads, choiceReads, requests;
    static Runnable onResponse=()->{};
    static Runnable onPendingIntent=()->{};
    static boolean checkPendingLocks,checkGenerationLocks;
    static Connection connection;
    static void require(boolean value,String name){if(!value)throw new AssertionError(name);}
    static Object cardsLock(){try{var f=ChatNotificationCleanup.class.getDeclaredField("CARDS");f.setAccessible(true);return f.get(null);}
        catch(ReflectiveOperationException e){throw new AssertionError("CARDS_LOCK_CONTROL");}}
    public static void preparation(boolean generation){
        if(!generation)onPendingIntent.run();
        if(generation?checkGenerationLocks:checkPendingLocks)require(!Thread.holdsLock(cardsLock())&&!Thread.holdsLock(MessagePreviewSession.CONTENT),
            generation?"GENERATION_PREPARED_OUTSIDE_LOCKS":"PENDING_INTENT_OUTSIDE_LOCKS");
    }
    static void await(CountDownLatch latch){try{require(latch.await(3,TimeUnit.SECONDS),"LATCH_CONTROL");}
        catch(InterruptedException e){throw new AssertionError("INTERRUPTED_CONTROL");}}
    static boolean publishing(){for(StackTraceElement frame:Thread.currentThread().getStackTrace())
        if(frame.getClassName().equals(ChatNotificationCleanup.class.getName())&&frame.getMethodName().equals("publishInitial"))return true;return false;}
    static boolean storageCurrent(MessagePreviewNotification.Lease lease,long wall){try{return lease.current(wall);}
        catch(Exception e){throw new IllegalStateException("FICTIONAL_STORAGE_FAILURE");}}
    static boolean publishUnchecked(MessagePreviewNotification.Ports ports,Object permit,Runnable posting){
        ((Port)ports).onPublish.run();posting.run();return true;
    }
    static String token(String role,String user,String session,long exp) {
        String header="{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
        String body="{\"role\":\""+role+"\",\"aud\":\"authenticated\",\"iss\":\"https://core.letscube.ru/auth/v1\",\"sub\":\""+user+"\",\"session_id\":\""+session+"\",\"exp\":"+exp+",\"is_anonymous\":false}";
        JSONTokener.fixture(header,new JSONObject().put("alg","HS256").put("typ","JWT"));
        JSONTokener.fixture(body,new JSONObject().put("role",role).put("aud","authenticated").put("iss","https://core.letscube.ru/auth/v1")
            .put("sub",user).put("session_id",session).put("exp",exp).put("is_anonymous",false));
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(header.getBytes(StandardCharsets.UTF_8))+"."
            +java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(body.getBytes(StandardCharsets.UTF_8))+".c2ln";
    }
    static void record(long now,String role,String user,String session) throws Exception {
        long expiry=(now/1000+60)*1000;
        access=token(role,user,session,expiry/1000);
        MessagePreviewMetadataEnvelope.Header h=new MessagePreviewMetadataEnvelope.Header(INSTALL,9,MessagePreviewMetadataEnvelope.Kind.COMMITTED,
            ALIAS,expiry,now,OP,8,47);
        byte[] blob=MessagePreviewCredentialEnvelope.seal(h,new MessagePreviewVaultFence.Owner(USER,SESSION,DEVICE,4),access,expiry,AES);
        head=MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(h,blob,AES),INSTALL,AES);
    }
    static Map<String,Object> row(long now,String requestedLevel){
        Map<String,Object> r=new HashMap<>();r.put("preview_v",1);r.put("recipient_id",USER);r.put("session_id",SESSION);r.put("device_id",DEVICE);
        r.put("notification_id",NOTICE);r.put("chat_id",CHAT);r.put("message_id",MESSAGE);r.put("preview_level",requestedLevel);
        r.put("sender_name","Fictional Sender");r.put("title","Fictional Sender");r.put("body","sender".equals(requestedLevel)?GENERIC:"Fictional body");
        r.put("expires_at",java.time.Instant.ofEpochMilli(now+10_000).toString());return r;
    }
    static final class Store implements ChatNotificationCleanup.IntentStore {
        ChatNotificationCleanup.Posted value; boolean fail; int writes;
        Runnable onRead=()->{};
        public ChatNotificationCleanup.Posted read(String t){onRead.run();return value==null?null:new ChatNotificationCleanup.Posted(value.notificationId,value.messageId,value.generation);}
        public boolean write(String t,ChatNotificationCleanup.Posted v){writes++;if(fail)return false;value=new ChatNotificationCleanup.Posted(v.notificationId,v.messageId,v.generation);return true;}
    }
    static final class Port implements MessagePreviewNotification.Ports {
        volatile long wall=1_800_000_000_000L,elapsed=1000;long seenDeadline;
        volatile Object permit=new Object(); volatile boolean allowed=true,headLive=true,choiceLive=true;
        String maximum="message",key=KEY; int opens,calls,cancels,consumes;
        byte[] borrowed; boolean insideConsume;
        Runnable onOpen=()->{},onRequest=()->{},onPublish=()->{},onStorage=()->{};
        Object response;
        final Store store;
        final MessagePreviewHttpTransport decoder=new MessagePreviewHttpTransport(()->elapsed);
        Port(Store store) throws Exception {this.store=store;record(wall,"authenticated",USER,SESSION);response=Collections.singletonList(row(wall,"message"));}
        public long wallTime(){return wall;} public long elapsedTime(){return elapsed;}
        public Object capture(){return allowed?permit:null;}
        public boolean contentCurrent(Object p){return allowed&&p==permit;}
        public boolean publishContent(Object p,Runnable r){onPublish.run();if(!contentCurrent(p))return false;synchronized(MessagePreviewSession.CONTENT){r.run();return true;}}
        public MessagePreviewNotification.Lease open(){opens++;onOpen.run();if(missing)throw new IllegalStateException();return new MessagePreviewNotification.Lease(){
            public String level(){return maximum;}public String publicKey(){return key;}
            public long expiresAt(){return head.header.expiresWallMillis;}
            public boolean current(long now){onStorage.run();return headLive&&choiceLive&&now<head.header.expiresWallMillis;}
            public void consume(MessagePreviewCredentialEnvelope.Consumer c) throws Exception {
                consumes++;MessagePreviewCredentialEnvelope.consume(head,head.header,AES,(owner,bytes,expiry)->{
                    borrowed=bytes;insideConsume=true;try{c.accept(owner,bytes,expiry);}finally{insideConsume=false;}
                });
            }
        };}
        public Map<String,Object> decode(String t) throws Exception{return decoder.decode(t);}
        public Object preview(String a,String k,String d,String n,long deadline) throws Exception {
            calls++;seenDeadline=deadline;
            require(store.value!=null&&store.writes==1,"RESERVE_BEFORE_LOOKUP");
            require(insideConsume&&Arrays.equals(borrowed,a.getBytes(StandardCharsets.US_ASCII)),"BORROWED_HTTP_SCOPE");
            require(DEVICE.equals(d)&&NOTICE.equals(n),"EXACT_RPC_ARGUMENTS");
            java.lang.reflect.Field f=ChatNotificationCleanup.class.getDeclaredField("CARDS");f.setAccessible(true);
            require(!Thread.holdsLock(f.get(null))&&!Thread.holdsLock(MessagePreviewSession.CONTENT),"NETWORK_OUTSIDE_PUBLISH_LOCKS");
            onRequest.run();return response;
        }
        public void cancel(){cancels++;}
    }
    static void retire(ChatNotificationCleanup.IntentStore store){
        ChatNotificationCleanup.activate(OTHER);require(ChatNotificationCleanup.bind(OTHER,1,USER,4),"READ_OWNER");
        ChatNotificationCleanup.Owner owner=ChatNotificationCleanup.matches(OTHER,1,USER,4);
        ChatNotificationCleanup.reconcileRead(owner,CHAT,Collections.singletonList(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)),new ChatNotificationCleanup.Cards(){
            public List<ChatNotificationCleanup.Card> active(){return Collections.emptyList();}
            public void cancel(String t,int id){}public ChatNotificationCleanup.IntentStore intents(){return store;}
        });
    }
    static void port(String scenario) throws Exception {
        Store store=new Store();Port p=new Port(store);int[] posts={0},rich={0};boolean unknown=false,skip=false,untracked=false;
        switch(scenario){
            case "message":break;
            case "lock-order":p.onPublish=()->require(Thread.holdsLock(cardsLock()),"CARDS_BEFORE_CONTENT");break;
            case "sender":p.maximum="sender";p.response=Collections.singletonList(row(p.wall,"sender"));break;
            case "maxlevel":p.maximum="sender";break;
            case "none":p.maximum="none";break;
            case "missing":missing=true;break;
            case "no-permit":p.allowed=false;break;
            case "owner-open":p.onOpen=()->p.allowed=false;break;
            case "bad-key":p.key="not-a-public-key";break;
            case "service-key":p.key=token("service_role",USER,SESSION,p.wall/1000+60);break;
            case "anon-key":p.key=token("anon",USER,SESSION,p.wall/1000+60);break;
            case "access-owner":record(p.wall,"authenticated",OTHER,SESSION);break;
            case "access-session":record(p.wall,"authenticated",USER,OTHER);break;
            case "access-role":record(p.wall,"anon",USER,SESSION);break;
            case "expired-head":p.wall=head.header.expiresWallMillis;break;
            case "head-before":p.headLive=false;break;
            case "choice-before":p.choiceLive=false;break;
            case "head-late":p.onRequest=()->p.headLive=false;break;
            case "choice-late":p.onRequest=()->p.choiceLive=false;break;
            case "owner-late":p.onRequest=()->p.allowed=false;break;
            case "owner-final":p.onPublish=()->p.allowed=false;break;
            // Native writers invalidate the epoch before changing a head/choice, even if then reallowed.
            case "head-final":p.onPublish=()->{p.headLive=false;p.permit=new Object();};break;
            case "choice-final":p.onPublish=()->{p.choiceLive=false;p.permit=new Object();};break;
            case "expire-final":p.onPublish=()->p.wall+=10_000;break;
            case "elapsed-expire-final":p.response=Collections.singletonList(row(p.wall-9000,"message"));p.onPublish=()->p.elapsed+=1500;break;
            case "receipt-deadline":p.onOpen=()->p.elapsed+=1500;break;
            case "receipt-spent":p.onOpen=()->p.elapsed+=2000;break;
            case "network-spent":p.onRequest=()->p.elapsed+=2000;break;
            case "elapsed-rollback":p.onRequest=()->p.elapsed--;break;
            case "wall-rollback":p.onRequest=()->p.wall--;break;
            case "empty":p.response=Collections.emptyList();break;
            case "wrong-route":((Map<String,Object>)((List<?>)p.response).get(0)).put("chat_id",OTHER);break;
            case "refused":p.onRequest=()->{throw new IllegalStateException();};break;
            case "read":p.onRequest=()->retire(store);skip=true;break;
            case "replacement":p.onRequest=()->ChatNotificationCleanup.reserve(store,TAG,OTHER,OTHER);skip=true;break;
            case "durable-change":p.onRequest=()->store.value=new ChatNotificationCleanup.Posted(OTHER,OTHER,store.value.generation);skip=true;break;
            case "durable-fail":store.fail=true;untracked=true;break;
            case "unknown-rich":unknown=true;break;
            case "unknown-generic":p.allowed=false;unknown=true;break;
            case "unknown-final-generic":p.onPublish=()->p.allowed=false;unknown=true;break;
            case "crypto-fail":byte[] blob=head.credentialBytes();blob[15]^=1;
                head=MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(head.header,blob,AES),INSTALL,AES);break;
            default:throw new AssertionError("UNKNOWN_SCENARIO");
        }
        final boolean throwPosting=unknown;
        MessagePreviewNotification.Result r=MessagePreviewNotification.deliver(p,store,TAG,NOTICE,CHAT,MESSAGE,(generation,content)->()->{
            posts[0]++;if(content!=null)rich[0]++;
            require(generation==store.value.generation,"EXACT_RESERVED_GENERATION");
            require(!p.insideConsume,"TOKEN_SCOPE_CLOSED_BEFORE_POST");
            if(throwPosting)throw new IllegalStateException();
        });
        if(untracked){require(r==MessagePreviewNotification.Result.UNTRACKED&&posts[0]==0&&p.opens==0,"ONLY_RESERVE_FAILURE_UNTRACKED");return;}
        if(skip){require(r==MessagePreviewNotification.Result.SKIPPED&&posts[0]==0,"NO_READ_REPLACEMENT_RESURRECTION");return;}
        require(posts[0]==1,"INITIAL_ONCE");
        require(r==(unknown?MessagePreviewNotification.Result.UNKNOWN:MessagePreviewNotification.Result.PUBLISHED),"UNKNOWN_NEVER_RETRIED");
        boolean wantsRich=Arrays.asList("message","lock-order","sender","anon-key","receipt-deadline","unknown-rich").contains(scenario);
        require(rich[0]==(wantsRich?1:0),"RICH_POLICY_"+scenario);
        if(Arrays.asList("none","missing","no-permit","owner-open","bad-key","service-key","head-before","choice-before","receipt-spent","expired-head","access-owner","access-session","access-role","crypto-fail").contains(scenario))
            require(p.calls==0,"REFUSAL_BEFORE_NETWORK");
        if("none".equals(scenario))require(p.consumes==0,"NO_DECRYPT_WITHOUT_CHOICE");
        if("receipt-deadline".equals(scenario))require(p.seenDeadline==3000,"ORIGINAL_RECEIPT_2S");
        if(p.borrowed!=null)for(byte b:p.borrowed)require(b==0,"BORROWED_BYTES_CLEARED");
        require(p.cancels>=1,"TRANSPORT_CLOSED");
    }
    static void held(String scenario)throws Exception {
        Store store=new Store();Port p=new Port(store);int[] posts={0},rich={0},reads={0};
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        AtomicReference<Throwable> error=new AtomicReference<>();AtomicReference<MessagePreviewNotification.Result> result=new AtomicReference<>();
        if(scenario.equals("held-storage"))p.onStorage=()->{
            reads[0]++;
            if(Thread.holdsLock(MessagePreviewSession.CONTENT)){entered.countDown();await(release);}
            require(!Thread.holdsLock(MessagePreviewSession.CONTENT)&&!Thread.holdsLock(cardsLock()),"STORAGE_OUTSIDE_PUBLICATION_LOCKS");
        };
        else {
            if(scenario.equals("cards-content-expired"))p.response=Collections.singletonList(row(p.wall-9000,"message"));
            store.onRead=()->{if(publishing()){entered.countDown();await(release);}};
        }
        Thread receiver=new Thread(()->{try{result.set(MessagePreviewNotification.deliver(p,store,TAG,NOTICE,CHAT,MESSAGE,(g,c)->()->{
            posts[0]++;if(c!=null)rich[0]++;
        }));}catch(Throwable e){error.set(e);}});
        receiver.start();Thread auth=null;boolean authBlocked=false;
        try {
            if(scenario.equals("held-storage")){
                long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
                while(receiver.isAlive()&&entered.getCount()!=0&&System.nanoTime()<until)Thread.yield();
                if(entered.getCount()==0){
                    Object sessionMonitor=new Object();
                    auth=new Thread(()->{synchronized(sessionMonitor){synchronized(MessagePreviewSession.CONTENT){p.allowed=false;}}});auth.start();
                    while(auth.isAlive()&&System.nanoTime()<until){if(auth.getState()==Thread.State.BLOCKED){authBlocked=true;break;}Thread.yield();}
                }
            }else{
                await(entered);require(receiver.isAlive(),"FINAL_READ_HELD_UNDER_CARDS");
                p.elapsed+=scenario.equals("cards-content-expired")?1500:2000;
            }
        }finally{release.countDown();receiver.join(4000);if(auth!=null)auth.join(4000);}
        require(!receiver.isAlive()&&(auth==null||!auth.isAlive()),"HELD_THREADS_COMPLETE");
        require(!authBlocked,"HELD_STORAGE_BLOCKS_AUTH");
        if(error.get()!=null){if(error.get() instanceof Error)throw (Error)error.get();throw new AssertionError("HELD_RECEIVER_FAILURE");}
        require(posts[0]==1&&result.get()==MessagePreviewNotification.Result.PUBLISHED,"HELD_INITIAL_ONCE");
        if(scenario.equals("held-storage"))require(reads[0]>0&&rich[0]==1,"STORAGE_POSITIVE_CONTROL");
        else require(rich[0]==0,"FINAL_CARDS_WAIT_CANNOT_POST_STALE_RICH");
    }
    static final class Connection extends HttpsURLConnection {
        final ByteArrayOutputStream sent=new ByteArrayOutputStream();boolean disconnected;
        Connection(URL u){super(u);}public void connect(){}public void disconnect(){disconnected=true;}public boolean usingProxy(){return false;}
        public String getCipherSuite(){return "fictional";}public Certificate[] getLocalCertificates(){return null;}public Certificate[] getServerCertificates(){return null;}
        public OutputStream getOutputStream(){return sent;}
        public int getResponseCode(){onResponse.run();return 200;}
        public String getContentType(){return "application/json";}
        public InputStream getInputStream(){return new ByteArrayInputStream("[]".getBytes(StandardCharsets.UTF_8));}
    }
    static Map<String,String> payload(){Map<String,String> p=new HashMap<>();p.put("native_chat_v","1");p.put("type","message");p.put("chat_id",CHAT);
        p.put("message_id",MESSAGE);p.put("notification_id",NOTICE);p.put("tag",TAG);p.put("group_tag",TAG);p.put("route","/chat/"+CHAT);
        p.put("sender_name","UNTRUSTED_PROVIDER_NAME");p.put("preview","UNTRUSTED_PROVIDER_BODY");p.put("sender_avatar_url","UNTRUSTED_PROVIDER_MEDIA");return p;}
    static void nativeCase(String scenario) throws Exception {
        record(System.currentTimeMillis(),"authenticated",USER,SESSION);
        JSONTokener.fixture("[]",new JSONArray(new JSONObject(row(System.currentTimeMillis(),"message"))));
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL u){requests++;return connection=new Connection(u);}}:null);
        switch(scenario){
            case "native-rich":case "native-api24":break;
            case "native-render-failure":Notification.Builder.onRecover=()->{throw new IllegalStateException();};break;
            case "native-render-expired":Notification.Builder.onRecover=()->android.os.SystemClock.offset+=2000;break;
            case "native-render-read":Notification.Builder.onRecover=()->retire(new ChatNotificationIntentStore(new Context()));break;
            case "native-render-replaced":Notification.Builder.onRecover=()->ChatNotificationCleanup.reserve(new ChatNotificationIntentStore(new Context()),TAG,OTHER,OTHER);break;
            case "native-render-owner":Notification.Builder.onRecover=()->MessagePreviewSession.allowed=false;break;
            case "native-render-head":Notification.Builder.onRecover=()->headCurrent=false;break;
            case "native-render-choice":Notification.Builder.onRecover=()->choiceCurrent=false;break;
            case "native-pending-clock":onPendingIntent=()->android.os.SystemClock.offset+=2000;break;
            case "native-pending-locks":case "native-legacy-pending-locks":checkPendingLocks=true;break;
            case "native-generation-locks":checkGenerationLocks=true;break;
            case "native-no-permission":Context.permission=-1;break;
            case "native-legacy":break;
            case "native-missing":missing=true;break;
            case "native-none":level="none";break;
            case "native-sender":level="sender";JSONTokener.fixture("[]",new JSONArray(new JSONObject(row(System.currentTimeMillis(),"sender"))));break;
            case "native-keyloss":keyLoss=true;break;
            case "native-read":onResponse=()->retire(new ChatNotificationIntentStore(new Context()));break;
            case "native-replaced":onResponse=()->ChatNotificationCleanup.reserve(new ChatNotificationIntentStore(new Context()),TAG,OTHER,OTHER);break;
            case "native-unknown":Context.manager.throwNotify=true;break;
            case "native-durable":Context.preferences.failNextCommit=true;break;
            case "native-muted":Context.manager.muted=true;break;
            case "native-disabled":Context.manager.enabled=false;break;
            case "native-resumed":VoiceCallRuntime.resumed=true;break;
            case "native-expired":onResponse=()->headCurrent=false;break;
            default:throw new AssertionError("UNKNOWN_NATIVE_CASE");
        }
        if("native-api24".equals(scenario))android.os.Build.VERSION.SDK_INT=24;
        boolean legacy="native-legacy".equals(scenario)||"native-legacy-pending-locks".equals(scenario);
        Map<String,String> data=payload();if(legacy)data.remove("notification_id");
        ChatPushNotifications.receive(new Context(),new RemoteMessage(data));
        boolean skip=Arrays.asList("native-read","native-replaced","native-muted","native-disabled","native-resumed","native-no-permission","native-render-read","native-render-replaced").contains(scenario);
        require(Context.manager.posts==(skip?0:1),"NATIVE_NOTIFY_ONCE");
        if(skip){if(Arrays.asList("native-muted","native-disabled","native-resumed","native-no-permission").contains(scenario))require(requests==0&&vaultReads==0,"NATIVE_GATES_BEFORE_READ");return;}
        if("native-unknown".equals(scenario))return;
        Notification n=Context.manager.cards.values().iterator().next().getNotification();
        boolean rich="native-rich".equals(scenario)||"native-api24".equals(scenario)||"native-sender".equals(scenario)
            ||"native-pending-locks".equals(scenario)||"native-generation-locks".equals(scenario);
        require((rich?"Fictional Sender":"LETSCUBE").equals(n.title),"NATIVE_RICH_INITIAL");
        require((rich&&!"native-sender".equals(scenario)?"Fictional body":GENERIC).equals(n.body),"NATIVE_STRICT_BODY");
        require(n.visibility==Notification.VISIBILITY_PRIVATE&&(n.flags&Notification.FLAG_ONLY_ALERT_ONCE)==0,"NATIVE_PRIVATE_INITIAL_ALERT");
        require("native-api24".equals(scenario)?n.channel==null:"messages_v2".equals(n.channel),"NATIVE_SELECTED_CHANNEL_PRESERVED");
        if(rich)require(n.publicVersion!=null&&"LETSCUBE".equals(n.publicVersion.title)&&GENERIC.equals(n.publicVersion.body),"GENERIC_PUBLIC_VERSION");
        require(!n.contentIntent.data.containsKey("sender_name")&&!n.contentIntent.data.containsKey("preview")&&!n.contentIntent.data.containsKey("sender_avatar_url"),"NO_PROVIDER_PII_INTENT");
        require(n.contentIntent.target.startsWith("letscube://push/chat/"+CHAT+"/message/"+MESSAGE),"NATIVE_ROUTE_PRESERVED");
        require(("/?chat="+CHAT+"&message="+MESSAGE).equals(n.contentIntent.data.get("route")),"NATIVE_ROUTE_NOT_PROVIDER");
        if("native-durable".equals(scenario)){
            require(requests==0&&n.contentIntent.target.contains("/untracked/")&&!n.extras.containsKey(ChatNotificationCleanup.EXTRA_VERSION),"ONLY_DURABLE_NONCE_FALLBACK");
        }else if(legacy){
            require(requests==0&&vaultReads==0&&!n.extras.containsKey(ChatNotificationCleanup.EXTRA_VERSION)&&!n.contentIntent.target.contains("/untracked/"),"LEGACY_GENERIC_WITHOUT_LOOKUP");
        }else{
            require(n.extras.getLong(ChatNotificationCleanup.EXTRA_GENERATION,0)>0&&NOTICE.equals(n.extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION)),"NATIVE_TRACKED_METADATA");
            require(!n.contentIntent.target.contains("/untracked/"),"NO_NONCE_FOR_STALE_OR_UNKNOWN");
        }
        if(rich){
            require(requests==1&&connection.disconnected,"NATIVE_ONE_CLOSED_REQUEST");
            require(connection.getURL().toString().equals("https://core.letscube.ru/rest/v1/rpc/native_message_notification_preview"),"NATIVE_FIXED_RPC");
            require(connection.sent.toString("UTF-8").equals("{\"p_device_id\":\""+DEVICE+"\",\"p_notification_id\":\""+NOTICE+"\"}"),"NATIVE_EXACT_RPC_BODY");
        }
    }
    public static void main(String[] args) throws Exception {
        String scenario=args[0];if(scenario.equals("held-storage")||scenario.startsWith("cards-"))held(scenario);
        else if(scenario.startsWith("native-"))nativeCase(scenario);else port(scenario);
        System.out.println("PASS "+scenario);
    }
}
