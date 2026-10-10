package com.kub.messenger;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.function.BooleanSupplier;

public final class MessagePreviewQaUserChoiceProbe {
    private static final String USER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    private static final String OTHER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    private static final String SID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    private static final String DEVICE="cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    private static void check(boolean ok,String oracle) { if(!ok) throw new AssertionError(oracle); }
    private static Object field(Object object,String name) throws Exception {
        Field f=object.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(object);
    }
    private static void set(Object object,String name,Object value) throws Exception {
        Field f=object.getClass().getDeclaredField(name); f.setAccessible(true); f.set(object,value);
    }
    private static Map<String,Object> map(Object... pairs) {
        Map<String,Object> result=new HashMap<String,Object>();
        for(int i=0;i<pairs.length;i+=2) result.put((String)pairs[i],pairs[i+1]); return result;
    }
    private static JSObject data(Object... pairs) {
        JSObject result=new JSObject();
        for(int i=0;i<pairs.length;i+=2) result.put((String)pairs[i],pairs[i+1]); return result;
    }
    private static void pump(BooleanSupplier done,String oracle) throws Exception {
        long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
        while(!done.getAsBoolean() && System.nanoTime()<end) {
            Handler.runDue(); Runnable work=Handler.take(10); if(work!=null) work.run();
        }
        check(done.getAsBoolean(),oracle);
    }
    private static final class App extends Application {
        final ApplicationInfo info=new ApplicationInfo();
        App() { info.uid=10123; }
        public Context getApplicationContext() { return this; }
        public ApplicationInfo getApplicationInfo() { return info; }
        public boolean isDeviceProtectedStorage() { return false; }
        public File getNoBackupFilesDir() { throw new AssertionError("NO_QA_CHOICE_STORAGE"); }
        public Object getSystemService(String name) { throw new AssertionError("NO_QA_CHOICE_STORAGE"); }
    }
    private static final class Graph implements AutoCloseable {
        final App app=new App();
        final MainActivity activity=new MainActivity();
        final Bridge bridge=new Bridge(activity);
        final MessagePreviewsPlugin plugin=new MessagePreviewsPlugin();
        final MessagePreviewVerificationRuntime runtime;
        int io;
        volatile boolean authBad, holdAuth;
        final CountDownLatch entered=new CountDownLatch(1), release=new CountDownLatch(1);
        String epoch;
        Graph() throws Exception { this(true); }
        Graph(boolean qa) throws Exception {
            Looper.getMainLooper(); SystemClock.value=10_000;
            // The accepted composition route is not exercised by this choice probe.
            BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION=false;
            BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE=qa;
            activity.application=app; activity.bridge=bridge; activity.onCreate(null);
            MessagePreviewForegroundAuthority.getOrCreate(app); activity.onResume();
            plugin.setBridge(bridge); plugin.load();
            ((MessagePreviewVerificationRuntime)field(plugin,"runtime")).close();
            MessagePreviewVerificationState state=new MessagePreviewVerificationState(new MessagePreviewVerificationState.Clock() {
                public long wallTime() { return System.currentTimeMillis(); }
                public long elapsedTime() { return SystemClock.value; }
            });
            runtime=new MessagePreviewVerificationRuntime(state, deadline -> { io++; return "fictional-sdk"; },
                new MessagePreviewVerificationRuntime.Transport() {
                    public Object request(boolean auth,String access,String key,String hash,long deadline) {
                        io++;
                        if(auth && holdAuth) {
                            entered.countDown();
                            try { check(release.await(4,TimeUnit.SECONDS),"FINITE_HELD_WORKER"); }
                            catch(InterruptedException cancelled) { return null; }
                        }
                        return auth ? map("id",authBad ? OTHER : USER,"is_anonymous",false)
                            : Arrays.asList(map("binding_v",1,"recipient_id",USER,"session_id",SID,"device_id",DEVICE));
                    }
                    public void cancel() {}
                }, input -> "fictional-access".equals(input)
                    ? map("role","authenticated","aud","authenticated","is_anonymous",false,
                        "iss","https://core.letscube.ru/auth/v1","sub",USER,"session_id",SID,
                        "exp",System.currentTimeMillis()/1000+300) : map("role","anon"));
            set(plugin,"runtime",runtime);
        }
        boolean request(String user) throws Exception {
            try {
                Method m=MessagePreviewsPlugin.class.getDeclaredMethod("requestQaUserChoice",String.class);
                m.setAccessible(true); return (Boolean)m.invoke(plugin,user);
            } catch(NoSuchMethodException absent) { return false; }
        }
        PluginCall call(String name,JSObject input) throws Exception {
            PluginCall call=issue(name,input);
            pump(() -> call.result!=null,"FINITE_QA_ACK"); return call;
        }
        PluginCall issue(String name,JSObject input) throws Exception {
            PluginCall call=new PluginCall(input);
            Method method;
            try { method=MessagePreviewsPlugin.class.getMethod(name,PluginCall.class); }
            catch(NoSuchMethodException absent) { call.resolve(new JSObject().put("qa_choice_v",0)); return call; }
            Bridge.task(() -> { try { method.invoke(plugin,call); } catch(Exception failure) { throw new AssertionError("PUBLIC_QA_METHOD",failure); } });
            return call;
        }
        void begin(long revision) throws Exception {
            epoch=(String)call("beginBinding",data("revision",revision,"recipientId",USER,"recipientSessionId",SID,"accountEpoch",1)).result.opt("epoch");
            check(epoch!=null,"ORDINARY_BEGIN_CONTROL");
        }
        void verify(long revision) throws Exception {
            PluginCall call=call("verifyBinding",verifyData(revision));
            check(Boolean.TRUE.equals(call.result.opt("verified")),"ORDINARY_VERIFICATION_CONTROL");
            check(!call.getData().has("accessToken") && !call.getData().has("publicApiKey"),"CREDENTIAL_SCRUB_CONTROL");
        }
        JSObject verifyData(long revision) {
            return data("revision",revision,"epoch",epoch,"recipientId",USER,
                "recipientSessionId",SID,"accountEpoch",1,"deviceId",DEVICE,
                "accessToken","fictional-access","publicApiKey","fictional-key");
        }
        JSObject context() throws Exception {
            return call("getQaUserChoiceContext",data("recipientId",USER,"recipientSessionId",SID,"deviceId",DEVICE,"accountEpoch",1)).result;
        }
        void capabilities() throws Exception {
            JSObject cap=call("getCapabilities",data()).result;
            check(cap.length()==1 && Integer.valueOf(0).equals(cap.opt("protocol")),"CAPABILITIES_LITERAL_ZERO");
        }
        boolean observed(String value) throws Exception {
            Method m=MessagePreviewsPlugin.class.getDeclaredMethod("hasQaUserChoice",String.class);
            m.setAccessible(true); return (Boolean)m.invoke(plugin,value);
        }
        String ready() throws Exception {
            return ready(null);
        }
        String ready(Clock armClock) throws Exception {
            if(armClock==null) check(request(USER),"MAIN_REQUEST_ACCEPTED");
            else {
                // Labelled actual-owner clock port; ordinary plugin verification/publication remains real.
                MessagePreviewQaUserChoice owner=new MessagePreviewQaUserChoice(app,bridge,runtime,
                    MessagePreviewForegroundAuthority.getOrCreate(app),armClock);
                set(plugin,"qaUserChoice",owner);
                check(owner.request(USER,(java.util.concurrent.ScheduledThreadPoolExecutor)field(plugin,"deadlines")),"OWNER_CLOCK_PORT_ARM_CONTROL");
            }
            begin(1); verify(1);
            JSObject c=context(); check(c.length()==8 && "consent-only".equals(c.opt("purpose"))
                && !c.has("protocol") && USER.equals(c.opt("recipientId")) && SID.equals(c.opt("recipientSessionId"))
                && DEVICE.equals(c.opt("deviceId")) && Long.valueOf(1).equals(c.opt("accountEpoch")),"CONTEXT_EXACT_EIGHT_FIELDS");
            return (String)c.opt("contextId");
        }
        boolean ack(String name,JSObject input) throws Exception {
            JSObject result=call(name,input).result;
            check(result.length()==1 && result.opt("applied") instanceof Boolean,"STRICT_BOOLEAN_NATIVE_ACK");
            return Boolean.TRUE.equals(result.opt("applied"));
        }
        void refusal(String oracle) throws Exception {
            JSObject c=context(); check(c.length()==1 && Integer.valueOf(0).equals(c.opt("qa_choice_v")),oracle);
        }
        public void close() throws Exception { release.countDown(); plugin.handleOnDestroy(); runtime.close(); }
    }
    private static final class Clock implements MessagePreviewVerificationState.Clock {
        long wall, elapsed;
        public long wallTime() { return wall; }
        public long elapsedTime() { return elapsed; }
        Clock(long wall,long elapsed) { this.wall=wall; this.elapsed=elapsed; }
        Clock(Graph g) throws Exception {
            Object owner=field(g.plugin,"qaUserChoice");
            wall=(Long)field(owner,"lastWall"); elapsed=(Long)field(owner,"lastElapsed");
            set(owner,"clock",this);
        }
    }
    private static void awaitWithoutMain(PluginCall call) throws Exception {
        check(call.done.await(4,TimeUnit.SECONDS),"FINITE_WORKER_ACK");
    }
    private static void scenario(Graph g,String scenario) throws Exception {
        if("ordinary-false".equals(scenario)) {
            check(!g.request(USER),"ORDINARY_FALSE_ZERO_OWNER");
            check(field(g.plugin,"qaUserChoice")==null && g.bridge.listeners.isEmpty(),"ORDINARY_FALSE_ZERO_OWNER");
            g.begin(1); g.verify(1); g.capabilities(); g.refusal("ORDINARY_FALSE_NO_QA_CONTEXT");
            check(!g.ack("beginQaUserChoice",data("contextId",OTHER,"revision",1)),"ORDINARY_FALSE_NO_INTENT");
            check(g.io==4,"ORDINARY_FALSE_NO_ADDED_IO"); return;
        }
        if("main-request".equals(scenario)) {
            final boolean[] requested={true};
            Bridge.task(() -> { try { requested[0]=g.request(USER); } catch(Exception e) { throw new AssertionError(e); } });
            check(!requested[0] && field(g.plugin,"qaUserChoice")==null,"REQUEST_MAIN_ONLY_ZERO_EFFECT");
            check(!g.request("invalid") && field(g.plugin,"qaUserChoice")==null,"REQUEST_UUID_ZERO_EFFECT");
            check(g.request(USER) && !g.request(USER),"REQUEST_ONCE"); return;
        }
        if(scenario.startsWith("origin-")) {
            String kind=scenario.substring(7);
            if("remote".equals(kind)) g.bridge.getConfig().serverUrl="https://example.invalid";
            if("logging".equals(kind)) g.bridge.getConfig().enabled=true;
            if("userinfo".equals(kind)) g.bridge.webView.url="https://localhost@example.invalid/login";
            if("port".equals(kind)) g.bridge.webView.url="https://localhost:443/login";
            if("scheme".equals(kind)) g.bridge.webView.url="http://localhost/login";
            if("foreign-activity".equals(kind)) { MainActivity other=new MainActivity(); other.application=g.app; g.app.resume(other); }
            check(!g.request(USER) && field(g.plugin,"qaUserChoice")==null,"REQUEST_EXACT_LOCAL_FOREGROUND"); return;
        }
        if("arm-clock-bound".equals(scenario)) {
            SystemClock.value=9007199254620992L;
            check(!g.request(USER),"ARM_SAFE_FIXED_DEADLINE"); return;
        }
        if("first-recipient".equals(scenario)) {
            check(g.request(OTHER),"ARM_OTHER_DIAGNOSTIC"); g.begin(1); g.verify(1);
            g.refusal("FIRST_RECIPIENT_FENCE"); g.begin(2); g.verify(2); g.refusal("NO_SECOND_SEED"); return;
        }
        if("first-failed".equals(scenario)) {
            check(g.request(USER),"ARM_FIRST_FAILED"); g.begin(1); g.authBad=true;
            check(Boolean.FALSE.equals(g.call("verifyBinding",g.verifyData(1)).result.opt("verified")),"FIRST_NORMAL_FAILURE_CONTROL");
            g.authBad=false; g.begin(2); g.verify(2); g.refusal("FAILED_FIRST_CONSUMED"); return;
        }
        if("startup-clear".equals(scenario)) {
            check(g.request(USER),"ARM_STARTUP"); check(g.ack("clearBinding",data("revision",1)),"STARTUP_CLEAR_CONTROL");
            g.begin(2); g.verify(2); check(Integer.valueOf(1).equals(g.context().opt("qa_choice_v")),"STARTUP_CLEAR_PRESERVES_ARM");
            check(g.ack("clearBinding",data("revision",3)),"BOUND_CLEAR_CONTROL"); g.refusal("BOUND_CLEAR_RETIRES"); return;
        }
        if(scenario.startsWith("publication-")) {
            check(g.request(USER),"ARM_PUBLICATION"); g.begin(1);
            if("publication-held-worker-clear".equals(scenario)) g.holdAuth=true;
            PluginCall verify=g.issue("verifyBinding",g.verifyData(1));
            if(g.holdAuth) {
                check(g.entered.await(3,TimeUnit.SECONDS),"HELD_REAL_WORKER_ENTERED");
                check(g.ack("clearBinding",data("revision",2)),"CLEAR_HELD_WORKER_CONTROL");
                g.release.countDown(); awaitWithoutMain(verify);
            } else {
                awaitWithoutMain(verify);
                check(Boolean.TRUE.equals(verify.result.opt("verified")) && !Handler.mainQueue.isEmpty(),"WORKER_MATCHED_MAIN_HELD_CONTROL");
                if("publication-clear".equals(scenario)) {
                    PluginCall clear=g.issue("clearBinding",data("revision",2)); awaitWithoutMain(clear);
                } else if("publication-begin".equals(scenario)) {
                    PluginCall begin=g.issue("beginBinding",data("revision",2,"recipientId",USER,"recipientSessionId",SID,"accountEpoch",1)); awaitWithoutMain(begin);
                } else if("publication-reload".equals(scenario)) g.bridge.reload();
                else if("publication-pause".equals(scenario)) g.activity.onPause();
                else if("publication-state".equals(scenario)) g.runtime.clearBinding(2);
                else if("publication-runtime".equals(scenario)) {
                    set(g.plugin,"runtime",new MessagePreviewVerificationRuntime(new MessagePreviewVerificationState(new MessagePreviewVerificationState.Clock() {
                        public long wallTime(){return System.currentTimeMillis();} public long elapsedTime(){return SystemClock.value;}
                    }),d->"fictional",new MessagePreviewVerificationRuntime.Transport(){public Object request(boolean a,String b,String c,String d,long e){return null;}public void cancel(){}},v->null));
                } else if("publication-bridge".equals(scenario)) g.plugin.setBridge(new Bridge(g.activity));
                else if("publication-load".equals(scenario)) g.plugin.load();
                else throw new AssertionError("PUBLICATION_SCENARIO");
            }
            while(!Handler.mainQueue.isEmpty()) { Runnable work=Handler.take(10); if(work!=null) work.run(); }
            check(field(field(g.plugin,"qaUserChoice"),"contextId")==null,"LATE_MAIN_PUBLICATION_REFUSED");
            g.refusal("LATE_MAIN_PUBLICATION_REFUSED"); return;
        }
        if(scenario.startsWith("deadline-")) {
            Clock c=new Clock(1700000000000L,10000);
            long initialWall=c.wall, initialElapsed=c.elapsed;
            g.ready(c);
            c.wall=initialWall+119999; c.elapsed=initialElapsed+119999;
            JSObject before=g.context(); check(Integer.valueOf(1).equals(before.opt("qa_choice_v")),"CONTEXT_D_MINUS_ONE");
            check(((Long)before.opt("expiresAt"))==initialWall+120000,"NONRENEWABLE_WALL_EXPIRY");
            if("deadline-wall".equals(scenario)) c.wall=initialWall+120000;
            if("deadline-elapsed".equals(scenario)) c.elapsed=initialElapsed+120000;
            if("deadline-rollback".equals(scenario)) c.wall--;
            if("deadline-elapsed-back".equals(scenario)) c.elapsed--;
            g.refusal("CONTEXT_FIXED_D_OR_ROLLBACK"); return;
        }
        String context=g.ready();
        if("authority-check".equals(scenario)) {
            MessagePreviewForegroundAuthority.getOrCreate(g.app).onActivityPrePaused(g.activity);
            g.refusal("ACTUAL_AUTHORITY_CURRENT_RECHECK"); return;
        }
        if("selector-not-lease".equals(scenario)) {
            SystemClock.value+=15000;
            check(!g.plugin.hasVerifiedBinding(USER),"ORDINARY_TTL_NOT_EXTENDED");
            check(Integer.valueOf(1).equals(g.context().opt("qa_choice_v")),"QA_HISTORICAL_SELECTOR_ONLY"); return;
        }
        if("strict-inputs".equals(scenario)) {
            check(!g.ack("beginQaUserChoice",data("contextId",context,"revision",1,"accessToken","fictional")),"QA_EXTRA_KEY_REFUSAL");
            for(Object rev:new Object[]{"1",-1,0,1.5,9007199254740992d,Double.NaN})
                check(!g.ack("beginQaUserChoice",data("contextId",context,"revision",rev)),"QA_SAFE_REVISION_REFUSAL");
            check(g.ack("beginQaUserChoice",data("contextId",context,"revision",1)),"QA_BEGIN_CONTROL");
            check(!g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","rich")),"QA_CHOICE_LITERAL_ONLY");
            check(g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","sender")),"STRICT_REFUSALS_NO_MUTATION");
            check(g.io==4,"NO_QA_IO_STORAGE"); return;
        }
        if("retire-never-begun".equals(scenario)) {
            check(g.ack("retireQaUserChoice",data("contextId",context,"expectedIntentRevision",0,"revision",1)),"NEVER_BEGUN_EXACT_ZERO_RETIRE");
            check(g.observed("RETIRED"),"NEVER_BEGUN_TERMINAL"); return;
        }
        if("held-confirm".equals(scenario)) {
            check(g.ack("beginQaUserChoice",data("contextId",context,"revision",1)),"HELD_A_PENDING_CONTROL");
            PluginCall a=g.issue("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","message"));
            Runnable held=Handler.take(100); check(held!=null && a.result==null,"HELD_TASK_TO_MAIN_A");
            check(g.ack("beginQaUserChoice",data("contextId",context,"revision",2)),"HELD_B_PENDING_CONTROL");
            held.run(); check(Boolean.FALSE.equals(a.result.opt("applied")),"HELD_A_CANNOT_CONFIRM_B");
            check(g.ack("confirmQaUserChoice",data("contextId",context,"revision",2,"choice","sender")) && g.observed("sender"),"HELD_B_CONFIRM_SURVIVES"); return;
        }
        if("save-expiry".equals(scenario)) {
            check(g.ack("beginQaUserChoice",data("contextId",context,"revision",1)),"SAVE_PENDING_CONTROL");
            Clock c=new Clock(g); c.elapsed+=120000;
            check(!g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","message")),"EXPIRED_AFTER_SAVE_NO_CONFIRM");
            check(g.ack("retireQaUserChoice",data("contextId",context,"expectedIntentRevision",1,"revision",2)),"EXPIRED_SAVE_EXACT_RETIRE"); return;
        }
        check(g.ack("beginQaUserChoice",data("contextId",context,"revision",1)),"MAIN_MARSHAL_BEGIN");
        check(!g.observed("none"),"PENDING_NOT_CONFIRMED");
        check(g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","sender")) && g.observed("sender"),"CONFIRM_EXACT_PENDING_CONTROL");
        if("confirm-once".equals(scenario)) {
            check(!g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","message")) && g.observed("sender"),"CONFIRM_ONCE"); return;
        }
        if("intent-successor".equals(scenario)) {
            check(!g.ack("beginQaUserChoice",data("contextId",context,"revision",1)) && g.observed("sender"),"BEGIN_STRICT_NEWER");
            check(g.ack("beginQaUserChoice",data("contextId",context,"revision",2)) && !g.observed("sender"),"BEGIN_CLOSES_PREVIOUS_INTENT");
            check(!g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","message")),"HELD_CONFIRM_CANNOT_CHANGE_B");
            check(!g.ack("retireQaUserChoice",data("contextId",context,"expectedIntentRevision",1,"revision",1000)),"HELD_RETIRE_CANNOT_CHANGE_B");
            check(g.ack("confirmQaUserChoice",data("contextId",context,"revision",2,"choice","none")) && g.observed("none"),"B_SURVIVES_OLD_A"); return;
        }
        if("foreign-larger".equals(scenario)) {
            check(!g.ack("retireQaUserChoice",data("contextId",OTHER,"expectedIntentRevision",1,"revision",1000)),"FOREIGN_CONTEXT_ZERO_EFFECT");
            check(!g.ack("beginQaUserChoice",data("contextId",OTHER,"revision",1000)),"FOREIGN_BEGIN_ZERO_EFFECT");
            check(g.observed("sender") && g.ack("beginQaUserChoice",data("contextId",context,"revision",2)),"FOREIGN_LARGER_NO_HIGH_WATER"); return;
        }
        if(scenario.startsWith("retire-")) {
            if("retire-pause".equals(scenario)) g.activity.onPause();
            if("retire-logging".equals(scenario)) g.bridge.getConfig().enabled=true;
            if("retire-expiry".equals(scenario)) { Clock c=new Clock(g); c.elapsed+=120000; }
            check(!g.ack("confirmQaUserChoice",data("contextId",context,"revision",1,"choice","message")),"INVALIDATED_NO_POSITIVE_CONFIRM");
            check(g.ack("retireQaUserChoice",data("contextId",context,"expectedIntentRevision",1,"revision",2)),"EXACT_ERASURE_WITHOUT_AUTHORITY");
            check(g.observed("RETIRED") && !g.request(USER),"TERMINAL_NO_RECREATION"); g.refusal("RETIRED_NO_CONTEXT"); return;
        }
        if("main-methods".equals(scenario)) { g.capabilities(); check(g.io==4,"MAIN_METHODS_NO_EXTRA_IO"); return; }
        throw new AssertionError("NAMED_SCENARIO_REQUIRED");
    }
    public static void main(String[] args) throws Exception {
        String scenario=args[0];
        try(Graph g=new Graph(!"ordinary-false".equals(scenario))) {
            if("feature".equals(scenario)) {
                boolean requested=g.request(USER);
                g.begin(1); g.verify(1); g.capabilities();
                check(g.io==4,"NORMAL_VERIFIER_FOUR_PORT_CALLS");
                System.out.println("CONTROL ordinary binding and protocol0 PASS");
                JSObject context=g.context();
                check(requested && Integer.valueOf(1).equals(context.opt("qa_choice_v")),
                    "QA_CHOICE_FEATURE_ABSENT_WITH_ORDINARY_PROTOCOL0_INTACT");
            } else scenario(g,scenario);
        }
        System.out.println("PASS "+scenario);
    }
}
