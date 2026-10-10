package com.kub.messenger;

import android.app.Application;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Field;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Delayed;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.function.BooleanSupplier;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.util.AtomicFile;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

public final class MessagePreviewForegroundCompositionProbe {
    private static final String USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    private static final String OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    private static final String SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    private static final String DEVICE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    private static final String ACCESS = "fictional-access-only";
    private static final String KEY = "fictional-public-key";
    private static void check(boolean value, String oracle) {
        if (!value) throw new AssertionError(oracle);
    }

    private static boolean packagePrivate(int modifiers) {
        return !Modifier.isPublic(modifiers) && !Modifier.isProtected(modifiers)
            && !Modifier.isPrivate(modifiers);
    }

    private static void privateBoolean(String name, List<String> missing) throws Exception {
        Method method;
        try {
            method = MessagePreviewsPlugin.class.getDeclaredMethod(name, String.class);
        } catch (NoSuchMethodException absent) {
            missing.add(name);
            return;
        }
        check(packagePrivate(method.getModifiers()) && !Modifier.isStatic(method.getModifiers())
            && method.getReturnType() == boolean.class, "QA_NATIVE_PRIVATE_BOOLEAN_" + name);
    }

    private static void featureContract() throws Exception {
        List<String> missing = new ArrayList<String>();
        privateBoolean("requestQaComposition", missing);
        privateBoolean("hasQaCompositionPhase", missing);
        Class<?> holder = null;
        try {
            holder = Class.forName("com.kub.messenger.MessagePreviewForegroundComposition");
        } catch (ClassNotFoundException absent) {
            missing.add("MessagePreviewForegroundComposition");
        }
        check(missing.isEmpty(), "GENUINE_QA_COMPOSITION_FEATURE_ABSENT:" + String.join(",", missing));
        Method bootstrap = holder.getDeclaredMethod("bootstrap", Application.class);
        check(Modifier.isStatic(bootstrap.getModifiers()), "QA_HOLDER_STATIC_BOOTSTRAP");
        Class<?> issuer = Class.forName("com.kub.messenger.MessagePreviewForegroundAuthority");
        Constructor<?> constructor = holder.getDeclaredConstructor(Application.class, Object.class,
            MessagePreviewVerificationRuntime.class, issuer, ScheduledThreadPoolExecutor.class);
        check(packagePrivate(constructor.getModifiers()), "QA_HOLDER_PACKAGE_PRIVATE_CONSTRUCTOR");
        check(bootstrap.getReturnType() == void.class, "QA_HOLDER_BOOTSTRAP_VOID");
    }

