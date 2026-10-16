package com.kub.messenger;

import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;

// Fictional decoder/Auth/SDK/resolver only. Execute the actual Runtime/State/parser.
public final class MessagePreviewVerificationProducerProbe {
    private static final String USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    private static final String SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    private static final String DEVICE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    private static final String ACCESS = "fictional-access-only";
    private static final String PUBLIC_KEY = "fictional-public-key";
    private static final String A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    private static void check(boolean value, String refusal) {
        if (!value) throw new AssertionError(refusal);
    }
    private static Map<String, Object> object(Object... pairs) {
        Map<String, Object> result = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
        return result;
    }
    private static final class Clock implements MessagePreviewVerificationState.Clock {
        long wall = 1_800_000_000_000L, elapsed = 10_000;
        volatile long wallOffset;
        final boolean shared;
        Clock(boolean shared) { this.shared = shared; }
        @Override public long wallTime() { return shared ? System.currentTimeMillis() + wallOffset : wall; }
        @Override public long elapsedTime() { return shared ? SystemClock.elapsedRealtime() : elapsed; }
        void advance(long amount) { wall += amount; elapsed += amount; }
    }
    private static final class Fixture {
        final Clock clock;
        final MessagePreviewVerificationState state;
        final List<String> calls = new ArrayList<>();
        final List<Long> deadlines = new ArrayList<>();
        final Map<String, Object> claims;
        String hash;
        String session = SESSION, secondSdk = "fictional-sdk-token";
        Object resolver;
        Runnable afterAuth = new Runnable() { public void run() {} };
        Runnable afterResolver = new Runnable() { public void run() {} };
        Runnable afterSecond = new Runnable() { public void run() {} };
        int sdkReads;
        final MessagePreviewVerificationRuntime runtime;
        Fixture() { this(false); }
        Fixture(boolean shared) {
            clock = new Clock(shared); state = new MessagePreviewVerificationState(clock);
            claims = object("role", "authenticated", "aud", "authenticated", "is_anonymous", false,
                "iss", "https://core.letscube.ru/auth/v1", "sub", USER, "session_id", SESSION,
                "exp", shared ? clock.wallTime() / 1000 + 60 : 1_800_000_300L);
            runtime = new MessagePreviewVerificationRuntime(state,
            new MessagePreviewVerificationRuntime.TokenSource() {
                @Override public String token(long deadline) {
                    io(); calls.add("OwnSDK"); deadlines.add(deadline);
                    if (++sdkReads == 2) { afterSecond.run(); return secondSdk; }
                    return "fictional-sdk-token";
                }
            }, new MessagePreviewVerificationRuntime.Transport() {
                @Override public Object request(boolean user, String access, String key, String tokenHash, long deadline) {
                    check(ACCESS.equals(access) && PUBLIC_KEY.equals(key), "EXACT_FICTIONAL_INPUT");
                    io(); calls.add(user ? "AuthGET" : "ResolverPOST"); deadlines.add(deadline);
                    if (user) {
                        check(tokenHash == null, "AUTH_HAS_NO_TOKEN_HASH");
                        afterAuth.run();
                        return object("id", USER, "is_anonymous", false);
                    }
                    hash = tokenHash; afterResolver.run();
                    return resolver != null ? resolver : Arrays.asList(object("binding_v", 1, "recipient_id", USER,
                        "session_id", session, "device_id", DEVICE));
                }
                @Override public void cancel() { }
            }, new MessagePreviewVerificationRuntime.JwtDecoder() {
                @Override public Map<String, Object> decode(String input) {
                    if (ACCESS.equals(input)) return claims;
                    check(PUBLIC_KEY.equals(input), "NO_OTHER_DECODER_INPUT");
                    return object("role", "anon");
                }
            });
        }
        void io() {
            check(!Thread.holdsLock(runtime) && !Thread.holdsLock(state), "NO_VERIFIER_MONITOR_AROUND_IO");
            if (clock.shared) check(Thread.currentThread().getName().equals("NmpvPristineOwner"), "ACTUAL_RETAINED_WORKER");
        }
        String begin() {
            String epoch = runtime.beginBinding(1, USER, SESSION, 7);
            check(MessagePreviewVerificationState.uuid(epoch), "ACTUAL_BEGIN_CONTROL");
            return epoch;
        }
        boolean verify(String epoch) {
            return runtime.verifyBinding(1, epoch, USER, SESSION, 7, DEVICE, ACCESS, PUBLIC_KEY);
        }
        void chain(long deadline) {
            check(calls.equals(Arrays.asList("AuthGET", "OwnSDK", "ResolverPOST", "OwnSDK")),
                "LITERAL_ACTUAL_CHAIN_ORDER");
            check(deadlines.equals(Arrays.asList(deadline, deadline, deadline, deadline)),
                "ORIGINAL_DEADLINE_AT_ALL_IO");
            check("eabd9e6d5f19df791c972947e1890d00ca63800d95ded29f4551bb8cd5d5ecc2".equals(hash),
                "EXACT_OWN_FICTIONAL_TOKEN_HASH");
        }
    }

