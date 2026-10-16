package com.kub.messenger;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.system.Os;
import android.util.AtomicFile;
import java.io.File;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.nio.ByteBuffer;
import java.security.*;
import java.security.spec.AlgorithmParameterSpec;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;

// Actual composed classes/JCA/owned files; reused fictional provider and labeled Android doubles.
// Reflection observes private state/faults only in this child-JVM fixture, never production hooks.
public final class MessagePreviewVaultTransitionsProbe {
    private static final String A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final CountDownLatch held = new CountDownLatch(1), release = new CountDownLatch(1);
    private static String scenario;
    private static MessagePreviewPristineInitializer owner;
    private static OwnedContext context;
    private static Authority authority;
    private static boolean transitioning;
    private static boolean faultUsed;
    private static int flushes;
    private static int authentications;
    private static int finalClockReads, initFinalReads;
    private static final List<String> trace = Collections.synchronizedList(new ArrayList<String>());

    private static final class OwnedContext extends Context {
        final File root; final UserManager manager = new UserManager();
        final ApplicationInfo info = new ApplicationInfo();
        OwnedContext(File root) { this.root = root; }
        public Context getApplicationContext() { return this; }
        public boolean isDeviceProtectedStorage() { return false; }
        public File getNoBackupFilesDir() { return root; }
        public Object getSystemService(String name) { return manager; }
        public <T> T getSystemService(Class<T> type) {
            if (!transitioning && scenario.equals("held-init-final") && AtomicFile.reads == 2 && ++initFinalReads == 2) hold();
            if (transitioning && (scenario.equals("held-context")
                || scenario.equals("held-final-context") && AtomicFile.reads >= 4)) hold();
            return type.cast(manager);
        }
        public ApplicationInfo getApplicationInfo() { return info; }
    }
    private static final class Authority implements MessagePreviewInitializationGate.ForegroundAuthority {
        volatile Object current = new Object();
        public Object capture() { return current; }
        public boolean isCurrent(Object snapshot) { return current != null && snapshot == current; }
    }
    public static final class HeldAuthProvider extends Provider {
        private static final long serialVersionUID = 1L;
        HeldAuthProvider() {
            super("FictionalHeldAuth", "1.0", "Fixture interception; SunJCE performs actual AES-GCM");
            put("Cipher.AES/GCM/NoPadding", HeldAuthCipher.class.getName());
        }
    }
    public static final class HeldAuthCipher extends CipherSpi {
        private final Cipher delegate;
        private int mode;
        public HeldAuthCipher() {
            try { delegate = Cipher.getInstance("AES/GCM/NoPadding", "SunJCE"); }
            catch (GeneralSecurityException failure) { throw new IllegalStateException("FIXTURE_CIPHER"); }
        }
        protected void engineSetMode(String mode) { require(mode.equals("GCM"), "FIXTURE_GCM"); }
        protected void engineSetPadding(String padding) { require(padding.equals("NoPadding"), "FIXTURE_PADDING"); }
        protected int engineGetBlockSize() { return delegate.getBlockSize(); }
        protected int engineGetOutputSize(int size) { return delegate.getOutputSize(size); }
        protected byte[] engineGetIV() { return delegate.getIV(); }
        protected AlgorithmParameters engineGetParameters() { return delegate.getParameters(); }
        protected void engineInit(int mode, Key key, SecureRandom random) throws InvalidKeyException {
            this.mode=mode; delegate.init(mode,key,random);
        }
        protected void engineInit(int mode, Key key, AlgorithmParameterSpec spec, SecureRandom random)
                throws InvalidKeyException, InvalidAlgorithmParameterException {
            this.mode=mode; delegate.init(mode,key,spec,random);
        }
        protected void engineInit(int mode, Key key, AlgorithmParameters spec, SecureRandom random)
                throws InvalidKeyException, InvalidAlgorithmParameterException {
            this.mode=mode; delegate.init(mode,key,spec,random);
        }
        protected void engineUpdateAAD(byte[] bytes, int offset, int size) { delegate.updateAAD(bytes,offset,size); }
        protected void engineUpdateAAD(ByteBuffer bytes) { delegate.updateAAD(bytes); }
        protected byte[] engineUpdate(byte[] bytes, int offset, int size) { return delegate.update(bytes,offset,size); }
        protected int engineUpdate(byte[] bytes, int offset, int size, byte[] output, int at) throws ShortBufferException {
            return delegate.update(bytes,offset,size,output,at);
        }
        private void authentication() {
            if (transitioning && mode == Cipher.DECRYPT_MODE && ++authentications == 2 && scenario.equals("held-kernel-auth")) hold();
        }
        protected byte[] engineDoFinal(byte[] bytes, int offset, int size) throws IllegalBlockSizeException, BadPaddingException {
            authentication(); return delegate.doFinal(bytes,offset,size);
        }
        protected int engineDoFinal(byte[] bytes, int offset, int size, byte[] output, int at)
                throws ShortBufferException, IllegalBlockSizeException, BadPaddingException {
            authentication(); return delegate.doFinal(bytes,offset,size,output,at);
        }
    }
    private static void require(boolean condition, String oracle) {
        if (!condition) throw new AssertionError(oracle);
    }
    private static Object field(Object value, String name) throws Exception {
        Field f = value.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(value);
    }
    private static void set(Object value, String name, Object next) throws Exception {
        Field f = value.getClass().getDeclaredField(name); f.setAccessible(true); f.set(value, next);
    }
    private static Field oldField(String name) throws Exception {
        Field f = MessagePreviewPristineInitializerProbe.class.getDeclaredField(name); f.setAccessible(true); return f;
    }
    @SuppressWarnings("unchecked") private static Map<String,SecretKey> keys() throws Exception {
        return (Map<String,SecretKey>) oldField("keys").get(null);
    }
    private static File journal() { return new File(context.root, "native-message-previews-v1/journal-v1.bin"); }
    private static String installation() throws Exception {
        return MessagePreviewInstallationMarker.decode(Files.readAllBytes(
            new File(context.root, "native-message-previews-v1/installation-v1.bin").toPath()));
    }
    private static SecretKey key() throws Exception { return keys().get("letscube.nmpv.metadata.v1." + installation()); }
    private static MessagePreviewMetadataEnvelope.Record record() throws Exception {
        return MessagePreviewMetadataEnvelope.open(Files.readAllBytes(journal().toPath()), installation(), key());
    }
    private static void checkRecord(long generation, long base, String operation, long revision, String kind) throws Exception {
        MessagePreviewMetadataEnvelope.Record r = record(); MessagePreviewMetadataEnvelope.Header h = r.header;
        require(h.generation == generation && h.baseGeneration == base && h.operationId.equals(operation)
            && h.vaultRevision == revision && h.kind.name().equals(kind) && h.alias.isEmpty()
            && h.expiresWallMillis == 0 && r.credentialBytes().length == 0, "EXACT_EMPTY_TRANSITION_RECORD");
    }
    private static void initialize() throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final MessagePreviewPristineInitializer.InitResult[] result = new MessagePreviewPristineInitializer.InitResult[1];
        owner.initializeExplicit(new MessagePreviewPristineInitializer.Completion() {
            public void complete(MessagePreviewPristineInitializer.InitResult next) { result[0] = next; done.countDown(); }
        });
        require(done.await(5, TimeUnit.SECONDS), "FINITE_INITIALIZATION");
        require(result[0].status == MessagePreviewPristineInitializer.Status.INITIALIZED_EMPTY_G0
            && Long.valueOf(0).equals(result[0].generation), "ACTUAL_INITIALIZED_G0");
        checkRecord(0, 0, "", 0, "EMPTY");
        AtomicFile.reads = AtomicFile.starts = AtomicFile.finishes = AtomicFile.fails = 0;
        transitioning = true;
    }
    private static Method api(String name) {
        for (Method m : MessagePreviewPristineInitializer.class.getDeclaredMethods()) {
            if (m.getName().equals(name)) { m.setAccessible(true); return m; }
        }
        throw new AssertionError("FEATURE_ABSENCE_RETIREMENT_API");
    }
    private static final class Await implements InvocationHandler {
        final CountDownLatch done = new CountDownLatch(1);
        volatile Object result;
        boolean lose;
        public Object invoke(Object proxy, Method method, Object[] args) {
            if (method.getName().equals("complete")) {
                result = args[0]; done.countDown();
                if (lose) throw new IllegalStateException("FICTIONAL_LOST_CALLBACK");
            }
            return null;
        }
        Object get() throws Exception { require(done.await(5, TimeUnit.SECONDS), "FINITE_TRANSITION"); return result; }
    }
    private static Await call(String method, Object... args) throws Exception {
        Method target = api(method); Class<?> callback = target.getParameterTypes()[target.getParameterCount() - 1];
        Await await = new Await();
        Object[] actual = Arrays.copyOf(args, args.length + 1);
        actual[args.length] = Proxy.newProxyInstance(callback.getClassLoader(), new Class<?>[]{callback}, await);
        target.invoke(owner, actual); return await;
    }
    private static Await retire(String id, long revision, long generation) throws Exception {
        return call("retireExact", id, revision, generation, null);
    }
    private static void status(Object result, String expected, Long generation, String oracle) throws Exception {
        require(field(result, "status").toString().equals(expected) && Objects.equals(field(result, "generation"), generation), oracle);
    }
    private static void hold() {
        if (release.getCount() == 0) return;
        held.countDown();
        try { require(release.await(5, TimeUnit.SECONDS), "FIXTURE_RELEASE"); }
        catch (InterruptedException refused) { throw new AssertionError("FIXTURE_INTERRUPTED"); }
    }
    private static void event(String name) {
        if (!transitioning) return;
        trace.add(name);
        if (scenario.equals("held-finish") && name.equals("journal-finish")
            || scenario.equals("close-held") && name.equals("journal-read")
            || scenario.equals("held-read") && name.equals("journal-read")) hold();
        if (scenario.equals("deadline-return") && name.equals("journal-read")) SystemClock.value = 10_100;
        if (scenario.equals("clock-backward") && name.equals("journal-read")) SystemClock.value = 99;
        if (scenario.equals("locked-return") && name.equals("journal-read")) context.manager.unlocked = false;
        if (scenario.equals("unknown-final") && name.equals("journal-committed") && AtomicFile.finishes == 2)
            throw new IllegalStateException("FICTIONAL_POST_COMMIT_FAILURE");
        if (scenario.equals("readback-failure") && name.equals("journal-read") && AtomicFile.finishes == 2 && !faultUsed) {
            faultUsed = true; throw new IllegalStateException("FICTIONAL_READBACK_FAILURE");
        }
        if (scenario.equals("empty-start-failure") && name.equals("journal-start") && AtomicFile.starts == 2)
            throw new IllegalStateException("FICTIONAL_SECOND_START_FAILURE");
        if (scenario.equals("sync-failure") && name.equals("journal-flush") && ++flushes == 2) {
            try { AtomicFile.last.close(); } catch (Exception refused) { throw new AssertionError("FIXTURE_SYNC_FAULT"); }
        }
    }
    private static void positive() throws Exception {
        status(retire(A, 1, 0).get(), "RETIRED", 1L, "CHECKED_G1_ACK");
        checkRecord(1, 0, A, 1, "EMPTY");
        require(AtomicFile.starts == 2 && AtomicFile.finishes == 2, "TOMBSTONE_THEN_EMPTY_SAME_ALLOCATION");
        status(retire(B, 2, 1).get(), "RETIRED", 2L, "CHECKED_G2_ACK"); checkRecord(2, 1, B, 2, "EMPTY");
        require(keys().size() == 1 && oldField("generates").getInt(null) == 1 && oldField("inits").getInt(null) == 1,
            "NO_KEY_CREATION_OR_DELETE_IN_EMPTY_SLICE");
    }
    private static void refusals() throws Exception {
        byte[] before = Files.readAllBytes(journal().toPath());
        status(retire(A, 99, 1).get(), "STALE_OWNER", null, "STALE_TARGET_NO_RESERVATION");
        status(retire("bad", 1, 0).get(), "INVALID_REQUEST", null, "INVALID_NO_EFFECTS");
        status(retire(A, 1, 0).get(), "RETIRED", 1L, "STALE_REVISION_NOT_CONSUMED");
        int starts = AtomicFile.starts;
        status(retire(A, 2, 1).get(), "INVALID_REQUEST", null, "DUPLICATE_NO_REPLAY");
        require(AtomicFile.starts == starts && !Arrays.equals(before, Files.readAllBytes(journal().toPath())), "ONLY_ACCEPTED_TARGET_WRITES");
    }
    private static List<Object> snapshot() throws Exception {
        Object state = field(owner, "initialized"), fence = field(state, "fence");
        return Arrays.asList(field(fence, "generation"), field(fence, "vaultRevision"), field(fence, "contextRevision"),
            new HashSet<Object>((Set<?>) field(fence, "seenIds")), field(state, "checkedHead"),
            field(state, "current"), field(state, "uncertain"), field(state, "lastMillis"),
            field(owner, "pendingTransition"), field(owner, "activeTransition"), AtomicFile.starts, AtomicFile.reads);
    }
    private static void malformed() throws Exception {
        List<Object> before = snapshot();
        status(retire(A, 1, -1).get(), "INVALID_REQUEST", null, "MALFORMED_SYNTAX_BEFORE_CAS");
        status(retire(A, -1, 0).get(), "INVALID_REQUEST", null, "MALFORMED_SYNTAX_BEFORE_CAS");
        status(retire(null, 1, 0).get(), "INVALID_REQUEST", null, "MALFORMED_SYNTAX_BEFORE_CAS");
        require(before.equals(snapshot()), "MALFORMED_ZERO_EFFECTS");
        status(retire(B, 99, 1).get(), "STALE_OWNER", null, "STALE_ZERO_EFFECTS");
        require(before.equals(snapshot()), "STALE_ZERO_EFFECTS");
    }
    private static void rewrite(MessagePreviewMetadataEnvelope.Header header) throws Exception {
        Files.write(journal().toPath(), MessagePreviewMetadataEnvelope.seal(header, new byte[0], key()));
    }
    private static void predecessorMismatch(boolean corrupt) throws Exception {
        if (corrupt) {
            byte[] bytes = Files.readAllBytes(journal().toPath()); bytes[bytes.length-1] ^= 1;
            Files.write(journal().toPath(), bytes);
        } else {
            MessagePreviewMetadataEnvelope.Header h = record().header;
            rewrite(new MessagePreviewMetadataEnvelope.Header(h.installation, h.generation, h.kind, h.alias,
                h.expiresWallMillis, h.wallHighWaterMillis+1, h.operationId, h.baseGeneration, h.vaultRevision));
        }
        status(retire(A, 1, 0).get(), "INCOMPLETE", null, "FULL_PREDECESSOR_MATCH_BEFORE_EFFECTS");
        require(AtomicFile.starts == 0, "PREDECESSOR_NO_WRITE");
        status(retire(B, 2, 1).get(), "UNAVAILABLE", null, "UNCERTAIN_SOURCE_NO_NEW_GENERATION");
    }
    private static void missingKey() throws Exception {
        keys().clear(); byte[] bytes = Files.readAllBytes(journal().toPath());
        status(retire(A, 1, 0).get(), "INCOMPLETE", null, "KEY_AVAILABILITY_BEFORE_EFFECTS");
        status(retire(B, 2, 1).get(), "UNAVAILABLE", null, "KEY_LOSS_NO_NEW_GENERATION");
        status(call("observeRetirement", A).get(), "INCOMPLETE", null, "KEY_LOSS_NOT_OBSERVED_COMMIT");
        require(AtomicFile.starts == 0 && keys().isEmpty() && oldField("generates").getInt(null) == 1
            && Arrays.equals(bytes, Files.readAllBytes(journal().toPath())), "NO_KEY_RECREATION_OR_RESET");
    }
    private static void failures() throws Exception {
        if (scenario.equals("start-failure")) AtomicFile.startThrows = true;
        if (scenario.equals("write-failure")) AtomicFile.writeThrows = true;
        if (scenario.equals("flush-failure")) AtomicFile.flushThrows = true;
        if (scenario.equals("finish-failure")) AtomicFile.finishThrows = true;
        status(retire(A, 1, 0).get(), "INCOMPLETE", null, "FAILED_IO_NO_DURABLE_ACK");
        int writes = AtomicFile.starts;
        require(writes == (scenario.equals("empty-start-failure") ? 2 : 1), "NO_AUTOMATIC_EXECUTE_REPLAY");
        if (scenario.equals("finish-failure")) require(AtomicFile.fails == 0 && Files.exists(new File(journal()+".new").toPath()), "UNCERTAIN_FINISH_NO_ROLLBACK");
        if (scenario.equals("write-failure") || scenario.equals("flush-failure") || scenario.equals("sync-failure"))
            require(AtomicFile.fails == 1, "ONLY_OWN_PRE_FINISH_ROLLBACK");
        status(call("observeRetirement", A).get(), "INCOMPLETE", null, "OLDER_OR_RETIRING_NOT_COMPLETION");
        require(AtomicFile.starts == writes, "FAILED_OBSERVATION_NO_WRITE");
        if (scenario.equals("empty-start-failure")) checkRecord(1, 0, A, 1, "RETIRING");
    }
    private static void observationMismatch() throws Exception {
        scenario = "unknown-final";
        status(retire(A, 1, 0).get(), "INCOMPLETE", null, "CALIBRATED_UNCERTAIN_FINAL");
        MessagePreviewMetadataEnvelope.Header h = record().header;
        rewrite(new MessagePreviewMetadataEnvelope.Header(h.installation, h.generation, h.kind, "", 0,
            h.wallHighWaterMillis, B, h.baseGeneration, h.vaultRevision));
        int writes = AtomicFile.starts;
        status(call("observeRetirement", A).get(), "INCOMPLETE", null, "OBSERVATION_EXACT_OPERATION_REQUIRED");
        require(AtomicFile.starts == writes, "MISMATCH_NOT_REPLAY");
    }
    private static void exhausted() throws Exception {
        Object state = field(owner, "initialized"), fence = field(state, "fence");
        if (scenario.equals("generation-exhausted")) {
            MessagePreviewMetadataEnvelope.Header h = record().header;
            rewrite(new MessagePreviewMetadataEnvelope.Header(h.installation, 9007199254740991L, h.kind, "", 0,
                h.wallHighWaterMillis, B, 9007199254740990L, 1));
            set(state, "checkedHead", record()); set(fence, "generation", 9007199254740991L);
        } else {
            @SuppressWarnings("unchecked") Set<String> seen = (Set<String>) field(fence, "seenIds");
            for (int i = 0; i < 256; i++) seen.add(String.format("%032x", i));
        }
        List<Object> before = snapshot();
        status(retire(A, 2, scenario.equals("generation-exhausted") ? 9007199254740991L : 0).get(),
            "EXHAUSTED", null, "EXHAUSTION_NO_RESERVATION");
        require(before.equals(snapshot()), "EXHAUSTION_ZERO_EFFECTS");
    }
    private static void lostCallback() throws Exception {
        Method target = api("retireExact"); Class<?> callback = target.getParameterTypes()[4];
        Await await = new Await(); await.lose = true;
        Object proxy = Proxy.newProxyInstance(callback.getClassLoader(), new Class<?>[]{callback}, await);
        target.invoke(owner, A, 1L, 0L, null, proxy);
        status(await.get(), "RETIRED", 1L, "CHECKED_HEAD_BEFORE_CALLBACK");
        status(retire(B, 2, 1).get(), "RETIRED", 2L, "LOST_CALLBACK_NO_INITIALIZATION_OR_WRITE_REPLAY");
        checkRecord(2, 1, B, 2, "EMPTY");
    }
    private static void unknown() throws Exception {
        status(retire(A, 1, 0).get(), "INCOMPLETE", null, "UNCERTAIN_COMMIT_NOT_ACK");
        int writes = AtomicFile.starts; require(writes == 2 && AtomicFile.fails == 0, "NO_ROLLBACK_AFTER_FINISH");
        status(retire(B, 2, 1).get(), "UNAVAILABLE", null, "NO_GENERATION_FROM_UNCERTAINTY");
        status(call("observeRetirement", B).get(), "UNKNOWN", null, "OBSERVATION_NO_SUCCESSOR_LOOKUP");
        status(call("observeRetirement", A).get(), "RETIRED", 1L, "EXACT_OBSERVED_COMMIT");
        require(AtomicFile.starts == writes, "OBSERVATION_NOT_EXECUTE");
        scenario = "positive";
        status(retire(B, 2, 1).get(), "RETIRED", 2L, "OBSERVED_HEAD_SUPPORTS_G2");
        status(call("observeRetirement", A).get(), "UNKNOWN", null, "OLD_OBSERVATION_NO_B_MUTATION");
    }
    private static void heldCase() throws Exception {
        Await old = retire(A, 1, 0);
        require(held.await(5, TimeUnit.SECONDS), "ACTUAL_HELD_TRANSITION_CALL");
        status(retire(B, 99, 1).get(), "BUSY", null, "BUSY_NO_RESERVATION");
        api("cancelRetirement").invoke(owner, A);
        status(retire(B, 2, 1).get(), "BUSY", null, "CANCEL_NOT_THREAD_PREEMPTION");
        require(old.done.getCount() == 1, "NO_TIMEOUT_FABRICATED_COMPLETION");
        release.countDown(); status(old.get(), "INCOMPLETE", null, "CANCELLED_NO_FINAL_ACK");
        require(AtomicFile.starts <= 1, "NO_NEXT_WRITE_AFTER_STALE_RETURN");
        if (scenario.equals("held-kernel-auth")) require(AtomicFile.starts == 0, "NO_FIRST_EFFECT_AFTER_HELD_AUTH");
    }
    private static void finalHeld() throws Exception {
        Await old = retire(A, 1, 0);
        require(held.await(5, TimeUnit.SECONDS), "HELD_FINAL_PLATFORM_READ");
        api("cancelRetirement").invoke(owner, A);
        require((Boolean) field(owner, "busy"), "FINAL_READ_BUSY_RETAINED");
        release.countDown(); status(old.get(), "INCOMPLETE", null, "NO_CANCELLED_FINAL_ACK");
        checkRecord(1, 0, A, 1, "EMPTY");
        status(call("observeRetirement", A).get(), "RETIRED", 1L, "CANCELLED_FINAL_CAN_BE_OBSERVED_NOT_REPLAYED");
        require(AtomicFile.starts == 2, "FINAL_OBSERVATION_READ_ONLY");
    }
    private static void initFinal() throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final MessagePreviewPristineInitializer.InitResult[] result = new MessagePreviewPristineInitializer.InitResult[1];
        owner.initializeExplicit(new MessagePreviewPristineInitializer.Completion() {
            public void complete(MessagePreviewPristineInitializer.InitResult next) { result[0] = next; done.countDown(); }
        });
        require(held.await(5, TimeUnit.SECONDS), "ACTUAL_FINAL_INIT_READ_HELD");
        require(field(owner, "initialized") == null, "NO_STATE_BEFORE_FINAL_INIT_SUCCESS");
        owner.close(); release.countDown(); require(done.await(5, TimeUnit.SECONDS), "FINAL_INIT_SETTLES");
        require(result[0].status == MessagePreviewPristineInitializer.Status.UNAVAILABLE
            && field(owner, "initialized") == null, "FAILED_INIT_NEVER_MINTS_TRANSITION_STATE");
    }
    private static void oldCancel() throws Exception {
        status(retire(A, 1, 0).get(), "RETIRED", 1L, "CALIBRATED_A_COMPLETE");
        scenario = "held-read"; Await next = retire(B, 2, 1);
        require(held.await(5, TimeUnit.SECONDS), "ACTUAL_B_READ_HELD");
        api("cancelRetirement").invoke(owner, A);
        release.countDown(); status(next.get(), "RETIRED", 2L, "OLD_CANCEL_CANNOT_RETIRE_SUCCESSOR");
        checkRecord(2, 1, B, 2, "EMPTY");
        status(call("observeRetirement", A).get(), "UNKNOWN", null, "OLD_OBSERVER_NO_SUCCESSOR_EXPORT");
    }
    private static long clock() {
        try {
            if (transitioning && scenario.equals("final-deadline") && AtomicFile.reads >= 4
                && oldField("lookups").getInt(null) == 6 && ++finalClockReads == 3) SystemClock.value = 10_100;
            return SystemClock.value;
        } catch (Exception failure) { throw new AssertionError("FIXTURE_CLOCK"); }
    }
    public static void main(String[] args) throws Exception {
        scenario = args[0]; Looper.getMainLooper();
        oldField("scenario").set(null, "transition-fixture");
        Security.addProvider(new MessagePreviewPristineInitializerProbe.FictionalProvider());
        if (scenario.equals("held-kernel-auth")) Security.insertProviderAt(new HeldAuthProvider(), 1);
        context = new OwnedContext(new File(args[1])); authority = new Authority();
        AtomicFile.onEvent = MessagePreviewVaultTransitionsProbe::event;
        SystemClock.onRead = MessagePreviewVaultTransitionsProbe::clock;
        owner = MessagePreviewPristineInitializer.getOrCreate(context, authority);
        try {
            if (scenario.equals("held-init-final")) { initFinal(); }
            else if (scenario.equals("uninitialized")) {
                status(retire(A, 1, 0).get(), "UNAVAILABLE", null, "PRIVATE_G0_PROVENANCE_REQUIRED");
                require(keys().isEmpty() && !journal().exists() && AtomicFile.starts == 0, "NO_CALLER_G0_AUTHORITY");
            } else initialize();
            api("retireExact");
            if (scenario.equals("positive")) positive();
            else if (scenario.equals("held-init-final")) { }
            else if (scenario.equals("refusals")) refusals();
            else if (scenario.equals("malformed")) malformed();
            else if (scenario.equals("uninitialized")) { }
            else if (scenario.equals("unknown-final") || scenario.equals("readback-failure")) unknown();
            else if (scenario.equals("predecessor-mismatch") || scenario.equals("corrupt-predecessor")) predecessorMismatch(scenario.equals("corrupt-predecessor"));
            else if (scenario.equals("missing-key")) missingKey();
            else if (scenario.endsWith("-exhausted")) exhausted();
            else if (scenario.equals("observation-mismatch")) observationMismatch();
            else if (scenario.equals("lost-callback")) lostCallback();
            else if (scenario.equals("held-final-context")) finalHeld();
            else if (scenario.equals("old-cancel")) oldCancel();
            else if (scenario.equals("final-deadline")) {
                status(retire(A, 1, 0).get(), "INCOMPLETE", null, "FRESH_FINAL_PUBLICATION_REQUIRED");
                require(finalClockReads >= 3 && AtomicFile.starts == 2, "FINAL_ACK_CLOCK_CALIBRATED");
            }
            else if (scenario.equals("close-held")) {
                Await old = retire(A, 1, 0); require(held.await(5, TimeUnit.SECONDS), "HELD_CLOSE_CALL");
                owner.close(); require((Boolean) field(owner, "busy"), "CLOSE_NOT_BUSY_RELEASE");
                release.countDown(); status(old.get(), "INCOMPLETE", null, "CLOSED_NO_FINAL_ACK");
                require(AtomicFile.starts == 0, "CLOSED_NO_NEXT_EFFECT");
            }
            else if (scenario.endsWith("-failure")) failures();
            else if (scenario.startsWith("held-")) heldCase();
            else if (scenario.equals("foreground-retired")) {
                authority.current = null; owner.invalidate(); positive();
            } else if (scenario.equals("deadline-return") || scenario.equals("locked-return") || scenario.equals("clock-backward")) {
                status(retire(A, 1, 0).get(), "INCOMPLETE", null, "FRESH_PLATFORM_RETURN_REQUIRED");
                require(AtomicFile.starts == 0, "NO_EFFECT_AFTER_STALE_READ");
            } else throw new AssertionError("KNOWN_SCENARIO");
            Os.assertClosed(); System.out.println("PASS " + args[0]);
        } finally {
            release.countDown(); owner.close();
            Thread worker = (Thread) field(owner, "worker"); worker.join(2000);
            require(!worker.isAlive(), "OWN_WORKER_CLOSED");
        }
    }
}