    private static Object field(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }
    private static Object registered(Class<?> type) throws Exception {
        Field field = type.getDeclaredField("registered");
        field.setAccessible(true);
        return field.get(null);
    }
    private static void set(Object object, String name, Object value) throws Exception {
        Field field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(object, value);
    }
    private static Map<String,Object> object(Object... pairs) {
        Map<String,Object> result = new HashMap<String,Object>();
        for (int i=0; i<pairs.length; i+=2) result.put((String)pairs[i], pairs[i+1]);
        return result;
    }
    private static void pumpUntil(BooleanSupplier done, String oracle) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (!done.getAsBoolean() && System.nanoTime() < end) {
            Handler.runDue();
            Runnable callback = Handler.take(30);
            if (callback != null) callback.run();
        }
        check(done.getAsBoolean(), oracle);
    }
    private static void drain() throws Exception {
        for (int i=0; i<100; i++) {
            Runnable callback = Handler.take(10);
            if (callback == null) return;
            callback.run();
        }
        throw new AssertionError("FINITE_MAIN_QUEUE_DRAIN");
    }

    // Only scheduler passage is fictional: production retains/cancels these
    // exact futures and all callbacks run through its real Handler posts.
    private static final class Deadlines extends ScheduledThreadPoolExecutor {
        final List<Timer> timers = new ArrayList<Timer>();
        Deadlines() { super(1); }
        @Override public synchronized ScheduledFuture<?> schedule(Runnable work, long delay, TimeUnit unit) {
            Timer timer = new Timer(work, SystemClock.value + unit.toMillis(delay));
            timers.add(timer);
            return timer;
        }
        boolean retainedAt(long deadline) {
            for (Timer timer : timers) if (timer.due == deadline && !timer.cancelled && !timer.done) return true;
            return false;
        }
        void fireDue() {
            List<Timer> selected;
            synchronized(this) { selected = new ArrayList<Timer>(timers); }
            for (Timer timer : selected) if (!timer.cancelled && !timer.done && timer.due <= SystemClock.value) {
                timer.done = true;
                Bridge.task(timer.work);
            }
        }
    }
    private static final class Timer implements ScheduledFuture<Object> {
        final Runnable work;
        final long due;
        volatile boolean cancelled, done;
        Timer(Runnable work, long due) { this.work=work; this.due=due; }
        public boolean cancel(boolean interrupt) { cancelled=true; return true; }
        public boolean isCancelled() { return cancelled; }
        public boolean isDone() { return done || cancelled; }
        public long getDelay(TimeUnit unit) { return unit.convert(due-SystemClock.value, TimeUnit.MILLISECONDS); }
        public int compareTo(Delayed other) { return Long.compare(getDelay(TimeUnit.MILLISECONDS), other.getDelay(TimeUnit.MILLISECONDS)); }
        public Object get() { throw new AssertionError("NO_MAIN_TIMER_WAIT"); }
        public Object get(long timeout, TimeUnit unit) { throw new AssertionError("NO_MAIN_TIMER_WAIT"); }
    }
    private static final class App extends Application {
        final File directory;
        final UserManager manager = new UserManager();
        final ApplicationInfo info = new ApplicationInfo();
        App(Path directory) { this.directory=directory.toFile(); info.uid=10123; }
        public Context getApplicationContext() { return this; }
        public boolean isDeviceProtectedStorage() { return false; }
        public File getNoBackupFilesDir() { return directory; }
        public ApplicationInfo getApplicationInfo() { return info; }
        public Object getSystemService(String name) { return manager; }
    }
    private static final class Reply implements MessagePreviewForegroundComposition.Completion {
        volatile Boolean value;
        int count;
        public void complete(boolean value) { this.value=value; count++; }
    }
    private static final class Verifier {
        final List<String> calls = new ArrayList<String>();
        final List<Long> ioDeadlines = new ArrayList<Long>();
        final List<String> threads = new ArrayList<String>();
        volatile Runnable afterAuth = () -> {};
        volatile Runnable afterSecond = () -> {};
        Object holder;
        int sdkReads;
        final MessagePreviewVerificationState state;
        final MessagePreviewVerificationRuntime runtime;
        Verifier() {
            state = new MessagePreviewVerificationState(new MessagePreviewVerificationState.Clock() {
                public long wallTime() { return System.currentTimeMillis(); }
                public long elapsedTime() { return SystemClock.value; }
            });
            runtime = new MessagePreviewVerificationRuntime(state, deadline -> {
                io("OwnSDK", deadline);
                if (++sdkReads == 2) afterSecond.run();
                return "fictional-sdk-token";
            }, new MessagePreviewVerificationRuntime.Transport() {
                public Object request(boolean auth, String access, String key, String tokenHash, long deadline) {
                    check(ACCESS.equals(access) && KEY.equals(key), "EXACT_FICTIONAL_BORROWED_INPUT");
                    io(auth ? "AuthGET" : "ResolverPOST", deadline);
                    if (auth) { afterAuth.run(); return object("id", USER, "is_anonymous", false); }
                    return Arrays.asList(object("binding_v", 1, "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE));
                }
                public void cancel() {}
            }, input -> ACCESS.equals(input)
                ? object("role", "authenticated", "aud", "authenticated", "is_anonymous", false,
                    "iss", "https://core.letscube.ru/auth/v1", "sub", USER, "session_id", SESSION,
                    "exp", System.currentTimeMillis()/1000 + 300)
                : object("role", "anon"));
        }
        void io(String name, long deadline) {
            check(!Thread.holdsLock(runtime) && !Thread.holdsLock(state)
                && (holder == null || !Thread.holdsLock(holder)), "NO_COMPOSITION_MONITOR_IO");
            calls.add(name); ioDeadlines.add(deadline); threads.add(Thread.currentThread().getName());
        }
    }
    private static final class Graph implements AutoCloseable {
        final App app;
        final MainActivity activity = new MainActivity();
        final Bridge bridge;
        final Verifier verifier = new Verifier();
        final Deadlines deadlines = new Deadlines();
        final MessagePreviewForegroundAuthority issuer;
        final MessagePreviewForegroundComposition holder;
        final MessagePreviewsPlugin plugin;
        final Reply reply = new Reply();
        String epoch;
        Graph(Path directory) throws Exception { this(directory, false); }
        Graph(Path directory, boolean pluginRoute) throws Exception {
            Looper.getMainLooper();
            SystemClock.value=10_000;
            BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION=true;
            MessagePreviewProducerPlatform.install();
            app = new App(directory);
            activity.application=app;
            bridge = new Bridge(activity); activity.bridge=bridge;
            activity.onCreate(null);
            check(app.callbacks.size() == 1, "ACTUAL_MAIN_CREATE_BOOTSTRAPS_BEFORE_RESUME");
            issuer = MessagePreviewForegroundAuthority.getOrCreate(app);
            try { issuer.capture(); throw new AssertionError("NO_SYNTHETIC_RESUME_AT_CREATE"); }
            catch (MessagePreviewForegroundAuthority.Unavailable expected) {}
            activity.onResume();
            issuer.capture();
            if (pluginRoute) {
                plugin = new MessagePreviewsPlugin(); plugin.setBridge(bridge); plugin.load();
                ((MessagePreviewVerificationRuntime)field(plugin,"runtime")).close();
                ((ScheduledThreadPoolExecutor)field(plugin,"deadlines")).shutdownNow();
                // Replace only the actual runtime's external ports/clock and scheduler.
                // The native request, routing, producer and vault remain production code.
                set(plugin,"runtime",verifier.runtime); set(plugin,"deadlines",deadlines);
                check(plugin.requestQaComposition(USER),"ACTUAL_PLUGIN_NATIVE_QA_REQUEST");
                holder = (MessagePreviewForegroundComposition)field(plugin,"qaComposition");
            } else {
                plugin=null;
                holder = new MessagePreviewForegroundComposition(app, bridge, verifier.runtime, issuer, deadlines);
            }
            verifier.holder=holder;
            if (pluginRoute) {
                PluginCall begin=new PluginCall(new JSObject().put("revision",1).put("recipientId",USER)
                    .put("recipientSessionId",SESSION).put("accountEpoch",7));
                Bridge.task(() -> plugin.beginBinding(begin)); epoch=(String)begin.result.opt("epoch");
            } else epoch = verifier.runtime.beginBinding(1, USER, SESSION, 7);
            check(MessagePreviewVerificationState.uuid(epoch), "ACTUAL_QA_BEGIN_EPOCH");
        }
        void request() { check(holder.request(USER), "ONE_EXPLICIT_QA_REQUEST"); }
        boolean offer(Reply reply, String user, Object bridge, MessagePreviewVerificationRuntime runtime) {
            final boolean[] routed = new boolean[1];
            Bridge.task(() -> {
                check(Looper.myLooper() != Looper.getMainLooper(), "TASK_HANDLER_IS_NOT_MAIN");
                routed[0] = holder.offer(bridge, runtime, 1, epoch, user, SESSION, 7, DEVICE, ACCESS, KEY, 18_000, reply);
            });
            return routed[0];
        }
        void offer() { check(offer(reply, USER, bridge, verifier.runtime), "CHOICE_ROUTES_ONE_COMPOSITION"); }
        void offerTuple(String epoch, String session, long account, String device) {
            final boolean[] routed=new boolean[1];
            Bridge.task(() -> routed[0]=holder.offer(bridge,verifier.runtime,1,epoch,USER,session,account,device,ACCESS,KEY,18_000,reply));
            check(routed[0],"ONE_QA_TUPLE_ATTEMPT_ROUTED");
        }
        boolean finished() {
            try { return Boolean.TRUE.equals(field(holder,"finished")); }
            catch(Exception error) { throw new AssertionError("ACTUAL_TERMINAL_STATE_READBACK",error); }
        }
        void committed() throws Exception {
            pumpUntil(() -> reply.value != null, "FINITE_COMPOSITION_ACK");
            check(Boolean.TRUE.equals(reply.value) && reply.count == 1 && holder.phaseObserved("COMMITTED"), "COMPOSITION_ACK_TRUE");
            check(holder.phaseObserved("INITIALIZED") && holder.phaseObserved("PENDING"), "CHECKED_PHASE_ORDER_G0_G1");
            MessagePreviewMetadataEnvelope.Record record = record();
            check(record.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED && record.header.generation == 1
                && record.header.baseGeneration == 0 && record.header.vaultRevision == 1
                && record.credentialBytes().length >= 28 && MessagePreviewProducerPlatform.credentials() == 1,
                "ACTUAL_ENCRYPTED_COMMITTED_G1");
            check(MessagePreviewCredentialEnvelope.verifyMatch(record, record.header,
                new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 7), ACCESS, record.header.expiresWallMillis,
                MessagePreviewProducerPlatform.keys.get(record.header.alias)), "ACTUAL_COMMIT_DECRYPT_MATCH");
            Object invocation=field(holder, "invocation");
            check(field(invocation,"access") == null && field(invocation,"publicKey") == null
                && field(invocation,"completion") == null, "ACK_CLEARS_OWNED_CREDENTIAL_AND_COMPLETION_REFERENCES");
            check(verifier.calls.equals(Arrays.asList("AuthGET","OwnSDK","ResolverPOST","OwnSDK")), "EXACT_ONE_GUARDED_CHAIN");
            check(verifier.threads.equals(Arrays.asList("NmpvPristineOwner","NmpvPristineOwner","NmpvPristineOwner","NmpvPristineOwner")),
                "EXACT_RETAINED_OWNER_WORKER");
        }
        Path journal() { return app.directory.toPath().resolve("native-message-previews-v1/journal-v1.bin"); }
        MessagePreviewMetadataEnvelope.Record record() throws Exception {
            String installation=MessagePreviewInstallationMarker.decode(Files.readAllBytes(app.directory.toPath()
                .resolve("native-message-previews-v1/installation-v1.bin")));
            return MessagePreviewMetadataEnvelope.open(Files.readAllBytes(journal()), installation,
                MessagePreviewProducerPlatform.keys.get("letscube.nmpv.metadata.v1."+installation));
        }
        void retired(String oracle) throws Exception {
            pumpUntil(() -> holder.phaseObserved("RETIRED") || finished(), oracle);
            check(holder.phaseObserved("RETIRED"),oracle);
            MessagePreviewMetadataEnvelope.Record record=record();
            check(record.header.kind == MessagePreviewMetadataEnvelope.Kind.EMPTY && record.header.generation == 2
                && record.header.baseGeneration == 1 && record.header.vaultRevision == 2
                && MessagePreviewProducerPlatform.credentials() == 0, "EXACT_CORRELATED_EMPTY_G2");
            check(app.directory.toPath().resolve("native-message-previews-v1/installation-v1.bin").toFile().exists()
                && MessagePreviewProducerPlatform.keys.size() == 1, "METADATA_AND_MARKER_RETAINED");
        }
        void noVault() {
            check(!journal().toFile().exists() && MessagePreviewProducerPlatform.keys.isEmpty()
                && verifier.calls.isEmpty(), "REFUSED_BEFORE_VAULT_AND_VERIFIER_IO");
        }
        public void close() throws Exception {
            AtomicFile.onEvent=null; AtomicFile.startThrows=false; AtomicFile.finishThrows=false;
            holder.close(); drain();
            Object owner=registered(MessagePreviewPristineInitializer.class);
            if (owner != null) ((MessagePreviewPristineInitializer)owner).close();
            verifier.runtime.close(); deadlines.shutdownNow(); issuer.close();
            if (plugin != null) plugin.handleOnDestroy();
        }
    }

    private static void pluginRoute(Path directory, boolean destroy) throws Exception {
        try(Graph g=new Graph(directory,true)) {
            PluginCall capabilities=new PluginCall(new JSObject()); g.plugin.getCapabilities(capabilities);
            check(Integer.valueOf(0).equals(capabilities.result.opt("protocol")) && capabilities.result.length() == 1,
                "QA_PLUGIN_PROTOCOL_LITERAL_ZERO");
            PluginCall verify=new PluginCall(new JSObject().put("revision",1).put("epoch",g.epoch)
                .put("recipientId",USER).put("recipientSessionId",SESSION).put("accountEpoch",7).put("deviceId",DEVICE)
                .put("accessToken",ACCESS).put("publicApiKey",KEY));
            Bridge.task(() -> g.plugin.verifyBinding(verify));
            check(!Handler.mainQueue.isEmpty(),"PLUGIN_QA_OFFER_POSTS_MAIN_NOT_ORDINARY_WORKER");
            check(!verify.getData().has("accessToken") && !verify.getData().has("publicApiKey")
                && verify.result == null && g.verifier.calls.isEmpty(),"PLUGIN_SCRUBS_BEFORE_MAIN_ADMISSION_AND_NO_ORDINARY_CONSUMPTION");
            check(g.deadlines.retainedAt(18_000),"PLUGIN_ENTRY_D_18000_NOT_DELAYED_MAIN_D_21000");
            SystemClock.value=13_000;
            pumpUntil(() -> verify.result != null,"FINITE_QA_PLUGIN_ACK");
            check(Boolean.TRUE.equals(verify.result.opt("verified")) && verify.result.length() == 1
                && g.plugin.hasQaCompositionPhase("COMMITTED"),"ACTUAL_QA_PLUGIN_COMMITTED_ACK_ONLY");
            g.reply.complete(true); g.committed();
            check(g.verifier.ioDeadlines.equals(Arrays.asList(18_000L,18_000L,18_000L,18_000L))
                && g.deadlines.retainedAt(18_000),"PLUGIN_ENTRY_D_18000_NOT_DELAYED_MAIN_D_21000");
            if (destroy) Bridge.task(() -> g.plugin.handleOnDestroy());
            else {
                PluginCall clear=new PluginCall(new JSObject().put("revision",2));
                Bridge.task(() -> g.plugin.clearBinding(clear));
                check(Boolean.TRUE.equals(clear.result.opt("applied")) && clear.result.length() == 1,"ACTUAL_PLUGIN_LOGOUT_CLEAR_ACK");
            }
            g.retired("PLUGIN_RETIRES_EXACT_G2_BEFORE_OWNER_CLOSE");
            check(g.plugin.hasQaCompositionPhase("RETIRED"),"PLUGIN_OBSERVES_CHECKED_RETIREMENT");
        }
    }

    private static void reload(Path directory, boolean bound) throws Exception {
        try(Graph g=new Graph(directory,true)) {
            if (bound) { g.offer(); g.committed(); }
            g.bridge.reload(); drain();
            check(Boolean.TRUE.equals(field(g.holder,"cancelled")),
                bound ? "BOUND_QA_INVOCATION_RETIRES_ON_ACTUAL_PAGE_STARTED" : "UNBOUND_QA_INTENT_CANNOT_CROSS_DOCUMENT_RELOAD");
            if (bound) g.retired("PAGE_STARTED_EXACT_BOUND_ERASURE_G2"); else g.noVault();
            check(!g.plugin.requestQaComposition(USER),"RELOAD_CANNOT_RECREATE_TERMINAL_QA_HOLDER");
            Bridge.task(() -> g.plugin.handleOnDestroy()); drain();
            check(g.bridge.listeners.isEmpty(),"OWN_QA_LISTENER_REMOVED_ON_MAIN_AFTER_DESTROY");
        }
    }

    private static void ordinaryDisabled(Path directory) throws Exception {
        Looper.getMainLooper(); SystemClock.value=10_000;
        BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION=false;
        App app=new App(directory); MainActivity activity=new MainActivity(); activity.application=app;
        Bridge bridge=new Bridge(activity); activity.bridge=bridge; activity.onCreate(null); activity.onResume();
        MessagePreviewsPlugin plugin=new MessagePreviewsPlugin(); plugin.setBridge(bridge); plugin.load();
        check(!plugin.requestQaComposition(USER) && registered(MessagePreviewForegroundComposition.class) == null,
            "QA_DISABLED_NEVER_CREATES_HOLDER");
        PluginCall capabilities=new PluginCall(new JSObject()); plugin.getCapabilities(capabilities);
        check(capabilities.result.length() == 1 && Integer.valueOf(0).equals(capabilities.result.opt("protocol")), "PUBLIC_PROTOCOL_LITERAL_ZERO");
        Verifier verifier=new Verifier(); set(plugin,"runtime",verifier.runtime);
        String epoch=verifier.runtime.beginBinding(1,USER,SESSION,7);
        PluginCall call=new PluginCall(new JSObject().put("revision",1).put("accountEpoch",7).put("epoch",epoch)
            .put("recipientId",USER).put("recipientSessionId",SESSION).put("deviceId",DEVICE).put("accessToken",ACCESS).put("publicApiKey",KEY));
        Bridge.task(() -> plugin.verifyBinding(call));
        check(call.done.await(4,TimeUnit.SECONDS) && Boolean.TRUE.equals(call.result.opt("verified")), "ORDINARY_DISABLED_ACK_UNCHANGED");
        check(call.result.length() == 1 && !call.getData().has("accessToken") && !call.getData().has("publicApiKey"), "ORDINARY_ACK_AND_SCRUB_ONLY");
        check(registered(MessagePreviewForegroundComposition.class) == null && registered(MessagePreviewPristineInitializer.class) == null
            && !directory.resolve("native-message-previews-v1").toFile().exists() && bridge.listeners.isEmpty(), "ORDINARY_DISABLED_ZERO_VAULT_EFFECTS");
        plugin.handleOnDestroy();
    }

    private static void scenario(Path directory, String scenario) throws Exception {
        check(Arrays.asList("qa-disabled-ordinary","no-choice","request-off-main","request-expired",
            "wrong-recipient","wrong-bridge","wrong-runtime","unbound-clear","attempted-ticket",
            "healthy-main-worker","admission-delay","held-main-expired","held-auth-pause","held-auth-destroy",
            "lost-pending","final-at","final-before","duplicate-offer","stale-binding","ack-no-renew",
            "plugin-clear","plugin-destroy","wrong-epoch","wrong-session","wrong-account","wrong-device",
            "held-init-unknown","late-retire-after-unknown","vault-failure-after-verifier","logout",
            "final-producer-shorter","reload-unbound","reload-bound").contains(scenario),
            "KNOWN_NAMED_COMPOSITION_SCENARIO");
        if (scenario.equals("qa-disabled-ordinary")) { ordinaryDisabled(directory); return; }
        if (scenario.equals("plugin-clear") || scenario.equals("plugin-destroy")) {
            pluginRoute(directory,scenario.equals("plugin-destroy")); return;
        }
        if (scenario.equals("reload-unbound") || scenario.equals("reload-bound")) {
            reload(directory,scenario.equals("reload-bound")); return;
        }
        try (Graph g=new Graph(directory)) {
            if (scenario.equals("no-choice")) {
                check(!g.offer(g.reply,USER,g.bridge,g.verifier.runtime) && g.reply.value == null, "NO_CHOICE_LEAVES_ORDINARY_ROUTE");
                g.noVault(); return;
            }
            if (scenario.equals("request-off-main")) {
                final boolean[] accepted=new boolean[1]; Bridge.task(() -> accepted[0]=g.holder.request(USER));
                check(!accepted[0], "REQUEST_REQUIRES_MAIN_AUTHORITY"); g.noVault(); return;
            }
            g.request();
            if (scenario.equals("final-producer-shorter")) {
                SystemClock.value=24_000;
                final boolean[] handled=new boolean[1];
                Bridge.task(() -> handled[0]=g.holder.offer(g.bridge,g.verifier.runtime,1,g.epoch,USER,SESSION,7,DEVICE,
                    ACCESS,KEY,32_000,g.reply));
                check(handled[0],"SHORTER_PRODUCER_CASE_ROUTED");
                Runnable held=null;
                long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
                while(System.nanoTime()<end) {
                    Runnable callback=Handler.take(30); if(callback == null) continue;
                    MessagePreviewMetadataEnvelope.Record record=null;
                    try { record=g.record(); } catch(Exception notYet) {}
                    if(record != null && record.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED) { held=callback; break; }
                    callback.run();
                }
                check(held != null && g.reply.value == null,"COMMITTED_BEFORE_SHORTER_PRODUCER_D_25000_CALLBACK_HELD");
                check(g.verifier.ioDeadlines.equals(Arrays.asList(25_000L,25_000L,25_000L,25_000L)),
                    "EXACT_BEGIN_PLUS_15000_PRODUCER_D_25000_NOT_NATIVE_D_32000");
                SystemClock.value=25_001; held.run();
                check(Boolean.FALSE.equals(g.reply.value) && !g.holder.phaseObserved("COMMITTED"),
                    "FINAL_ACK_REFUSES_AFTER_PRODUCER_D_25000_BEFORE_NATIVE_D_32000");
                g.retired("SHORTER_PRODUCER_DEADLINE_EXACT_ERASURE_G2"); return;
            }
            if (scenario.startsWith("wrong-") && Arrays.asList("wrong-epoch","wrong-session","wrong-account","wrong-device").contains(scenario)) {
                g.offerTuple(scenario.equals("wrong-epoch") ? DEVICE : g.epoch,
                    scenario.equals("wrong-session") ? OTHER : SESSION,scenario.equals("wrong-account") ? 8 : 7,
                    scenario.equals("wrong-device") ? OTHER : DEVICE);
                pumpUntil(() -> g.reply.value != null,"FINITE_TUPLE_DIVERGENCE_REFUSAL");
                check(Boolean.FALSE.equals(g.reply.value) && !g.holder.phaseObserved("COMMITTED")
                    && MessagePreviewProducerPlatform.credentials() == 0,"EXACT_CONTEXT_OWNER_TUPLE_DIVERGENCE_REFUSED");
                if (scenario.equals("wrong-device")) g.retired("WRONG_DEVICE_PENDING_CHECKED_ERASURE"); else g.noVault();
                return;
            }
            if (scenario.equals("request-expired")) {
                SystemClock.value=130_000; g.offer();
                check(Boolean.FALSE.equals(g.reply.value), "REQUEST_REFUSES_AT_120000_LEASE"); g.noVault(); return;
            }
            if (scenario.equals("wrong-recipient") || scenario.equals("wrong-bridge") || scenario.equals("wrong-runtime")) {
                MessagePreviewVerificationRuntime supplied=scenario.equals("wrong-runtime") ? new Verifier().runtime : g.verifier.runtime;
                g.offer(g.reply,scenario.equals("wrong-recipient") ? OTHER : USER,
                    scenario.equals("wrong-bridge") ? new Object() : g.bridge,supplied);
                check(Boolean.FALSE.equals(g.reply.value), "EXACT_QA_INVOCATION_REFUSAL");
                Reply retry=new Reply(); g.offer(retry,USER,g.bridge,g.verifier.runtime);
                check(Boolean.FALSE.equals(retry.value) && !g.holder.request(USER), "REFUSAL_CONSUMES_CHOICE_WITHOUT_ORDINARY_FALLBACK");
                g.noVault(); return;
            }
            if (scenario.equals("unbound-clear")) {
                check(g.verifier.runtime.clearBinding(2), "STARTUP_CLEAR_CONTROL"); g.holder.bindingChanged(2);
                g.epoch=g.verifier.runtime.beginBinding(3,USER,SESSION,7);
                final boolean[] handled=new boolean[1];
                Bridge.task(() -> handled[0]=g.holder.offer(g.bridge,g.verifier.runtime,3,g.epoch,USER,SESSION,7,DEVICE,ACCESS,KEY,18_000,g.reply));
                check(handled[0], "UNBOUND_CLEAR_PRESERVES_CHOICE"); g.committed(); g.holder.bindingChanged(); g.retired("UNBOUND_CLEAR_THEN_CHECKED_ERASURE"); return;
            }
            if (scenario.equals("attempted-ticket")) {
                check(g.verifier.runtime.verifyBinding(1,g.epoch,USER,SESSION,7,DEVICE,ACCESS,KEY), "ORDINARY_ATTEMPTED_CONTROL");
                g.offer(); pumpUntil(() -> g.reply.value != null,"FINITE_ATTEMPTED_REFUSAL");
                check(Boolean.FALSE.equals(g.reply.value) && !g.journal().toFile().exists()
                    && g.verifier.calls.size() == 4, "ATTEMPTED_ORDINARY_TICKET_CANNOT_COMPOSE"); return;
            }
            if (scenario.equals("held-auth-pause") || scenario.equals("held-auth-destroy")) {
                CountDownLatch entered=new CountDownLatch(1), release=new CountDownLatch(1);
                g.verifier.afterAuth=() -> { entered.countDown(); try { check(release.await(3,TimeUnit.SECONDS),"FINITE_AUTH_HOLD"); }
                    catch(InterruptedException refused) { throw new AssertionError("FINITE_AUTH_HOLD"); } };
                g.offer(); pumpUntil(() -> entered.getCount() == 0,"ACTUAL_AUTH_ENTERED");
                if (scenario.endsWith("pause")) g.activity.onPause(); else g.activity.onDestroy();
                release.countDown(); g.retired("LIFECYCLE_LOSS_ERASES_BEFORE_OWNER_CLOSE");
                check(Boolean.FALSE.equals(g.reply.value) && g.verifier.calls.equals(Arrays.asList("AuthGET")), "NO_FURTHER_IO_AFTER_LIFECYCLE_LOSS"); return;
            }
            if (scenario.equals("held-init-unknown")) {
                CountDownLatch entered=new CountDownLatch(1), release=new CountDownLatch(1);
                AtomicFile.onEvent=name -> { if(name.equals("journal-finish")) {
                    entered.countDown(); try { check(release.await(3,TimeUnit.SECONDS),"FINITE_INIT_HOLD"); }
                    catch(InterruptedException error) { throw new AssertionError("FINITE_INIT_HOLD"); }
                } };
                g.offer(); pumpUntil(() -> entered.getCount() == 0,"INITIALIZER_EXTERNAL_IO_HELD");
                g.holder.close(); drain(); SystemClock.value=20_000; Handler.runDue(); drain();
                check(g.finished() && !g.holder.phaseObserved("RETIRED"),"HELD_INIT_CLEANUP_BOUNDED_UNKNOWN_AT_10000");
                release.countDown(); AtomicFile.onEvent=null; drain();
                check(!g.holder.phaseObserved("COMMITTED") && !g.holder.phaseObserved("RETIRED")
                    && g.verifier.calls.isEmpty(),"LATE_INIT_NEVER_ADMITS_AFTER_TERMINAL_UNKNOWN"); return;
            }
            if (scenario.equals("vault-failure-after-verifier")) {
                g.verifier.afterSecond=() -> {
                    final int[] writes=new int[1];
                    AtomicFile.onEvent=name -> { if(name.equals("journal-start")) AtomicFile.startThrows=++writes[0] == 1; };
                };
                g.offer(); pumpUntil(() -> g.reply.value != null,"FINITE_VAULT_FAILURE_ACK");
                check(Boolean.FALSE.equals(g.reply.value) && !g.holder.phaseObserved("COMMITTED"),"ORDINARY_VERIFIED_BOOLEAN_IS_NOT_VAULT_COMMIT");
                check(g.verifier.calls.equals(Arrays.asList("AuthGET","OwnSDK","ResolverPOST","OwnSDK")),"VERIFIER_COMPLETED_BEFORE_VAULT_FAILURE");
                return;
            }
            g.offer();
            if (scenario.equals("held-main-expired")) {
                SystemClock.value=18_000; pumpUntil(() -> g.reply.value != null,"FINITE_QUEUED_DEADLINE_REFUSAL");
                check(Boolean.FALSE.equals(g.reply.value),"HELD_MAIN_REFUSES_AT_ORIGINAL_D_18000"); g.noVault(); return;
            }
            if (scenario.equals("admission-delay")) SystemClock.value=13_000;
            if (scenario.equals("lost-pending") || scenario.equals("final-at") || scenario.equals("final-before")) {
                MessagePreviewMetadataEnvelope.Kind target=scenario.equals("lost-pending")
                    ? MessagePreviewMetadataEnvelope.Kind.PENDING : MessagePreviewMetadataEnvelope.Kind.COMMITTED;
                Runnable held=null;
                long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
                while (System.nanoTime()<end) {
                    Runnable callback=Handler.take(30);
                    if (callback == null) continue;
                    MessagePreviewMetadataEnvelope.Record record=null;
                    try { record=g.record(); } catch(Exception notYet) {}
                    if (record != null && record.header.kind == target) { held=callback; break; }
                    callback.run();
                }
                check(held != null,"EXACT_DURABLE_PHASE_CALLBACK_HELD");
                if (scenario.equals("lost-pending")) {
                    check(!g.holder.phaseObserved("PENDING"),"LOST_PENDING_ACK_NOT_FABRICATED");
                    g.verifier.runtime.clearBinding(2); g.holder.bindingChanged(2);
                    g.retired("LOST_PENDING_CORRELATED_ERASURE_G2");
                    held.run(); drain();
                    check(!g.holder.phaseObserved("COMMITTED") && g.verifier.calls.isEmpty(),"LOST_PENDING_NEVER_PROVISIONS_OR_REPLAYS");
                } else {
                    if (scenario.equals("final-before")) {
                        SystemClock.value=17_999; held.run(); g.committed(); g.holder.bindingChanged();
                        g.retired("FINAL_CALLBACK_D_MINUS_ONE_THEN_ERASURE"); return;
                    }
                    SystemClock.value=18_000; held.run();
                    check(Boolean.FALSE.equals(g.reply.value) && !g.holder.phaseObserved("COMMITTED"),"LATE_COMMIT_CALLBACK_REFUSES_AT_D_18000");
                    g.retired("LATE_COMMIT_CALLBACK_ERASES_G2");
                }
                return;
            }
            g.committed();
            if (scenario.equals("late-retire-after-unknown")) {
                g.holder.bindingChanged(); Runnable held=null;
                long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
                while(System.nanoTime()<end) {
                    Runnable callback=Handler.take(30); if(callback == null) continue;
                    if(g.record().header.kind == MessagePreviewMetadataEnvelope.Kind.EMPTY) { held=callback; break; }
                    callback.run();
                }
                check(held != null && !g.holder.phaseObserved("RETIRED"),"EXACT_ERASURE_ACK_HELD");
                SystemClock.value=20_000; Handler.runDue(); drain();
                check(g.finished(),"CLEANUP_UNKNOWN_BOUND_REACHED"); held.run();
                check(!g.holder.phaseObserved("RETIRED"),"LATE_RETIREMENT_AFTER_UNKNOWN_MUST_NOT_CLAIM_RETIRED"); return;
            }
            if (scenario.equals("admission-delay")) {
                check(g.verifier.ioDeadlines.equals(Arrays.asList(18_000L,18_000L,18_000L,18_000L)), "ORIGINAL_PLUGIN_D_18000_NOT_VAULT_D_21000");
            }
            if (scenario.equals("duplicate-offer")) {
                Reply duplicate=new Reply(); g.offer(duplicate,USER,g.bridge,g.verifier.runtime);
                check(Boolean.FALSE.equals(duplicate.value) && g.reply.count == 1 && g.verifier.calls.size() == 4
                    && g.verifier.runtime.hasVerifiedBinding(USER) && MessagePreviewProducerPlatform.credentials() == 1,
                    "DUPLICATE_ACK_FALSE_WITHOUT_PRIOR_RETIREMENT_OR_ORDINARY_IO");
            }
            if (scenario.equals("stale-binding")) {
                g.holder.bindingChanged(0); g.holder.bindingChanged(1); drain();
                check(!g.holder.phaseObserved("RETIRED") && MessagePreviewProducerPlatform.credentials() == 1,
                    "STALE_REVISION_MUST_NOT_RETIRE_CURRENT_COMPOSITION");
            }
            if (scenario.equals("ack-no-renew")) {
                check(g.deadlines.retainedAt(18_000),"ACK_RETAINS_EXACT_ORIGINAL_D_18000");
                SystemClock.value=17_999; g.deadlines.fireDue(); drain();
                check(MessagePreviewProducerPlatform.credentials() == 1 && !g.holder.phaseObserved("RETIRED"),"LEASE_CURRENT_AT_D_MINUS_ONE");
                SystemClock.value=18_000; g.deadlines.fireDue(); g.retired("ACK_DOES_NOT_RENEW_NATIVE_D_18000");
                check(g.reply.count == 1,"EXPIRY_DOES_NOT_REPLY_TWICE"); return;
            }
            g.verifier.runtime.clearBinding(2); g.holder.bindingChanged(2);
            if (scenario.equals("logout")) check(Boolean.TRUE.equals(field(g.holder,"cancelled")),"LOGOUT_REVOKES_BOUND_INVOCATION");
            g.retired("COMMIT_THEN_EXACT_ERASURE_BEFORE_CLOSE");
            check(!g.holder.phaseObserved("EMPTY") && !g.holder.phaseObserved(null),"HISTORICAL_PHASES_LIMITED");
            try { new MessagePreviewForegroundComposition(g.app,g.bridge,g.verifier.runtime,g.issuer,g.deadlines);
                throw new AssertionError("TERMINAL_HOLDER_NEVER_RECREATES"); }
            catch(IllegalStateException expected) {}
        }
    }

    public static void main(String[] args) throws Exception {
        check(args.length >= 1,"NAMED_COMPOSITION_SCENARIO");
        if (args[0].equals("feature-contract")) featureContract();
        else { check(args.length == 2,"OWNED_FIXTURE_DIRECTORY"); scenario(new File(args[1]).toPath(),args[0]); }
        System.out.println("PASS " + args[0]);
    }
}