    private static void producerFeature() {
        try {
            Class<?> producer = Class.forName("com.kub.messenger.MessagePreviewVerificationProducer");
            check(!Modifier.isPublic(producer.getModifiers()), "PRODUCER_INTERNAL_ONLY");
            check(MessagePreviewVaultProvisioning.Authority.class.isAssignableFrom(producer),
                "PRODUCER_USES_EXISTING_AUTHORITY");
        } catch (ClassNotFoundException absent) {
            throw new AssertionError("PRODUCER_FEATURE_ABSENT");
        }
    }
    private static void guardedFeature() {
        try {
            MessagePreviewVaultProvisioning.Authority.class.getDeclaredMethod("verify",
                MessagePreviewVaultProvisioning.Identity.class, String.class, long.class,
                MessagePreviewVaultProvisioning.Current.class);
        } catch (NoSuchMethodException absent) {
            throw new AssertionError("GUARDED_AUTHORITY_FEATURE_ABSENT");
        }
    }
    private static Method originalNativeDeadlineArm() {
        try {
            return MessagePreviewVerificationProducer.class.getDeclaredMethod("arm",
                MessagePreviewVaultProvisioning.Identity.class, long.class);
        } catch (NoSuchMethodException absent) {
            throw new AssertionError("ORIGINAL_NATIVE_DEADLINE_FEATURE_ABSENT");
        }
    }
    private static void originalNativeDeadlineFeature() throws Exception {
        Method method = originalNativeDeadlineArm();
        check(!Modifier.isPublic(method.getModifiers()) && method.getReturnType() == void.class,
            "ORIGINAL_NATIVE_DEADLINE_INTERNAL_ONLY");
        java.lang.reflect.Field deadline = Class.forName("com.kub.messenger.MessagePreviewVerificationProducer$Admission")
            .getDeclaredField("originalDeadline");
        check(Modifier.isFinal(deadline.getModifiers()) && deadline.getType() == long.class,
            "ORIGINAL_NATIVE_D_IMMUTABLE_ADMISSION");
    }
    private static void armOriginalNativeDeadline(MessagePreviewVerificationProducer producer,
            MessagePreviewVaultProvisioning.Identity identity, long deadline) throws Exception {
        try { originalNativeDeadlineArm().invoke(producer, identity, deadline); }
        catch (InvocationTargetException refused) {
            if (refused.getCause() instanceof Exception) throw (Exception) refused.getCause();
            throw (Error) refused.getCause();
        }
    }
    private static final class DeadlineInvocation implements AutoCloseable {
        final Fixture f = new Fixture();
        final Passive passive = new Passive();
        final MessagePreviewVaultProvisioning.Identity identity;
        final MessagePreviewVerificationProducer producer;
        DeadlineInvocation() throws Exception {
            MessagePreviewVaultFence.Context c = new MessagePreviewVaultFence.Context(1, f.begin(), USER, SESSION, 7);
            identity = new MessagePreviewVaultProvisioning.Identity(A, 0, 0, c,
                new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 7));
            producer = new MessagePreviewVerificationProducer(f.runtime, passive, PUBLIC_KEY);
        }
        @Override public void close() { producer.close(); f.runtime.close(); }
    }
    private static MessagePreviewVerificationState.ProducerPermit resultPermit(
            MessagePreviewVaultProvisioning.Verification result) throws Exception {
        java.lang.reflect.Field field = MessagePreviewVaultProvisioning.Verification.class.getDeclaredField("producerPermit");
        field.setAccessible(true);
        return (MessagePreviewVerificationState.ProducerPermit) field.get(result);
    }
    private static void nativeDeadlineDirect(String kind) throws Exception {
        try (DeadlineInvocation d = new DeadlineInvocation()) {
            if (kind.equals("legacy-calibration")) {
                d.producer.arm(d.identity);
                MessagePreviewVaultProvisioning.Verification result = d.producer.verify(d.identity, ACCESS, 18_000,
                    () -> d.producer.requireCurrent(d.identity));
                d.f.chain(18_000);
                check(result != null && resultPermit(result).deadline == 18_000,
                    "LEGACY_ARM_LITERAL_18000_CONTROL"); return;
            }
            long original = kind.equals("expired-admission") ? 9999 : kind.equals("at-admission") ? 10_000
                : kind.equals("unsafe-negative") ? -1 : kind.equals("unsafe-large") ? 9007199254740992L
                : kind.equals("unsafe-sentinel") ? Long.MAX_VALUE : 11_000;
            boolean refusal = kind.endsWith("admission") || (kind.startsWith("unsafe-") && !kind.equals("unsafe-supplied"))
                || kind.equals("capture-expiry");
            if (kind.equals("capture-expiry")) d.passive.afterCapture = () -> d.f.clock.advance(1000);
            if (refusal) {
                try {
                    armOriginalNativeDeadline(d.producer, d.identity, original);
                    throw new AssertionError("NATIVE_D_ADMISSION_REFUSAL_" + kind);
                } catch (MessagePreviewVerificationProducer.Unavailable expected) {
                    check(expected.getCause() == null, "NATIVE_D_FIXED_ADMISSION_REFUSAL");
                }
                check(d.f.calls.isEmpty(), "NATIVE_D_ADMISSION_NO_IO");
                check(d.f.verify(d.identity.context.epoch), "NATIVE_D_REFUSAL_DID_NOT_CONSUME_TICKET");
                d.f.chain(kind.equals("capture-expiry") ? 19_000 : 18_000); return;
            }
            armOriginalNativeDeadline(d.producer, d.identity, 11_000);
            if (kind.equals("current-at") || kind.equals("current-after") || kind.equals("verify-expired")) {
                d.f.clock.advance(999);
                d.producer.requireCurrent(d.identity);
                check(d.f.calls.isEmpty(), "NATIVE_D_BEFORE_CURRENT_NO_IO");
                d.f.clock.advance(kind.equals("current-after") ? 2 : 1);
                if (kind.equals("verify-expired")) {
                    try {
                        d.producer.verify(d.identity, ACCESS, 18_000, () -> {});
                        throw new AssertionError("NATIVE_D_EXPIRED_VERIFY_NO_IO");
                    } catch (MessagePreviewVerificationProducer.Unavailable expected) { }
                } else {
                    try {
                        d.producer.requireCurrent(d.identity);
                        throw new AssertionError("NATIVE_D_CURRENT_REFUSES_" + kind);
                    } catch (MessagePreviewVerificationProducer.Unavailable expected) { }
                }
                check(d.f.calls.isEmpty(), "NATIVE_D_EXPIRED_NO_DISPATCH"); return;
            }
            if (kind.equals("unsafe-supplied")) {
                try {
                    d.producer.verify(d.identity, ACCESS, 9007199254740992L, () -> {});
                    throw new AssertionError("NATIVE_D_UNSAFE_SUPPLIED_REFUSED");
                } catch (MessagePreviewVerificationProducer.Unavailable expected) { }
                check(d.f.calls.isEmpty(), "NATIVE_D_UNSAFE_SUPPLIED_NO_IO"); return;
            }
            List<Long> callbacks = new ArrayList<>();
            MessagePreviewVaultProvisioning.Verification result = d.producer.verify(d.identity, ACCESS,
                kind.equals("tighter-vault") ? 10_500 : 18_000, () -> {
                    callbacks.add(d.f.clock.elapsedTime()); d.producer.requireCurrent(d.identity);
                });
            check(result != null, "NATIVE_D_REAL_VERIFICATION_RESULT");
            check(d.f.calls.equals(Arrays.asList("AuthGET", "OwnSDK", "ResolverPOST", "OwnSDK")),
                "NATIVE_D_LITERAL_CHAIN");
            check(callbacks.size() > 1 && callbacks.stream().allMatch(value -> value == 10_000L),
                "NATIVE_D_CALLBACKS_CURRENT_10000");
            MessagePreviewVerificationState.ProducerPermit permit = resultPermit(result);
            if (kind.equals("tighter-vault")) {
                check(d.f.deadlines.equals(Arrays.asList(10_500L, 10_500L, 10_500L, 10_500L))
                    && permit != null && permit.deadline == 10_500, "TIGHTER_VAULT_D_LITERAL_10500");
            } else {
                check(d.f.deadlines.equals(Arrays.asList(11_000L, 11_000L, 11_000L, 11_000L)),
                    "ORIGINAL_NATIVE_D_11000_NOT_18000");
                check(permit != null && permit.deadline == 11_000 && !permit.revoked,
                    "NATIVE_D_PERMIT_LITERAL_11000");
                d.f.clock.advance(999); d.producer.requireCurrent(d.identity);
                check(!permit.revoked, "NATIVE_D_PERMIT_TRUE_AT_10999");
                d.f.clock.advance(1);
                try { d.producer.requireCurrent(d.identity); throw new AssertionError("NATIVE_D_PERMIT_FALSE_AT_11000"); }
                catch (MessagePreviewVerificationProducer.Unavailable expected) { }
                check(permit.revoked && permit.deadline == 11_000, "NATIVE_D_PERMIT_REVOKED_NOT_RENEWED");
            }
        }
    }
    private static void oldTicket() {
        Fixture f = new Fixture(); String epoch = f.begin();
        check(f.verify(epoch), "ORDINARY_CHAIN_HEALTHY_CONTROL");
        f.chain(18_000);
        check(f.runtime.matchesVerified(1, epoch, USER, SESSION, 7, DEVICE), "CACHED_BOOLEAN_CONTROL");
        check(!f.verify(epoch), "OLD_TICKET_CANNOT_BE_REUSED");
        check(f.runtime.matchesVerified(1, epoch, USER, SESSION, 7, DEVICE), "REFUSAL_PRESERVES_ORDINARY_RESULT");
        f.chain(18_000);
        check(f.state.start(1, epoch, USER, SESSION, 7, DEVICE) == null, "NO_SECOND_STATE_START");
        f.runtime.close();
    }
    private static void originalDeadline() {
        Fixture f = new Fixture(); String epoch = f.begin();
        f.clock.advance(10_000);
        check(f.verify(epoch), "DELAYED_ORDINARY_CHAIN_CONTROL");
        // 10_000 original begin + 15_000, not 20_000 verification start + 8_000.
        f.chain(25_000);
        f.runtime.close();
    }
    private static final class Passive implements MessagePreviewInitializationGate.ForegroundAuthority {
        final Object snapshot = new Object();
        volatile boolean live = true;
        Runnable afterCapture = () -> {};
        public Object capture() { afterCapture.run(); return snapshot; }
        public boolean isCurrent(Object captured) { return live && captured == snapshot; }
    }
    private static final class App extends Application {
        final File root;
        final UserManager manager = new UserManager();
        final ApplicationInfo info = new ApplicationInfo();
        App(Path root) { this.root = root.toFile(); info.uid = 10123; }
        public Context getApplicationContext() { return this; }
        public boolean isDeviceProtectedStorage() { return false; }
        public File getNoBackupFilesDir() { return root; }
        public ApplicationInfo getApplicationInfo() { return info; }
        public Object getSystemService(String name) { return manager; }
    }
    private static final class Await implements MessagePreviewPristineInitializer.ProvisionCompletion {
        final CountDownLatch done = new CountDownLatch(1);
        volatile MessagePreviewPristineInitializer.ProvisionResult result;
        public void complete(MessagePreviewPristineInitializer.ProvisionResult r) { result = r; done.countDown(); }
        MessagePreviewPristineInitializer.ProvisionResult get() throws Exception {
            check(done.await(4, TimeUnit.SECONDS), "FINITE_OWNER_COMPLETION"); return result;
        }
    }
    private static final class Erase implements MessagePreviewPristineInitializer.TransitionCompletion {
        final CountDownLatch done = new CountDownLatch(1);
        volatile MessagePreviewPristineInitializer.TransitionResult result;
        public void complete(MessagePreviewPristineInitializer.TransitionResult r) { result = r; done.countDown(); }
        MessagePreviewPristineInitializer.TransitionResult get() throws Exception {
            check(done.await(4, TimeUnit.SECONDS), "FINITE_OWNER_ERASURE"); return result;
        }
    }
    private static final class Graph implements AutoCloseable {
        final Fixture f = new Fixture(true);
        final Passive passive = new Passive();
        final App app;
        final MessagePreviewVaultFence.Context context;
        final MessagePreviewVaultFence.Owner tuple;
        final MessagePreviewVaultProvisioning.Identity submitted;
        final MessagePreviewVerificationProducer producer;
        final MessagePreviewPristineInitializer owner;
        final String installation;
        Graph(Path path, boolean unbound) throws Exception { this(path, unbound, false); }
        Graph(Path path, boolean unbound, boolean conditional) throws Exception {
            this(path, unbound, conditional, null);
        }
        Graph(Path path, boolean unbound, boolean conditional, Long originalNativeDeadline) throws Exception {
            Looper.getMainLooper(); MessagePreviewProducerPlatform.install(); app = new App(path);
            context = new MessagePreviewVaultFence.Context(1, f.begin(), USER, SESSION, 7);
            tuple = new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 7);
            submitted = new MessagePreviewVaultProvisioning.Identity(A, 0, 0, context, tuple);
            producer = new MessagePreviewVerificationProducer(f.runtime, passive, PUBLIC_KEY);
            if (!unbound && !conditional) {
                if (originalNativeDeadline == null) producer.arm(submitted);
                else armOriginalNativeDeadline(producer, submitted, originalNativeDeadline);
            }
            MessagePreviewVaultProvisioning.Authority authority = unbound ? null : producer;
            if (conditional) authority = new MessagePreviewVaultProvisioning.Authority() {
                @Override public void requireCurrent(MessagePreviewVaultProvisioning.Identity identity) { }
                @Override public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,
                        String input, long deadline) {
                    return new MessagePreviewVaultProvisioning.Verification(identity, input,
                        ((Number) f.claims.get("exp")).longValue() * 1000);
                }
            };
            owner = MessagePreviewPristineInitializer.getOrCreate(app, passive, authority);
            CountDownLatch done = new CountDownLatch(1);
            MessagePreviewPristineInitializer.InitResult[] init = new MessagePreviewPristineInitializer.InitResult[1];
            owner.initializeExplicit(r -> { init[0] = r; done.countDown(); });
            check(done.await(4, TimeUnit.SECONDS), "FINITE_G0");
            check(init[0].status == MessagePreviewPristineInitializer.Status.INITIALIZED_EMPTY_G0, "ACTUAL_INITIALIZED_G0");
            installation = MessagePreviewInstallationMarker.decode(Files.readAllBytes(path.resolve("native-message-previews-v1/installation-v1.bin")));
        }
        Path journal() { return app.root.toPath().resolve("native-message-previews-v1/journal-v1.bin"); }
        MessagePreviewMetadataEnvelope.Record record() throws Exception {
            return MessagePreviewMetadataEnvelope.open(Files.readAllBytes(journal()), installation,
                MessagePreviewProducerPlatform.keys.get("letscube.nmpv.metadata.v1." + installation));
        }
        MessagePreviewPristineInitializer.ProvisionResult pending() throws Exception {
            Await result = new Await(); owner.beginOwned(A, 0, 0, context, tuple, result);
            check(result.get().status == MessagePreviewPristineInitializer.ProvisionStatus.PENDING
                && result.result.generation == 1 && result.result.ticket != null, "ACTUAL_CHECKED_PENDING_G1");
            return result.result;
        }
        Await provision(String ticket) {
            Await result = new Await(); owner.provisionExact(A, ticket, ACCESS, result); return result;
        }
        Erase erase() {
            Erase result = new Erase(); owner.retireExact(B, 1, 1, null, result); return result;
        }
        void committed(MessagePreviewPristineInitializer.ProvisionResult result) throws Exception {
            check(result.status == MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED
                && result.generation == 1 && result.ticket == null, "ACTUAL_GENUINE_NONEMPTY_G1");
            MessagePreviewMetadataEnvelope.Record r = record();
            check(r.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED && r.header.generation == 1
                && r.header.baseGeneration == 0 && r.header.operationId.equals(A) && r.header.vaultRevision == 0
                && r.header.expiresWallMillis == ((Number) f.claims.get("exp")).longValue() * 1000
                && r.credentialBytes().length >= 28 && MessagePreviewProducerPlatform.credentials() == 1,
                "EXACT_AUTHENTICATED_COMMIT_NOT_FAKE_EXPIRY");
            check(MessagePreviewCredentialEnvelope.verifyMatch(r, r.header, tuple, ACCESS, r.header.expiresWallMillis,
                MessagePreviewProducerPlatform.keys.get(r.header.alias)), "ACTUAL_D1_NONEMPTY_READBACK");
            check(!new String(Files.readAllBytes(journal()), java.nio.charset.StandardCharsets.ISO_8859_1).contains(ACCESS),
                "NO_PLAINTEXT_JOURNAL");
        }
        @Override public void close() { owner.close(); producer.close(); f.runtime.close(); SystemClock.onRead = null; }
    }
    private static void healthy(Path path) throws Exception {
        try (Graph g = new Graph(path, false)) {
            String ticket = g.pending().ticket;
            g.committed(g.provision(ticket).get()); g.f.chain(8100);
            check(g.provision(ticket).get().status == MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST,
                "OWNER_TICKET_ONE_USE");
            Await observed = new Await(); g.owner.observeOwned(A, observed);
            check(observed.get().status == MessagePreviewPristineInitializer.ProvisionStatus.DORMANT
                && observed.result.ticket == null && g.f.calls.size() == 4, "COLD_STATUS_NOT_PRODUCER_AUTHORITY");
            check(g.erase().get().status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED
                && g.record().header.kind == MessagePreviewMetadataEnvelope.Kind.EMPTY
                && g.record().header.generation == 2 && MessagePreviewProducerPlatform.credentials() == 0,
                "ACTUAL_GENUINE_ERASURE_G2");
        }
    }
    private static void refusal(Path path, String kind) throws Exception {
        try (Graph g = new Graph(path, kind.equals("unbound"))) {
            if (kind.equals("unbound")) {
                Await pending = new Await(); g.owner.beginOwned(A, 0, 0, g.context, g.tuple, pending);
                check(pending.get().status == MessagePreviewPristineInitializer.ProvisionStatus.UNAVAILABLE
                    && g.f.calls.isEmpty() && g.record().header.generation == 0, "DEFAULT_UNBOUND_UNCHANGED"); return;
            }
            if (kind.equals("unguarded")) {
                try { g.producer.verify(g.submitted, ACCESS, 8100); throw new AssertionError("UNGUARDED_ENTRY_REFUSED"); }
                catch (MessagePreviewVerificationProducer.Unavailable expected) { check(expected.getCause() == null, "FIXED_REFUSAL"); }
                check(g.f.calls.isEmpty(), "UNGUARDED_NO_IO");
                g.committed(g.provision(g.pending().ticket).get()); return;
            }
            String ticket = g.pending().ticket;
            if (kind.equals("wrong-device")) g.f.resolver = Arrays.asList(object("binding_v", 1,
                "recipient_id", USER, "session_id", SESSION, "device_id", "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"));
            else if (kind.equals("multirow")) {
                Map<String, Object> row = object("binding_v", 1, "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE);
                g.f.resolver = Arrays.asList(row, row);
            } else if (kind.equals("extra-key")) g.f.resolver = Arrays.asList(object("binding_v", 1,
                "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE, "extra", false));
            else if (kind.equals("sdk-change")) g.f.secondSdk = "fictional-rotated-token";
            else if (kind.equals("unsafe-expiry")) g.f.claims.put("exp", 9_007_199_254_741L);
            else if (kind.equals("8s")) g.f.afterAuth = () -> SystemClock.value = 8100;
            else if (kind.equals("lifecycle")) g.f.afterAuth = () -> g.passive.live = false;
            else if (kind.equals("expiry-before-create")) {
                g.f.claims.put("exp", System.currentTimeMillis() / 1000 + 1);
                g.f.afterSecond = () -> SystemClock.value = 2100;
            } else throw new AssertionError("UNKNOWN_REFUSAL");
            check(g.provision(ticket).get().status == MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE
                && MessagePreviewProducerPlatform.credentials() == 0, "GENUINE_REFUSAL_NO_KEY_OR_ACK");
            if (kind.equals("8s") || kind.equals("lifecycle")) check(g.f.calls.size() == 1, "NO_IO_AFTER_CURRENT_LOSS");
            if (kind.equals("unsafe-expiry")) check(g.f.calls.isEmpty(), "UNSAFE_EXPIRY_NO_DISPATCH");
            check(g.provision(ticket).get().status == MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST,
                "FAILED_OWNER_TICKET_SPENT");
        }
    }
    private static void task5Deadline(Path path) throws Exception {
        try (Graph g = new Graph(path, false)) {
            SystemClock.value = 12_000;
            String ticket = g.pending().ticket;
            g.committed(g.provision(ticket).get()); g.f.chain(15_100);
        }
    }
    // Existing three-argument conditional supplier, NOT a genuine Task5 authority.
    private static void conditionalUnset(Path path) throws Exception {
        try (Graph g = new Graph(path, false, true)) {
            g.committed(g.provision(g.pending().ticket).get());
            check(g.f.calls.isEmpty(), "CONDITIONAL_DEFAULT_UNSET_NOT_TASK5");
        }
    }
    private static void held(Path path, String boundary) throws Exception {
        try (Graph g = new Graph(path, false)) {
            String ticket = g.pending().ticket;
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            Runnable hold = () -> { entered.countDown(); try { check(release.await(3, TimeUnit.SECONDS), "FINITE_EXTERNAL_HOLD"); }
                catch (InterruptedException error) { throw new AssertionError("EXTERNAL_HOLD_INTERRUPTED"); } };
            if (boundary.equals("auth")) g.f.afterAuth = hold;
            else if (boundary.equals("resolver")) g.f.afterResolver = hold;
            else g.f.afterSecond = hold;
            Await pending = g.provision(ticket);
            try {
                check(entered.await(3, TimeUnit.SECONDS), "ACTUAL_VERIFIER_BOUNDARY_HELD");
                Erase erased = g.erase();
                Await busy = new Await(); g.owner.observeOwned(A, busy);
                check(busy.get().status == MessagePreviewPristineInitializer.ProvisionStatus.BUSY && erased.result == null,
                    "HELD_SLOT_NOT_RELEASED");
                release.countDown();
                check(pending.get().status == MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE,
                    "NO_RETIRED_ACQUISITION_ACK");
                check(g.f.calls.size() == (boundary.equals("auth") ? 1 : boundary.equals("resolver") ? 3 : 4),
                    "NO_IO_AFTER_VAULT_RETIREMENT");
                check(erased.get().status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED
                    && g.record().header.generation == 2 && MessagePreviewProducerPlatform.credentials() == 0,
                    "ORDERED_EXACT_ERASURE_AFTER_VERIFIER_SETTLEMENT");
            } finally { release.countDown(); }
        }
    }
    private static void nativeDeadlineHeldAuth(Path path) throws Exception {
        SystemClock.value = 10_000;
        try (Graph g = new Graph(path, false, false, 11_000L)) {
            String ticket = g.pending().ticket;
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            g.f.afterAuth = () -> {
                entered.countDown();
                try { check(release.await(3, TimeUnit.SECONDS), "NATIVE_D_FINITE_AUTH_HOLD"); }
                catch (InterruptedException failure) { throw new AssertionError("NATIVE_D_AUTH_HOLD_INTERRUPTED"); }
            };
            Await result = g.provision(ticket);
            try {
                check(entered.await(3, TimeUnit.SECONDS), "NATIVE_D_ACTUAL_AUTH_HELD");
                check(g.f.deadlines.equals(Arrays.asList(11_000L)), "NATIVE_D_HELD_AUTH_LITERAL_11000");
                SystemClock.value = 11_000; release.countDown();
                check(result.get().status == MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE
                    && g.f.calls.equals(Arrays.asList("AuthGET")) && MessagePreviewProducerPlatform.credentials() == 0,
                    "NATIVE_D_AUTH_AT_11000_NO_FURTHER_IO_OR_KEY");
            } finally { release.countDown(); }
        }
    }
    private static void contextSuccessor(Path path, boolean before) throws Exception {
        String nextOperation = "cccccccccccccccccccccccccccccccc";
        try (Graph g = new Graph(path, false)) {
            String ticket = g.pending().ticket;
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            g.f.afterAuth = () -> { entered.countDown(); try { check(release.await(3, TimeUnit.SECONDS), "FINITE_CONTEXT_HOLD"); }
                catch (InterruptedException error) { throw new AssertionError("CONTEXT_HOLD_INTERRUPTED"); } };
            Await acquisition = g.provision(ticket);
            try {
                check(entered.await(3, TimeUnit.SECONDS), "ACTUAL_CONTEXT_A_HELD");
                Erase erased = g.erase();
                String nextSession = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
                MessagePreviewVaultProvisioning.Identity next = null;
                if (before) {
                    String epoch = g.f.runtime.beginBinding(2, USER, nextSession, 8);
                    check(epoch != null, "GENUINE_LIFECYCLE_B_CONTEXT");
                    MessagePreviewVaultFence.Context context = new MessagePreviewVaultFence.Context(2, epoch, USER, nextSession, 8);
                    next = new MessagePreviewVaultProvisioning.Identity(nextOperation, 2, 2, context,
                        new MessagePreviewVaultFence.Owner(USER, nextSession, DEVICE, 8));
                    g.producer.arm(next);
                }
                release.countDown();
                check(acquisition.get().status == MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE,
                    "STALE_A_CONTEXT_NO_ACK");
                check(erased.get().status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED,
                    "CONTEXT_A_CLEANUP_SETTLED");
                if (!before) {
                    String epoch = g.f.runtime.beginBinding(2, USER, nextSession, 8);
                    MessagePreviewVaultFence.Context context = new MessagePreviewVaultFence.Context(2, epoch, USER, nextSession, 8);
                    next = new MessagePreviewVaultProvisioning.Identity(nextOperation, 2, 2, context,
                        new MessagePreviewVaultFence.Owner(USER, nextSession, DEVICE, 8));
                    g.producer.arm(next);
                }
                try { g.producer.requireCurrent(next); }
                catch (Exception refused) { throw new AssertionError("OLD_CATCH_CANNOT_RETIRE_B"); }
                g.f.afterAuth = () -> {};
                g.f.calls.clear(); g.f.deadlines.clear(); g.f.sdkReads = 0;
                g.f.session = nextSession; g.f.claims.put("session_id", nextSession);
                Await pending = new Await(); g.owner.beginOwned(nextOperation, 2, 2, next.context, next.owner, pending);
                check(pending.get().status == MessagePreviewPristineInitializer.ProvisionStatus.PENDING
                    && pending.result.generation == 3, "B_ADMISSION_AFTER_REAL_SETTLEMENT");
                Await committed = new Await(); g.owner.provisionExact(nextOperation, pending.result.ticket, ACCESS, committed);
                check(committed.get().status == MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED
                    && committed.result.generation == 3 && g.record().header.operationId.equals(nextOperation),
                    "OLD_CATCH_CANNOT_REFUSE_CURRENT_B");
                g.f.chain(8100);
            } finally { release.countDown(); }
        }
    }
    private static boolean frame(String name) {
        for (StackTraceElement f : Thread.currentThread().getStackTrace()) if (f.getClassName().equals(
                "com.kub.messenger.MessagePreviewPristineInitializer") && f.getMethodName().equals(name)) return true;
        return false;
    }
    private static boolean provisioningFrame() {
        for (StackTraceElement f : Thread.currentThread().getStackTrace())
            if (f.getClassName().equals("com.kub.messenger.MessagePreviewVaultProvisioning")) return true;
        return false;
    }
    private static void finalPublication(Path path, boolean before, String retirement) throws Exception {
        finalPublication(path, before, retirement, false);
    }
    private static void finalPublication(Path path, boolean before, String retirement, boolean nativeDeadline) throws Exception {
        if (nativeDeadline) SystemClock.value = 10_000;
        try (Graph g = new Graph(path, false, false, nativeDeadline ? 11_000L : null)) {
            String ticket = g.pending().ticket;
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            boolean[] once = {false};
            SystemClock.onRead = () -> {
                if (!once[0] && frame("performAcquiring") && !frame("acquiringCurrent") && !provisioningFrame()) {
                    try {
                        if (g.record().header.kind != MessagePreviewMetadataEnvelope.Kind.COMMITTED) return;
                        once[0] = true;
                        check(!Thread.holdsLock(g.owner), "FINAL_CLOCK_OUTSIDE_PUBLICATION_MONITOR");
                        entered.countDown(); check(release.await(3, TimeUnit.SECONDS), "FINITE_FINAL_PUBLICATION_HOLD");
                    } catch (Exception failure) { throw new AssertionError("FINAL_HOLD_FIXTURE"); }
                }
            };
            Await pending = g.provision(ticket);
            try {
                check(entered.await(3, TimeUnit.SECONDS), "ACTUAL_POST_CURRENT_PREPUBLICATION_HOLD");
                if (nativeDeadline) check(g.f.deadlines.equals(Arrays.asList(11_000L, 11_000L, 11_000L, 11_000L)),
                    "NATIVE_D_FINAL_PERMIT_LITERAL_11000");
                if (retirement.equals("clear")) check(g.f.runtime.clearBinding(2), "ACTUAL_FINAL_CONTEXT_CLEAR");
                else if (retirement.equals("rotate")) check(g.f.runtime.beginBinding(2, USER,
                    "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", 8) != null, "ACTUAL_FINAL_CONTEXT_REPLACEMENT");
                else if (retirement.equals("context")) g.f.runtime.cancelBinding(1, g.context.epoch, USER, SESSION, 7, DEVICE);
                else if (retirement.equals("close")) g.f.runtime.close();
                else if (retirement.equals("producer-close")) g.producer.close();
                else if (retirement.equals("retire")) g.f.runtime.retire();
                else if (retirement.equals("invalid-begin")) check(g.f.runtime.beginBinding(2, "invalid", SESSION, 7) == null,
                    "ACTUAL_NEW_INVALID_BEGIN_REFUSAL");
                else if (retirement.equals("regression")) {
                    SystemClock.value = 99;
                    check(!g.f.runtime.hasVerifiedBinding(USER), "ACTUAL_CLOCK_REGRESSION_RETIRES_CONTEXT");
                } else if (retirement.equals("expiry")) {
                    g.f.clock.wallOffset = 61_000;
                    check(!g.f.runtime.hasVerifiedBinding(USER), "ACTUAL_VERIFIED_EXPIRY_RETIRES_CONTEXT");
                } else if (retirement.equals("failure")) {
                    java.lang.reflect.Field field = MessagePreviewVerificationState.class.getDeclaredField("current");
                    field.setAccessible(true);
                    MessagePreviewVerificationState.Ticket exact = (MessagePreviewVerificationState.Ticket) field.get(g.f.state);
                    check(exact != null, "ACTUAL_FINISHED_TICKET_BEFORE_FAILURE");
                    g.f.state.fail(exact);
                }
                else if (retirement.equals("stale-clear")) check(!g.f.runtime.clearBinding(1), "ACTUAL_STALE_CLEAR_REFUSAL");
                else if (retirement.equals("stale-context")) g.f.runtime.cancelBinding(1, g.context.epoch, USER,
                    "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", 7, DEVICE);
                boolean contextLoss = !retirement.equals("none") && !retirement.startsWith("stale-");
                SystemClock.value = nativeDeadline ? before ? 10_999 : 11_000
                    : retirement.equals("none") ? before ? 8099 : 8100 : 100;
                release.countDown();
                MessagePreviewPristineInitializer.ProvisionResult result = pending.get();
                if (contextLoss) check(result.status == MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE,
                    "FINAL_RETIRED_PRODUCER_CONTEXT");
                else if (before) g.committed(result);
                else check(result.status == MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE,
                    nativeDeadline ? "FINAL_ORIGINAL_NATIVE_D_11000" : "FINAL_ORIGINAL_PRODUCER_DEADLINE");
                check(g.record().header.expiresWallMillis == ((Number) g.f.claims.get("exp")).longValue() * 1000,
                    "FINAL_DEADLINE_NOT_SHORTENED_JWT");
            } finally { release.countDown(); SystemClock.onRead = null; }
        }
    }
    private static void admission(String field) throws Exception {
        Fixture f = new Fixture(); Passive passive = new Passive(); String epoch = f.begin();
        MessagePreviewVaultFence.Context context = new MessagePreviewVaultFence.Context(1, epoch, USER, SESSION, 7);
        MessagePreviewVaultFence.Owner tuple = new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 7);
        if (field.equals("epoch")) context = new MessagePreviewVaultFence.Context(1, "11111111-1111-4111-8111-111111111111", USER, SESSION, 7);
        if (field.equals("account")) {
            context = new MessagePreviewVaultFence.Context(1, epoch, USER, SESSION, 8);
            tuple = new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 8);
        }
        if (field.equals("session")) {
            context = new MessagePreviewVaultFence.Context(1, epoch, USER, "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", 7);
            tuple = new MessagePreviewVaultFence.Owner(USER, context.session, DEVICE, 7);
        }
        if (field.equals("owner")) {
            context = new MessagePreviewVaultFence.Context(1, epoch, "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", SESSION, 7);
            tuple = new MessagePreviewVaultFence.Owner(context.recipient, SESSION, DEVICE, 7);
        }
        if (field.equals("cached")) check(f.verify(epoch), "CACHED_SUCCESS_BASELINE");
        MessagePreviewVerificationProducer producer = new MessagePreviewVerificationProducer(f.runtime, passive, PUBLIC_KEY);
        try {
            producer.arm(new MessagePreviewVaultProvisioning.Identity(A, 0, 0, context, tuple));
            throw new AssertionError("EXACT_TASK5_ADMISSION_REFUSAL_" + field);
        } catch (MessagePreviewVerificationProducer.Unavailable expected) { check(expected.getCause() == null, "FIXED_ADMISSION_REFUSAL"); }
        if (!field.equals("cached")) check(f.calls.isEmpty(), "REFUSED_ADMISSION_NO_IO");
        else check(f.runtime.matchesVerified(1, epoch, USER, SESSION, 7, DEVICE), "CACHED_ORDINARY_STATE_PRESERVED");
        producer.close(); f.runtime.close();
    }
    private static void resultContract(String kind) throws Exception {
        Fixture f = new Fixture(); Passive passive = new Passive(); String epoch = f.begin();
        MessagePreviewVaultFence.Context c = new MessagePreviewVaultFence.Context(1, epoch, USER, SESSION, 7);
        MessagePreviewVaultFence.Owner tuple = new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 7);
        MessagePreviewVaultProvisioning.Identity identity = new MessagePreviewVaultProvisioning.Identity(A, 0, 0, c, tuple);
        MessagePreviewVerificationProducer producer = new MessagePreviewVerificationProducer(f.runtime, passive, PUBLIC_KEY);
        producer.arm(identity);
        MessagePreviewVaultProvisioning.Current current = () -> {
            check(!Thread.holdsLock(f.runtime) && !Thread.holdsLock(f.state), "OWNER_CURRENT_OUTSIDE_MONITORS");
            producer.requireCurrent(identity);
        };
        long deadline = kind.equals("short-deadline") ? 11_000 : 18_000;
        MessagePreviewVaultProvisioning.Verification result = producer.verify(identity, ACCESS, deadline, current);
        check(result != null, "DIRECT_RESULT_HEALTHY_CONTROL"); f.chain(deadline);
        if (kind.equals("short-deadline")) { producer.close(); f.runtime.close(); return; }
        if (kind.equals("identity")) {
            try {
                producer.requireCurrent(new MessagePreviewVaultProvisioning.Identity(A, 0, 0, c, tuple));
                throw new AssertionError("CURRENT_EXACT_INVOCATION");
            } catch (MessagePreviewVerificationProducer.Unavailable expected) { }
        }
        Method consume = result.getClass().getDeclaredMethod("consume", MessagePreviewVaultProvisioning.Identity.class, String.class);
        consume.setAccessible(true);
        MessagePreviewVaultProvisioning.Identity expected = kind.equals("identity")
            ? new MessagePreviewVaultProvisioning.Identity(A, 0, 0, c, tuple) : identity;
        String input = kind.equals("input") ? "fictional-substituted-access" : ACCESS;
        if (kind.equals("one-use")) check(((Long) consume.invoke(result, identity, ACCESS)) == 1_800_000_300_000L, "EXACT_VALIDATED_EXPIRY");
        try { consume.invoke(result, expected, input); throw new AssertionError("RESULT_EXACT_" + kind); }
        catch (InvocationTargetException refused) {
            check(refused.getCause() instanceof MessagePreviewVaultProvisioning.Unavailable, "FIXED_RESULT_REFUSAL");
        }
        producer.close(); f.runtime.close();
    }
    private static void ordinaryPlugin() throws Exception {
        Fixture f = new Fixture(); MessagePreviewsPlugin plugin = new MessagePreviewsPlugin(); plugin.load();
        try {
            java.lang.reflect.Field runtime = MessagePreviewsPlugin.class.getDeclaredField("runtime");
            runtime.setAccessible(true); runtime.set(plugin, f.runtime);
            PluginCall capability = new PluginCall(new JSObject()); plugin.getCapabilities(capability);
            check(capability.result.length() == 1 && Integer.valueOf(0).equals(capability.result.opt("protocol")),
                "ORDINARY_PROTOCOL_ZERO_LITERAL");
            PluginCall begin = new PluginCall(new JSObject().put("revision", 1).put("recipientId", USER)
                .put("recipientSessionId", SESSION).put("accountEpoch", 7));
            plugin.beginBinding(begin);
            check(begin.result.length() == 1 && begin.result.opt("epoch") instanceof String, "ORDINARY_BEGIN_SHAPE");
            PluginCall verify = new PluginCall(new JSObject().put("revision", 1).put("epoch", begin.result.opt("epoch"))
                .put("recipientId", USER).put("recipientSessionId", SESSION).put("accountEpoch", 7).put("deviceId", DEVICE)
                .put("accessToken", ACCESS).put("publicApiKey", PUBLIC_KEY));
            plugin.verifyBinding(verify);
            check(verify.done.await(2, TimeUnit.SECONDS) && verify.result.length() == 1
                && Boolean.TRUE.equals(verify.result.opt("verified")), "ORDINARY_VERIFY_SHAPE_AND_SUCCESS");
            check(!verify.getData().has("accessToken") && !verify.getData().has("publicApiKey"), "ORDINARY_RETAINED_DATA_PRIVACY");
            f.chain(18_000);
            PluginCall clear = new PluginCall(new JSObject().put("revision", 2)); plugin.clearBinding(clear);
            check(clear.result.length() == 1 && Boolean.TRUE.equals(clear.result.opt("applied")), "ORDINARY_CLEAR_SHAPE");
            plugin.getCapabilities(capability);
            check(capability.result.length() == 1 && Integer.valueOf(0).equals(capability.result.opt("protocol")),
                "ORDINARY_SUCCESS_NOT_CAPABILITY");
        } finally { plugin.handleOnDestroy(); }
    }
    public static void main(String[] args) {
        check(args.length == 2, "EXACT_SCENARIO_ARGUMENT");
        try {
        switch (args[0]) {
            case "producer-feature": producerFeature(); break;
            case "guarded-feature": guardedFeature(); break;
            case "native-deadline-feature": originalNativeDeadlineFeature(); break;
            case "native-deadline-held-auth": nativeDeadlineHeldAuth(new File(args[1]).toPath()); break;
            case "native-deadline-final-before": finalPublication(new File(args[1]).toPath(), true, "none", true); break;
            case "native-deadline-final-at": finalPublication(new File(args[1]).toPath(), false, "none", true); break;
            case "old-ticket": oldTicket(); break;
            case "original-deadline": originalDeadline(); break;
            case "healthy": healthy(new File(args[1]).toPath()); break;
            case "task5-deadline": task5Deadline(new File(args[1]).toPath()); break;
            case "conditional-unset": conditionalUnset(new File(args[1]).toPath()); break;
            case "final-before": finalPublication(new File(args[1]).toPath(), true, "none"); break;
            case "final-at": finalPublication(new File(args[1]).toPath(), false, "none"); break;
            case "final-context-loss": finalPublication(new File(args[1]).toPath(), true, "clear"); break;
            case "context-before": contextSuccessor(new File(args[1]).toPath(), true); break;
            case "context-after": contextSuccessor(new File(args[1]).toPath(), false); break;
            case "ordinary-plugin": ordinaryPlugin(); break;
            default:
                if (args[0].startsWith("native-deadline-")) nativeDeadlineDirect(args[0].substring(16));
                else if (args[0].startsWith("final-")) finalPublication(new File(args[1]).toPath(), true, args[0].substring(6));
                else if (args[0].startsWith("refuse-")) refusal(new File(args[1]).toPath(), args[0].substring(7));
                else if (args[0].startsWith("held-")) held(new File(args[1]).toPath(), args[0].substring(5));
                else if (args[0].startsWith("admit-")) admission(args[0].substring(6));
                else if (args[0].startsWith("result-")) resultContract(args[0].substring(7));
                else throw new AssertionError("UNKNOWN_SCENARIO");
        }
        System.out.println("PASS " + args[0]);
        } catch (Exception failure) { throw new AssertionError("FINITE_CASE_EXCEPTION", failure); }
    }
}
