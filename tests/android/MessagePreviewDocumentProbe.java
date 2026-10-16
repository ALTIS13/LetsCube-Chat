package com.kub.messenger;

import android.os.Looper;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.*;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.*;

/** Actual plugin/Runtime revisions; only framework document lifecycle is fictional. */
public final class MessagePreviewDocumentProbe {
    static final class Ack extends PluginCall {
        final java.util.concurrent.atomic.AtomicInteger resolutions=new java.util.concurrent.atomic.AtomicInteger();
        Ack(JSObject data){super(data);}
        @Override public void resolve(JSObject data){resolutions.incrementAndGet();super.resolve(data);}
    }
    static final class LocalBridge extends Bridge {
        String url="https://localhost/";
        final android.webkit.WebView web=new android.webkit.WebView(){public String getUrl(){return url;}};
        LocalBridge(MainActivity activity){super(activity);}
        public android.webkit.WebView getWebView(){return web;}public String getLocalUrl(){return "https://localhost";}
    }
    static void need(boolean yes,String oracle){if(!yes)throw new AssertionError(oracle);}
    static String context(MessagePreviewsPlugin plugin)throws Exception {
        Method getter;
        try{getter=MessagePreviewsPlugin.class.getDeclaredMethod("getVerificationContext",PluginCall.class);}
        catch(NoSuchMethodException absent){throw new AssertionError("DOCUMENT_SCOPED_VERIFICATION_REQUIRED");}
        PluginCall call=new PluginCall(new JSObject());
        Bridge.task(()->{try{getter.invoke(plugin,call);}catch(Exception error){throw new AssertionError("CONTEXT_CALL",error);}});
        MessagePreviewSessionProbe.pump(()->call.result!=null,"CONTEXT_ACK");
        Object value=call.result.opt("documentId");need(value instanceof String&&MessagePreviewVerificationState.uuid((String)value),"NATIVE_DOCUMENT_ID");
        return (String)value;
    }
    static Object field(Object object,String name)throws Exception{Field f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
    static void seed(MessagePreviewSessionProbe.App app)throws Exception{
        String installation="11111111111111111111111111111111",operation="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String alias="letscube.nmpv.credential.v1."+installation+"."+operation;
        File namespace=new File(app.root,"native-message-previews-v1");need(namespace.mkdir(),"FIXTURE_NAMESPACE");
        byte[] nonce=new byte[16];Arrays.fill(nonce,(byte)0x11);File marker=new File(namespace,"installation-v1.bin");
        Files.write(marker.toPath(),MessagePreviewInstallationMarker.encode(nonce));android.system.Os.modes.put(marker.getPath(),0600);
        var metadata=new MessagePreviewProducerPlatform.Handle();var credential=new MessagePreviewProducerPlatform.Handle();
        MessagePreviewProducerPlatform.keys.put("letscube.nmpv.metadata.v1."+installation,metadata);MessagePreviewProducerPlatform.keys.put(alias,credential);
        long now=System.currentTimeMillis(),expiry=now+300_000;
        var h=new MessagePreviewMetadataEnvelope.Header(installation,9,MessagePreviewMetadataEnvelope.Kind.COMMITTED,alias,expiry,now,operation,8,47);
        byte[] blob=MessagePreviewCredentialEnvelope.seal(h,new MessagePreviewVaultFence.Owner(MessagePreviewSessionProbe.USER,
            MessagePreviewSessionProbe.SESSION,MessagePreviewSessionProbe.DEVICE,7),MessagePreviewSessionProbe.ACCESS,expiry,credential);
        Files.write(new File(namespace,"journal-v1.bin").toPath(),MessagePreviewMetadataEnvelope.seal(h,blob,metadata));
    }
    static void lockRace(MessagePreviewsPlugin plugin,Bridge bridge,String document,MessagePreviewSessionProbe.App app)throws Exception{
        var session=(MessagePreviewSession)field(plugin,"sessionOwner");
        MessagePreviewSessionProbe.type=MessagePreviewSession.class;MessagePreviewSessionProbe.completionType=MessagePreviewSession.Completion.class;
        MessagePreviewSessionProbe.session=session;
        var runtime=MessagePreviewSessionProbe.verifier();Field r=MessagePreviewsPlugin.class.getDeclaredField("runtime");r.setAccessible(true);r.set(plugin,runtime);
        session.attach(bridge,runtime);MessagePreviewSession.nextRevision();
        Thread[] contender={null};CountDownLatch held=new CountDownLatch(1),cleared=new CountDownLatch(1),release=new CountDownLatch(1);
        Throwable[] background={null};PluginCall clear=new PluginCall(new JSObject().put("documentId",document).put("revision",1));
        MessagePreviewSessionProbe.beforeReply=()->{
            contender[0]=new Thread(()->{
                try{synchronized(plugin){held.countDown();plugin.clearBinding(clear);cleared.countDown();need(release.await(4,TimeUnit.SECONDS),"RELEASE_PLUGIN");}}
                catch(Throwable failure){background[0]=failure;}
            },"CapacitorPlugins");contender[0].setDaemon(true);contender[0].start();
            try{
                need(held.await(3,TimeUnit.SECONDS),"REAL_PLUGIN_MONITOR_HELD");
                need(!Thread.holdsLock(session),"NO_PLUGIN_SESSION_LOCK_INVERSION");
                need(cleared.await(3,TimeUnit.SECONDS),"CONCURRENT_AUTH_CLEAR_PROGRESS");
                need(Looper.myLooper()==Looper.getMainLooper(),"COMPLETION_ON_MAIN_QUEUE");
            }catch(InterruptedException interrupted){throw new AssertionError("INTERRUPTED");}
            finally{release.countDown();}
            synchronized(plugin){need(Boolean.TRUE.equals(clear.result.opt("applied")),"CONCURRENT_CLEAR_ACK");}
        };
        try{
            MessagePreviewSessionProbe.verify(bridge,runtime,1);
            MessagePreviewSessionProbe.pump(()->MessagePreviewSessionProbe.reply!=null,"ONE_UNBLOCKED_COMPLETION");
            need(MessagePreviewSessionProbe.replies==1,"SINGLE_SESSION_ACK");
            MessagePreviewSessionProbe.pump(()->MessagePreviewSessionProbe.retired(app),"CONCURRENT_CLEAR_EXACT_ERASURE");
        }finally{
            release.countDown();MessagePreviewSessionProbe.beforeReply=()->{};
            if(contender[0]!=null){contender[0].join(3000);need(!contender[0].isAlive(),"FINITE_PLUGIN_CONTENDER");}
        }
        need(background[0]==null,"CAPACITOR_CLEAR_WITHOUT_EXCEPTION");
    }
    static String begin(MessagePreviewsPlugin plugin,String scope,long revision){
        PluginCall call=new PluginCall(new JSObject().put("documentId",scope).put("revision",revision)
            .put("recipientId",MessagePreviewSessionProbe.USER).put("recipientSessionId",MessagePreviewSessionProbe.SESSION).put("accountEpoch",7));
        Bridge.task(()->plugin.beginBinding(call));
        Object epoch=call.result.opt("epoch");return epoch instanceof String?(String)epoch:null;
    }
    static void run(String scenario,String path)throws Exception {
        Looper.getMainLooper();var app=new MessagePreviewSessionProbe.App(path);var activity=new MainActivity();activity.application=app;
        boolean cold=scenario.equals("cold-clear")||scenario.equals("cold-new-bridge"),concurrent=scenario.equals("concurrent-lock");
        if(cold||concurrent)MessagePreviewProducerPlatform.install();
        if(cold)seed(app);
        LocalBridge bridge=new LocalBridge(activity);
        activity.bridge=bridge;activity.onCreate(null);activity.onResume();
        MessagePreviewsPlugin plugin=new MessagePreviewsPlugin();plugin.setBridge(bridge);plugin.load();
        try{
            if(scenario.equals("remote-context")||scenario.equals("context-extra-keys")){
                if(scenario.equals("remote-context"))bridge.url="https://foreign.invalid/";
                Ack call=new Ack(scenario.equals("context-extra-keys")?new JSObject().put("extra",true):new JSObject());
                Bridge.task(()->plugin.getVerificationContext(call));
                MessagePreviewSessionProbe.pump(()->call.result!=null,"REFUSED_CONTEXT_ACK");
                need(call.result.opt("documentId")==org.json.JSONObject.NULL&&call.resolutions.get()==1,"NO_NONLOCAL_OR_WRONG_SHAPE_CONTEXT");
                need(field(field(plugin,"sessionOwner"),"bridge")==null,"REFUSED_CONTEXT_NEVER_ATTACHES");return;
            }
            if(cold){
                if(scenario.equals("cold-new-bridge")){
                    context(plugin);plugin.handleOnDestroy();
                    var nextActivity=new MainActivity();nextActivity.application=app;LocalBridge nextBridge=new LocalBridge(nextActivity);
                    nextActivity.bridge=nextBridge;nextActivity.onCreate(null);nextActivity.onResume();
                    MessagePreviewsPlugin next=new MessagePreviewsPlugin();next.setBridge(nextBridge);next.load();
                    try{coldClear(next,app);}finally{next.handleOnDestroy();}
                }else coldClear(plugin,app);
                return;
            }
            if(concurrent){lockRace(plugin,bridge,context(plugin),app);return;}
            String old=context(plugin);need(begin(plugin,old,1)!=null,"FIRST_DOCUMENT_BEGIN");
            bridge.reload();String current=context(plugin);need(!old.equals(current),"DOCUMENT_ID_ROTATES");
            String epoch=begin(plugin,current,1);need(epoch!=null,"NEW_DOCUMENT_COUNTER_CAN_RESTART");
            if(scenario.equals("old-clear")){
                PluginCall stale=new PluginCall(new JSObject().put("documentId",old).put("revision",999));
                Bridge.task(()->plugin.clearBinding(stale));need(Boolean.FALSE.equals(stale.result.opt("applied")),"OLD_DOCUMENT_CANNOT_CLEAR_NEW_SESSION");
            }else if(scenario.equals("old-begin"))need(begin(plugin,old,1000)==null,"OLD_DOCUMENT_CANNOT_BEGIN_NEW_SESSION");
            Field rf=MessagePreviewsPlugin.class.getDeclaredField("runtime");rf.setAccessible(true);Object runtime=rf.get(plugin);
            Field sf=MessagePreviewVerificationRuntime.class.getDeclaredField("state");sf.setAccessible(true);Object state=sf.get(runtime);
            Field cf=MessagePreviewVerificationState.class.getDeclaredField("current");cf.setAccessible(true);Object ticket=cf.get(state);
            need(ticket!=null,"CURRENT_DOCUMENT_TICKET_SURVIVES");Field ef=ticket.getClass().getDeclaredField("epoch");ef.setAccessible(true);
            need(epoch.equals(ef.get(ticket)),"EXACT_CURRENT_DOCUMENT_TICKET");
        }finally{plugin.handleOnDestroy();}
    }
    static void coldClear(MessagePreviewsPlugin plugin,MessagePreviewSessionProbe.App app)throws Exception{
        String scope=context(plugin);Ack clear=new Ack(new JSObject().put("documentId",scope).put("revision",1));
        need(MessagePreviewSessionProbe.record(app).header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED,"CONTEXT_NOT_IMPLICIT_ERASURE");
        Bridge.task(()->plugin.clearBinding(clear));
        need(Boolean.TRUE.equals(clear.result.opt("applied"))&&clear.resolutions.get()==1,"COLD_CLEAR_ACK");
        need(MessagePreviewProducerPlatform.credentials()==1,"CLEAR_ACK_IS_ADMISSION_NOT_DURABLE_PROOF");
        MessagePreviewSessionProbe.pump(()->MessagePreviewSessionProbe.retired(app),"COLD_CLEAR_RETIRES_EXISTING_HEAD");
        var h=MessagePreviewSessionProbe.record(app).header;
        need(h.generation==10&&h.vaultRevision==48&&MessagePreviewSessionProbe.auths==0&&MessagePreviewSessionProbe.sdkReads==0
            &&clear.resolutions.get()==1,"COLD_CLEAR_WITHOUT_VERIFY_OR_RESET");
    }
    public static void main(String[] args){try{run(args[0],args[1]);System.out.println("PASS "+args[0]);}
        catch(Throwable e){System.err.println("FAIL "+(e instanceof AssertionError?e.getMessage():"UNEXPECTED"));System.exit(1);}}
}
