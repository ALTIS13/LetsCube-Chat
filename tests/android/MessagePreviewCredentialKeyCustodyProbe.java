package com.kub.messenger;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.Key;
import java.security.KeyStoreSpi;
import java.security.Provider;
import java.security.SecureRandom;
import java.security.Security;
import java.security.cert.Certificate;
import java.security.spec.AlgorithmParameterSpec;
import java.security.spec.KeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.KeyGeneratorSpi;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactorySpi;
import javax.crypto.spec.SecretKeySpec;

// Actual custody/Reader/Fence/metadata/JIO with fictional Android/provider/journal inputs.
// This Gate and bindContext are NOT live Task5/owned-namespace authority.
public final class MessagePreviewCredentialKeyCustodyProbe {
    private static final String INSTALL = "11111111111111111111111111111111";
    private static final String META = "letscube.nmpv.metadata.v1." + INSTALL;
    private static final String ALIAS = "letscube.nmpv.credential.v1." + INSTALL + ".aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String OLD = "letscube.nmpv.credential.v1." + INSTALL + ".bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String FOREIGN = "letscube.nmpv.credential.v1.22222222222222222222222222222222.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final SecretKey METADATA = new SecretKeySpec(new byte[32], "AES");
    private static final Map<String, SecretKey> keys = new LinkedHashMap<>();
    private static final List<String> deletions = new ArrayList<>(), lookups = new ArrayList<>();
    private static final List<String> events = new ArrayList<>();
    private static List<String> inventory;
    private static int initCalls, generateCalls, platformCalls, journalReads, forbiddenWrites;
    private static KeyGenParameterSpec policy;
    private static String specAlias;
    private static boolean badGeneratedPolicy, leaveDeleted, failDelete, failGenerate, nullInventory;
    private static Fixture active;
    private interface Hook { void hit(String event) throws Exception; }
    private static Hook hook;
    private static void event(String name) {
        platformCalls++; events.add(name);
        try { if (hook != null) hook.hit(name); }
        catch (Exception failure) { throw new IllegalStateException("FIXTURE"); }
    }
    private static final class App extends Application {
        final ApplicationInfo info = new ApplicationInfo();
        UserManager manager = new UserManager();
        boolean protectedStorage, otherApplication, failContext;
        App() { info.uid = 10500; }
        public Context getApplicationContext() { event("context"); if (failContext) throw new IllegalStateException("FIXTURE"); return otherApplication ? new App() : this; }
        public ApplicationInfo getApplicationInfo() { event("appInfo"); return info; }
        public boolean isDeviceProtectedStorage() { event("dp"); return protectedStorage; }
        public <T> T getSystemService(Class<T> type) { event("user"); return type.cast(manager); }
    }
    private static final class BorrowedKey implements SecretKey {
        private static final long serialVersionUID = 1L;
        public String getAlgorithm() { return "AES"; }
        public String getFormat() { throw new AssertionError("NO_KEY_EXPORT"); }
        public byte[] getEncoded() { throw new AssertionError("NO_KEY_EXPORT"); }
    }
    public static final class FictionalProvider extends Provider {
        private static final long serialVersionUID = 1L;
        FictionalProvider() {
            super("AndroidKeyStore", "1.0", "FICTIONAL CHILD JVM PROVIDER");
            put("KeyStore.AndroidKeyStore", Store.class.getName());
            put("KeyGenerator.AES", Generator.class.getName());
            put("SecretKeyFactory.AES", Factory.class.getName());
        }
    }
    public static final class Store extends KeyStoreSpi {
        public void engineLoad(InputStream input, char[] password) { require(input == null && password == null, "NO_IMPORT"); event("load"); }
        public Key engineGetKey(String alias, char[] password) { require(password == null, "NO_PASSWORD"); lookups.add(alias); event("lookup"); return keys.get(alias); }
        public Enumeration<String> engineAliases() {
            event("aliases"); if (nullInventory) return null;
            List<String> values = inventory == null ? new ArrayList<>(keys.keySet()) : new ArrayList<>(inventory);
            Enumeration<String> delegate = Collections.enumeration(values);
            return new Enumeration<String>() {
                public boolean hasMoreElements() { event("more"); return delegate.hasMoreElements(); }
                public String nextElement() { event("next"); return delegate.nextElement(); }
            };
        }
        public boolean engineContainsAlias(String alias) { event("contains"); return keys.containsKey(alias); }
        public void engineDeleteEntry(String alias) {
            deletions.add(alias); if (!leaveDeleted) keys.remove(alias); event("delete");
            if (failDelete) throw new IllegalStateException("FIXTURE");
        }
        public void engineSetKeyEntry(String a, Key b, char[] c, Certificate[] d) { forbidden(); }
        public void engineSetKeyEntry(String a, byte[] b, Certificate[] c) { forbidden(); }
        public void engineSetCertificateEntry(String a, Certificate b) { forbidden(); }
        public void engineStore(OutputStream a, char[] b) { forbidden(); }
        public Certificate[] engineGetCertificateChain(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public Certificate engineGetCertificate(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public Date engineGetCreationDate(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public int engineSize() { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public boolean engineIsKeyEntry(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public boolean engineIsCertificateEntry(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public String engineGetCertificateAlias(Certificate a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
    }
    public static final class Generator extends KeyGeneratorSpi {
        protected void engineInit(SecureRandom random) { throw new AssertionError("EXACT_SPEC"); }
        protected void engineInit(int size, SecureRandom random) { throw new AssertionError("EXACT_SPEC"); }
        protected void engineInit(AlgorithmParameterSpec spec, SecureRandom random) {
            require(spec instanceof KeyGenParameterSpec, "EXACT_SPEC"); policy = (KeyGenParameterSpec) spec;
            require(policy.alias.equals(ALIAS), "EXACT_CREATION_ALIAS"); // Observe actual init policy before wrong-alias mutation can corrupt metadata.
            initCalls++; event("init");
        }
        protected SecretKey engineGenerateKey() {
            generateCalls++; BorrowedKey value = new BorrowedKey(); keys.put(policy.alias, value); event("generate");
            if (failGenerate) throw new IllegalStateException("FIXTURE"); return value;
        }
    }
    public static final class Factory extends SecretKeyFactorySpi {
        protected KeySpec engineGetKeySpec(SecretKey key, Class<?> type) {
            event("info"); require(type == KeyInfo.class, "REAL_READER_POLICY");
            KeyInfo info = new KeyInfo();
            for (Map.Entry<String, SecretKey> entry : keys.entrySet()) if (entry.getValue() == key) info.alias = entry.getKey();
            if (badGeneratedPolicy && !META.equals(info.alias)) info.size = 128;
            specAlias=info.alias; event("info-complete");
            return info;
        }
        protected SecretKey engineGenerateSecret(KeySpec spec) { forbidden(); return null; }
        protected SecretKey engineTranslateKey(SecretKey key) { forbidden(); return null; }
    }
    private static void forbidden() { forbiddenWrites++; throw new AssertionError("NO_OTHER_KEY_OR_JOURNAL_MUTATION"); }
    private static final class Backend implements MessagePreviewJournalIO.Backend {
        byte[] bytes;
        public InputStream openRead() { journalReads++; event("read"); return new ByteArrayInputStream(bytes); }
        public OutputStream startWrite() { forbidden(); return null; }
        public void sync(OutputStream stream) { forbidden(); }
        public void finishWrite(OutputStream stream) { forbidden(); }
        public void failWrite(OutputStream stream) { forbidden(); }
    }
    private static final class Fixture {
        final App app = new App();
        final Backend backend = new Backend();
        final MessagePreviewVaultFence fence;
        final MessagePreviewVaultFence.Operation operation;
        final MessagePreviewMetadataEnvelope.Record predecessor, head;
        final MessagePreviewCredentialKeyCustody custody;
        final MessagePreviewCredentialKeyCustody.Request request;
        volatile boolean current = true;
        int gates;
        Fixture(boolean deleting, String alias, MessagePreviewVaultFence.Kind kind, Thread worker) throws Exception {
            this(deleting,alias,kind,worker,1);
        }
        Fixture(boolean deleting, String alias, MessagePreviewVaultFence.Kind kind, Thread worker, long revision) throws Exception {
            active = this; keys.put(META, METADATA);
            MessagePreviewMetadataEnvelope.Header old = new MessagePreviewMetadataEnvelope.Header(INSTALL, deleting ? 1 : 0,
                deleting && !alias.isEmpty() ? MessagePreviewMetadataEnvelope.Kind.COMMITTED : MessagePreviewMetadataEnvelope.Kind.EMPTY,
                deleting ? alias : "", deleting && !alias.isEmpty() ? 1000 : 0, 0,
                deleting ? "cccccccccccccccccccccccccccccccc" : "", 0, 0);
            predecessor = record(old, old.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED ? new byte[28] : new byte[0]);
            fence = new MessagePreviewVaultFence(old.generation);
            MessagePreviewVaultFence.Context context = new MessagePreviewVaultFence.Context(1,
                "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333", 2);
            require(fence.bindContext(context), "FIXTURE_CONTEXT");
            MessagePreviewVaultFence.Owner owner = new MessagePreviewVaultFence.Owner(context.recipient, context.session,
                "44444444-4444-4444-8444-444444444444", 2);
            if (kind == MessagePreviewVaultFence.Kind.REFUSED) owner = new MessagePreviewVaultFence.Owner(context.recipient, context.session, "bad", 2);
            operation = (kind == MessagePreviewVaultFence.Kind.RETIRE
                ? fence.retire("dddddddddddddddddddddddddddddddd", revision, old.generation, null)
                : fence.begin("dddddddddddddddddddddddddddddddd", revision, old.generation, context, owner)).operation;
            require(operation != null, "FIXTURE_OPERATION");
            head = record(new MessagePreviewMetadataEnvelope.Header(INSTALL, operation.generation,
                deleting ? MessagePreviewMetadataEnvelope.Kind.RETIRING : MessagePreviewMetadataEnvelope.Kind.PENDING,
                alias, 0, 0, operation.operationId, operation.baseGeneration, operation.vaultRevision), new byte[0]);
            backend.bytes = MessagePreviewMetadataEnvelope.seal(head.header, head.credentialBytes(), METADATA);
            custody = new MessagePreviewCredentialKeyCustody(app, 10500, worker, INSTALL,
                new MessagePreviewJournalIO(backend), exact -> { gates++; require(exact == requestRef, "EXACT_GATE_REQUEST"); if (!current) throw new Exception("FIXTURE"); });
            request = new MessagePreviewCredentialKeyCustody.Request(custody, fence, operation, predecessor, head, 100, 1000);
            requestRef = request;
        }
        MessagePreviewCredentialKeyCustody.Request requestRef;
        void execute(boolean deleting) throws Exception {
            if (deleting) custody.deleteRetiringKey(request); else require(custody.createPendingKey(request) == keys.get(ALIAS), "BORROWED_HANDLE");
        }
        void drift() throws Exception {
            MessagePreviewMetadataEnvelope.Header h = head.header;
            backend.bytes = MessagePreviewMetadataEnvelope.seal(new MessagePreviewMetadataEnvelope.Header(h.installation,
                h.generation, h.kind, h.alias, h.expiresWallMillis, h.wallHighWaterMillis + 1,
                h.operationId, h.baseGeneration, h.vaultRevision), new byte[0], METADATA);
        }
    }
    private static MessagePreviewMetadataEnvelope.Record record(MessagePreviewMetadataEnvelope.Header header, byte[] credential) throws Exception {
        return MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(header, credential, METADATA), INSTALL, METADATA);
    }
    private static Fixture fixture(boolean deleting) throws Exception {
        Fixture f = new Fixture(deleting, deleting ? OLD : ALIAS, deleting ? MessagePreviewVaultFence.Kind.RETIRE : MessagePreviewVaultFence.Kind.BEGIN, Thread.currentThread());
        if (deleting) keys.put(OLD, new BorrowedKey()); return f;
    }
    private interface Checked { void run() throws Exception; }
    private static void require(boolean value, String tag) { if (!value) throw new AssertionError(tag); }
    private static void unavailable(Checked action, String tag) throws Exception {
        try { action.run(); }
        catch (MessagePreviewCredentialKeyCustody.Unavailable refused) {
            require("UNAVAILABLE".equals(refused.getMessage()) && refused.getCause() == null
                && refused.getStackTrace().length == 0 && refused.getSuppressed().length == 0, "FIXED_REFUSAL"); return;
        }
        throw new AssertionError(tag);
    }
    private static void positive(boolean deleting) throws Exception {
        Fixture f = fixture(deleting); int before = platformCalls;
        require(before == 0 && journalReads == 0 && f.gates == 0, "PURE_CONSTRUCTORS");
        keys.put("unrelated.fixture", new BorrowedKey());
        try { f.execute(deleting); }
        catch (MessagePreviewCredentialKeyCustody.Unavailable refused) {
            if (!deleting && policy != null) require(policy.alias.equals(ALIAS), "EXACT_CREATION_ALIAS");
            throw new AssertionError("HEALTHY_EXECUTION");
        }
        require(keys.containsKey(META) && keys.containsKey("unrelated.fixture"), "PRESERVED_KEYS");
        require(forbiddenWrites == 0 && journalReads >= 2, "FRESH_AUTHENTICATED_READBACK");
        if (deleting) require(deletions.equals(Collections.singletonList(OLD)) && !keys.containsKey(OLD) && generateCalls == 0, "EXACT_DELETE");
        else {
            require(initCalls == 1 && generateCalls == 1 && deletions.isEmpty(), "ONE_GENERATE");
            require(policy.alias.equals(ALIAS) && policy.purposes == 3 && policy.size == 256
                && Arrays.equals(policy.modes, new String[] { "GCM" }) && Arrays.equals(policy.paddings, new String[] { "NoPadding" })
                && policy.randomized && !policy.authentication, "EXACT_CREATION_POLICY");
            require(lookups.contains(META) && lookups.contains(ALIAS) && !lookups.contains("unrelated.fixture"), "REAL_READER_NO_UNRELATED_DETAILS");
        }
        int mutations = generateCalls + deletions.size();
        unavailable(() -> f.execute(deleting), "ONE_USE"); require(generateCalls + deletions.size() == mutations, "NO_REPLAY");
    }
    private static void absent(String scenario) throws Exception {
        Fixture f;
        if (scenario.equals("empty")) f = new Fixture(true, "", MessagePreviewVaultFence.Kind.RETIRE, Thread.currentThread());
        else { f = fixture(true); keys.remove(OLD); }
        f.execute(true); require(deletions.isEmpty() && keys.containsKey(META), "CHECKED_ABSENCE_NO_MUTATION");
    }
    private static void requestBoundary(String scenario) throws Exception {
        Fixture f = fixture(scenario.equals("predecessor-alias") || scenario.equals("predecessor-distinct"));
        MessagePreviewMetadataEnvelope.Header h = f.head.header;
        MessagePreviewMetadataEnvelope.Record head = f.head, predecessor = f.predecessor;
        long admitted=100, deadline=1000;
        switch (scenario) {
            case "head-operation": head=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,h.generation,h.kind,h.alias,0,0,
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",h.baseGeneration,h.vaultRevision),new byte[0]); break;
            case "head-revision": head=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,h.generation,h.kind,h.alias,0,0,
                h.operationId,h.baseGeneration,2),new byte[0]); break;
            case "head-generation": head=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,2,h.kind,h.alias,0,0,
                h.operationId,1,h.vaultRevision),new byte[0]); break;
            case "head-phase": head=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,h.generation,MessagePreviewMetadataEnvelope.Kind.EMPTY,"",0,0,
                h.operationId,h.baseGeneration,h.vaultRevision),new byte[0]); break;
            case "head-installation": {
                String other="22222222222222222222222222222222";
                MessagePreviewMetadataEnvelope.Header foreign=new MessagePreviewMetadataEnvelope.Header(other,h.generation,h.kind,FOREIGN,0,0,
                    h.operationId,h.baseGeneration,h.vaultRevision);
                head=MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(foreign,new byte[0],METADATA),other,METADATA); break;
            }
            case "predecessor-generation": predecessor=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,1,MessagePreviewMetadataEnvelope.Kind.EMPTY,"",0,0,
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",0,0),new byte[0]); break;
            case "predecessor-alias": head=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,h.generation,h.kind,ALIAS,0,0,
                h.operationId,h.baseGeneration,h.vaultRevision),new byte[0]); break;
            case "predecessor-distinct": head=record(new MessagePreviewMetadataEnvelope.Header(INSTALL,h.generation,MessagePreviewMetadataEnvelope.Kind.PENDING,OLD,0,0,
                h.operationId,h.baseGeneration,h.vaultRevision),new byte[0]); break;
            case "negative-admission": admitted=-1; break;
            case "long-deadline": deadline=10101; break;
            case "zero-budget": deadline=100; break;
            default: throw new AssertionError("UNKNOWN_REQUEST_BOUNDARY");
        }
        final MessagePreviewMetadataEnvelope.Record finalHead=head, finalPredecessor=predecessor;
        final long a=admitted,d=deadline;
        unavailable(() -> new MessagePreviewCredentialKeyCustody.Request(f.custody,f.fence,f.operation,finalPredecessor,finalHead,a,d), "REQUEST_BINDING_REFUSED");
        require(platformCalls==0 && journalReads==0 && generateCalls==0 && deletions.isEmpty(), "REQUEST_BEFORE_PLATFORM");
    }
    private static void workerBoundary(String scenario) throws Exception {
        Fixture f=fixture(false);
        if (scenario.equals("wrong-instance")) {
            MessagePreviewCredentialKeyCustody other=new MessagePreviewCredentialKeyCustody(f.app,10500,Thread.currentThread(),INSTALL,
                new MessagePreviewJournalIO(f.backend), exact -> { throw new Exception("FIXTURE"); });
            unavailable(() -> other.createPendingKey(f.request), "INSTANCE_REFUSED");
            require(platformCalls==0, "INSTANCE_BEFORE_PLATFORM"); f.execute(false); return;
        }
        if (scenario.equals("wrong-thread")) {
            AtomicReference<Throwable> failure=new AtomicReference<>();
            Thread thread=new Thread(() -> { try { unavailable(() -> f.execute(false), "REFUSAL_REQUIRED"); } catch (Throwable problem) { failure.set(problem); } });
            thread.start(); thread.join(2000); require(!thread.isAlive(), "WORKER_SETTLED");
            if (failure.get() instanceof AssertionError) throw (AssertionError)failure.get();
            require(failure.get()==null && platformCalls==0 && generateCalls==0, "THREAD_BEFORE_PLATFORM");
            unavailable(() -> f.execute(false), "ONE_USE"); return;
        }
        if (scenario.equals("delete-pending")) unavailable(() -> f.custody.deleteRetiringKey(f.request), "PHASE_REFUSED");
        else throw new AssertionError("UNKNOWN_WORKER_BOUNDARY");
        require(platformCalls==0 && generateCalls==0 && deletions.isEmpty(), "PHASE_BEFORE_PLATFORM");
    }
    private static void erasureKind(String scenario) throws Exception {
        boolean begin=scenario.equals("delete-begin");
        Fixture f=new Fixture(true,OLD,begin ? MessagePreviewVaultFence.Kind.BEGIN : MessagePreviewVaultFence.Kind.REFUSED,Thread.currentThread());
        keys.put(OLD,new BorrowedKey());
        if (!begin) f.fence.clearContext(2);
        f.execute(true); require(deletions.equals(Collections.singletonList(OLD)) && keys.containsKey(META), "ERASURE_KIND_EXACT");
    }
    private static void firstRevision(String scenario) throws Exception {
        Fixture f=new Fixture(false,ALIAS,MessagePreviewVaultFence.Kind.BEGIN,Thread.currentThread(),0);
        require(f.operation.generation==1 && f.operation.baseGeneration==0 && f.operation.vaultRevision==0, "REAL_FIRST_ADMISSION");
        if (scenario.equals("first-revision-zero")) {
            f.execute(false); require(generateCalls==1 && keys.containsKey(ALIAS), "FIRST_REVISION_ZERO_CREATES"); return;
        }
        long invalid=scenario.equals("negative-revision") ? -1 : 9007199254740992L;
        MessagePreviewVaultFence.Admission refused=f.fence.begin("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",invalid,1,
            f.operation.context,f.operation.owner);
        require(refused.decision==MessagePreviewVaultFence.Decision.INVALID_REQUEST && refused.operation==null
            && f.fence.canContinue(f.operation), "INVALID_REVISION_NO_EFFECTS");
        MessagePreviewMetadataEnvelope.Header h=f.head.header;
        try {
            MessagePreviewMetadataEnvelope.seal(new MessagePreviewMetadataEnvelope.Header(INSTALL,h.generation,h.kind,h.alias,
                0,0,h.operationId,h.baseGeneration,invalid),new byte[0],METADATA);
            throw new AssertionError("INVALID_AUTHENTICATED_HEADER_REFUSED");
        } catch (MessagePreviewMetadataEnvelope.Unavailable expected) { /* Actual provenance refuses before any Request exists. */ }
        require(platformCalls==0 && generateCalls==0 && deletions.isEmpty(), "INVALID_REVISION_NO_PLATFORM");
    }
    private static void constructorShapes() throws Exception {
        Fixture f=fixture(false); MessagePreviewJournalIO journal=new MessagePreviewJournalIO(f.backend);
        MessagePreviewCredentialKeyCustody.Gate gate=exact -> { throw new Exception("FIXTURE"); };
        for (Checked bad : new Checked[] {
            () -> new MessagePreviewCredentialKeyCustody(null,10500,Thread.currentThread(),INSTALL,journal,gate),
            () -> new MessagePreviewCredentialKeyCustody(f.app,9999,Thread.currentThread(),INSTALL,journal,gate),
            () -> new MessagePreviewCredentialKeyCustody(f.app,10500,null,INSTALL,journal,gate),
            () -> new MessagePreviewCredentialKeyCustody(f.app,10500,Thread.currentThread(),"bad",journal,gate),
            () -> new MessagePreviewCredentialKeyCustody(f.app,10500,Thread.currentThread(),INSTALL,null,gate),
            () -> new MessagePreviewCredentialKeyCustody(f.app,10500,Thread.currentThread(),INSTALL,journal,null),
            () -> new MessagePreviewCredentialKeyCustody.Request(null,f.fence,f.operation,f.predecessor,f.head,100,1000),
            () -> new MessagePreviewCredentialKeyCustody.Request(f.custody,null,f.operation,f.predecessor,f.head,100,1000),
            () -> new MessagePreviewCredentialKeyCustody.Request(f.custody,f.fence,null,f.predecessor,f.head,100,1000),
            () -> new MessagePreviewCredentialKeyCustody.Request(f.custody,f.fence,f.operation,null,f.head,100,1000),
            () -> new MessagePreviewCredentialKeyCustody.Request(f.custody,f.fence,f.operation,f.predecessor,null,100,1000),
        }) unavailable(bad,"CONSTRUCTOR_REFUSED");
        require(platformCalls==0 && journalReads==0 && f.gates==0,"CONSTRUCTORS_NO_ADMISSION");
    }
    private static void boundedInventory() throws Exception {
        Fixture f=fixture(false); inventory=new ArrayList<>(); inventory.add(META);
        for (int i=0;i<255;i++) inventory.add("other."+i);
        f.execute(false); require(generateCalls==1 && keys.containsKey(ALIAS),"EXACT256_ALIASES_ACCEPTED");
    }
    private static void beginContextLoss() throws Exception {
        Fixture f=new Fixture(true,OLD,MessagePreviewVaultFence.Kind.BEGIN,Thread.currentThread()); keys.put(OLD,new BorrowedKey());
        f.fence.clearContext(2);
        unavailable(() -> f.execute(true),"BEGIN_NO_ERASURE_PROMOTION");
        require(deletions.isEmpty() && keys.containsKey(OLD),"CONTEXT_LOSS_NO_DELETION");
    }
    private static void finalKeyLoss() throws Exception {
        Fixture f=fixture(false);
        hook=name -> { if (name.equals("info-complete") && ALIAS.equals(specAlias)) keys.remove(ALIAS); };
        unavailable(() -> f.custody.createPendingKey(f.request),"FINAL_KEY_ABSENCE_REFUSED");
        require(generateCalls==1 && keys.containsKey(META) && deletions.isEmpty(),"KEY_LOSS_NO_REPAIR");
        unavailable(() -> f.custody.createPendingKey(f.request),"ONE_USE");
    }
    private static void refusal(String scenario) throws Exception {
        boolean deleting = scenario.startsWith("delete-"); Fixture f = fixture(deleting);
        switch (scenario) {
            case "gate": f.current = false; break;
            case "fence": f.fence.clearContext(2); break;
            case "uid": android.os.Process.uid = 10501; break;
            case "app-uid": f.app.info.uid = 10501; break;
            case "application": f.app.otherApplication = true; break;
            case "protected": f.app.protectedStorage = true; break;
            case "locked": f.app.manager.unlocked = false; break;
            case "unknown-user": f.app.manager = null; break;
            case "context-error": f.app.failContext = true; break;
            case "deadline": SystemClock.now = 1000; break;
            case "before-admission": SystemClock.now = 99; break;
            case "regression": hook = name -> { if (name.equals("context")) SystemClock.now = 99; }; break;
            case "late-clock-regression": {
                int[] calls={0}; hook=name -> { if (name.equals("context")) SystemClock.now=++calls[0]==1 ? 200 : 150; }; break;
            }
            case "snapshot": f.drift(); break;
            case "tamper": f.backend.bytes[f.backend.bytes.length - 1] ^= 1; break;
            case "missing-journal": f.backend.bytes = new byte[0]; break;
            case "missing-metadata": keys.remove(META); break;
            case "candidate": keys.put(ALIAS, new BorrowedKey()); break;
            case "foreign": keys.put(FOREIGN, new BorrowedKey()); break;
            case "malformed-inventory": keys.put("letscube.nmpv.invalid", new BorrowedKey()); break;
            case "duplicate": inventory = Arrays.asList(META, META); break;
            case "null-alias": inventory = Arrays.asList(META, null); break;
            case "null-inventory": nullInventory=true; break;
            case "inventory-exception": hook=name -> { if (name.equals("next")) throw new Exception("FIXTURE"); }; break;
            case "long-alias": inventory = Arrays.asList(META, String.join("", Collections.nCopies(257, "x"))); break;
            case "overflow": inventory = new ArrayList<>(); inventory.add(META); for (int i=0;i<256;i++) inventory.add("other."+i); break;
            case "late-alias": hook = name -> { if (name.equals("init")) keys.put(FOREIGN, new BorrowedKey()); }; break;
            case "late-candidate": hook = name -> { if (name.equals("init")) keys.put(ALIAS, new BorrowedKey()); }; break;
            case "late-untracked-candidate": inventory=Collections.singletonList(META);
                hook = name -> { if (name.equals("init")) keys.put(ALIAS, new BorrowedKey()); }; break;
            case "late-gate-init": hook = name -> { if (name.equals("init")) f.current = false; }; break;
            case "late-context": hook = name -> { if (name.equals("context")) { f.current = false; SystemClock.now=1000; } }; break;
            case "late-read": hook = name -> { if (name.equals("read")) f.current = false; }; break;
            case "late-metadata": hook = name -> { if (name.equals("lookup")) f.current = false; }; break;
            case "generate-refusal": failGenerate = true; break;
            case "late-generate": hook = name -> { if (name.equals("generate")) f.current = false; }; break;
            case "late-fence-generate": hook = name -> { if (name.equals("generate")) f.fence.clearContext(2); }; break;
            case "late-deadline": hook = name -> { if (name.equals("generate")) SystemClock.now=1000; }; break;
            case "policy-readback": badGeneratedPolicy = true; break;
            case "generated-drift": hook = name -> { if (name.equals("generate")) f.drift(); }; break;
            case "delete-present": leaveDeleted = true; break;
            case "delete-unknown": failDelete = true; break;
            case "delete-gate": hook = name -> { if (name.equals("delete")) f.current=false; }; break;
            case "delete-drift": hook = name -> { if (name.equals("delete")) f.drift(); }; break;
            case "delete-successor": hook = name -> { if (name.equals("delete")) keys.put(ALIAS, new BorrowedKey()); }; break;
            case "delete-new-operation": hook=name -> { if (name.equals("delete")) require(f.fence.retire(
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",2,f.operation.generation,null).operation!=null,"SUCCESSOR_RESERVED"); }; break;
            default: throw new AssertionError("UNKNOWN_REFUSAL");
        }
        unavailable(() -> f.execute(deleting), "REFUSAL_REQUIRED");
        int mutations = generateCalls + deletions.size(); unavailable(() -> f.execute(deleting), "ONE_USE");
        require(generateCalls + deletions.size() == mutations, "NO_REPLAY_OR_REPAIR");
        boolean generated = scenario.equals("generate-refusal") || scenario.equals("late-generate") || scenario.equals("late-fence-generate")
            || scenario.equals("late-deadline") || scenario.equals("policy-readback") || scenario.equals("generated-drift");
        if (generated) require(generateCalls == 1 && keys.containsKey(ALIAS) && deletions.isEmpty(), "CREATED_RESIDUE_RETAINED");
        else if (scenario.startsWith("delete-")) require(deletions.equals(Collections.singletonList(OLD)) && keys.containsKey(META), "EXACT_DELETE_NO_REPAIR");
        else require(generateCalls == 0 && deletions.isEmpty(), "NO_KEY_MUTATION");
    }
    private static void held(String label) throws Exception {
        boolean deleting = label.equals("delete");
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = new Thread(() -> { try { unavailable(() -> active.execute(deleting), "NO_LATE_SUCCESS"); } catch (Throwable problem) { failure.set(problem); } });
        Fixture f = new Fixture(deleting, deleting ? OLD : ALIAS, deleting ? MessagePreviewVaultFence.Kind.RETIRE : MessagePreviewVaultFence.Kind.BEGIN, worker);
        if (deleting) keys.put(OLD, new BorrowedKey());
        hook = name -> { if (name.equals(label)) { entered.countDown(); require(release.await(2, TimeUnit.SECONDS), "HELD_RELEASE"); } };
        worker.start(); require(entered.await(2, TimeUnit.SECONDS), "HELD_ENTERED");
        f.current = false; // No custody monitor can block this memory retirement.
        if (!deleting) f.fence.clearContext(2);
        release.countDown(); worker.join(3000); require(!worker.isAlive(), "WORKER_SETTLED");
        if (failure.get() instanceof AssertionError) throw (AssertionError) failure.get();
        require(failure.get() == null, "HELD_FIXED_REFUSAL");
        if (label.equals("generate")) require(keys.containsKey(ALIAS) && deletions.isEmpty(), "HELD_CREATED_RESIDUE");
        if (deleting) require(!keys.containsKey(OLD) && deletions.size()==1, "HELD_DELETED_RESIDUE");
        require(forbiddenWrites==0, "NO_JOURNAL_REPAIR");
    }
    public static void main(String[] args) {
        try {
            require(Security.getProvider("AndroidKeyStore") == null, "ISOLATED_PROVIDER");
            Security.addProvider(new FictionalProvider()); String scenario=args[0];
            if (scenario.equals("create")) positive(false);
            else if (scenario.equals("delete")) positive(true);
            else if (scenario.equals("absent") || scenario.equals("empty")) absent(scenario);
            else if (scenario.startsWith("head-") || scenario.startsWith("predecessor-") || scenario.equals("negative-admission")
                || scenario.equals("long-deadline") || scenario.equals("zero-budget")) requestBoundary(scenario);
            else if (scenario.startsWith("wrong-") || scenario.equals("delete-pending")) workerBoundary(scenario);
            else if (scenario.equals("delete-begin") || scenario.equals("delete-refused")) erasureKind(scenario);
            else if (scenario.equals("first-revision-zero") || scenario.equals("negative-revision") || scenario.equals("unsafe-revision")) firstRevision(scenario);
            else if (scenario.equals("constructor-shapes")) constructorShapes();
            else if (scenario.equals("bounded-inventory")) boundedInventory();
            else if (scenario.equals("delete-begin-context-loss")) beginContextLoss();
            else if (scenario.equals("final-key-loss")) finalKeyLoss();
            else if (scenario.startsWith("held-")) held(scenario.substring(5));
            else refusal(scenario);
            require(forbiddenWrites==0, "NO_OTHER_MUTATIONS"); System.out.println("PASS " + scenario);
        } catch (AssertionError error) { System.err.println("FAIL " + error.getMessage()); System.exit(1); }
        catch (Throwable unexpected) { System.err.println("FAIL UNEXPECTED_FAILURE"); System.exit(1); }
    }
}
