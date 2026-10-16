package com.kub.messenger;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.util.AtomicFile;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.Certificate;
import java.security.spec.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.SecretKeySpec;

// Actual owner/D1/D2/Fence/JIO/metadata graph. Android lifecycle/UID/clock/authority
// and Keystore handles are fictional; private backing AES-GCM uses JVM SunJCE.
public final class MessagePreviewVaultProvisioningProbe {
    private static final String A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String C="cccccccccccccccccccccccccccccccc", D="dddddddddddddddddddddddddddddddd";
    private static final String E="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    private static final String ACCESS="fictional-access-only";
    private static final Map<String, Borrowed> keys=Collections.synchronizedMap(new LinkedHashMap<String, Borrowed>());
    private static final List<String> trace=Collections.synchronizedList(new ArrayList<String>());
    private static final MessagePreviewVaultFence.Context CAPTURED=new MessagePreviewVaultFence.Context(1,
        "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333", 2);
    private static final MessagePreviewVaultFence.Owner TUPLE=new MessagePreviewVaultFence.Owner(CAPTURED.recipient,
        CAPTURED.session,"44444444-4444-4444-8444-444444444444",2);
    private static String scenario, installation, holdEvent;
    private static String metadataAlias;
    private static int generates, deletes, verifies, credentialInits, preauthStarts, aStartsAfterPreauthentication;
    private static App app;
    private static MessagePreviewPristineInitializer owner;
    private static final CountDownLatch held=new CountDownLatch(1), release=new CountDownLatch(1);
    private static boolean armed, heldOnce, failFinish;
    private static boolean credentialVerified, actualWritePreauthentication;
    private static volatile boolean noPhaseInitialRead, noPhaseSettled, noPhaseRetirementAdmitted;
    private static final List<MessagePreviewMetadataEnvelope.Header> noPhaseHeads=new ArrayList<MessagePreviewMetadataEnvelope.Header>();
    private static byte[] originalG0;
    private static byte[] firstTombstone;
    private static void require(boolean value, String tag) { if (!value) throw new AssertionError(tag); }
    private static boolean inFrame(String type, String method) {
        for (StackTraceElement frame:Thread.currentThread().getStackTrace())
            if (frame.getClassName().equals("com.kub.messenger."+type) && frame.getMethodName().equals(method)) return true;
        return false;
    }
    private static void event(String name) {
        trace.add(name);
        if (scenario.startsWith("no-phase-") && installation!=null && name.equals("journal-read")) {
            try { noPhaseHeads.add(record().header); }
            catch(Exception error) { throw new AssertionError("NO_PHASE_AUTHENTICATED_READ_FIXTURE"); }
            if (armed && !heldOnce) {
                noPhaseInitialRead=inFrame("MessagePreviewVaultProvisioning","begin")
                    && !inFrame("MessagePreviewJournalIO","write");
            }
        }
        if (scenario.startsWith("no-phase-") && armed && noPhaseRetirementAdmitted && name.equals("journal-start")) {
            require(!inFrame("MessagePreviewVaultProvisioning","begin"),"NO_CANCELLED_A_PHASE_WRITE");
            require(noPhaseSettled,"ERASURE_AFTER_ACTUAL_ACQUISITION_SETTLEMENT");
        }
        if (scenario.equals("held-jio-preauthentication") && heldOnce && name.equals("journal-start")
            && inFrame("MessagePreviewVaultProvisioning","begin")) aStartsAfterPreauthentication++;
        if (installation!=null && name.equals("journal-read") && firstTombstone==null) {
            try { if (record().header.kind==MessagePreviewMetadataEnvelope.Kind.RETIRING) firstTombstone=Files.readAllBytes(journal()); }
            catch(Exception error) { throw new AssertionError("FIXTURE_CAPTURE"); }
        }
        if (armed && Looper.myLooper()==null && !heldOnce && name.equals(holdEvent)) {
            heldOnce=true; held.countDown();
            try { require(release.await(4,TimeUnit.SECONDS),"FIXTURE_RELEASE"); }
            catch (InterruptedException error) { throw new AssertionError("FIXTURE_INTERRUPTED"); }
        }
        if (armed && scenario.equals("key-loss") && name.equals("credential-generate")) {
            keys.keySet().removeIf(k -> k.startsWith("letscube.nmpv.credential."));
        }
        if (armed && (scenario.equals("unknown-finish") || scenario.equals("no-phase-unknown-finish"))
            && name.equals("journal-finish") && !failFinish) {
            failFinish=true; throw new IllegalStateException("FICTIONAL_FINISH_FAILURE");
        }
        if (armed && (scenario.equals("fallback") || scenario.equals("entered-key-original-rewind")) && name.equals("credential-generate")) {
            try { Files.write(journal(),originalG0); } catch(Exception error) { throw new AssertionError("FIXTURE_WRITE"); }
        }
        if (armed && scenario.equals("phase-rollback") && name.equals("credential-generate")) {
            require(firstTombstone!=null,"ACTUAL_ATTEMPTED_PHASE_CAPTURED");
            try { Files.write(journal(),firstTombstone); } catch(Exception error) { throw new AssertionError("FIXTURE_WRITE"); }
        }
        if (armed && scenario.equals("drift") && name.equals("credential-generate")) {
            try {
                MessagePreviewMetadataEnvelope.Record r=record(); MessagePreviewMetadataEnvelope.Header h=r.header;
                Files.write(journal(),MessagePreviewMetadataEnvelope.seal(new MessagePreviewMetadataEnvelope.Header(
                    h.installation,h.generation,h.kind,h.alias,0,h.wallHighWaterMillis+1,h.operationId,h.baseGeneration,h.vaultRevision),new byte[0],keys.get(metadataAlias)));
            } catch(Exception error) { throw new AssertionError("FIXTURE_DRIFT"); }
        }
    }
    private static final class App extends Application {
        final File root;
        final UserManager manager=new UserManager();
        final ApplicationInfo info=new ApplicationInfo();
        App(File root) { this.root=root; info.uid=10123; }
        public Context getApplicationContext() { return this; }
        public boolean isDeviceProtectedStorage() { return false; }
        public File getNoBackupFilesDir() { return root; }
        public ApplicationInfo getApplicationInfo() { return info; }
        public Object getSystemService(String name) { return manager; }
        public <T> T getSystemService(Class<T> type) { event("user"); return type.cast(manager); }
    }
    private static final class Passive implements MessagePreviewInitializationGate.ForegroundAuthority {
        final Object handle=new Object();
        public Object capture() { return handle; }
        public boolean isCurrent(Object value) { return value==handle; }
    }
    private static final class Conditional implements MessagePreviewVaultProvisioning.Authority {
        public void requireCurrent(MessagePreviewVaultProvisioning.Identity identity) {
            require(identity.context==CAPTURED || scenario.equals("rejected-context"),"EXACT_CAPTURED_CONTEXT");
            event(credentialVerified ? "final-current" : "current");
        }
        public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,
                String access,long deadline) {
            verifies++; require(access.equals(ACCESS),"EXACT_FICTIONAL_INPUT");
            require(scenario.startsWith("rising-") ? deadline>8100 && deadline<10100
                : deadline==8100 || deadline==15100,"CLIPPED_VERIFY_DEADLINE"); event("verify");
            if (scenario.equals("verify-timeout")) SystemClock.value=deadline;
            long expiry=System.currentTimeMillis()+60000;
            if (scenario.equals("expired") || scenario.equals("failed-ticket-replay")) expiry=1;
            if (scenario.equals("expiry-delta") || scenario.equals("expiry-before-mint"))
                expiry=System.currentTimeMillis()+1000;
            if (scenario.equals("rising-expiry")) expiry=System.currentTimeMillis()+5000;
            if (scenario.equals("foreign-verification")) identity=new MessagePreviewVaultProvisioning.Identity(A,0,0,CAPTURED,TUPLE);
            return new MessagePreviewVaultProvisioning.Verification(identity,access,expiry);
        }
    }
    private static final class Borrowed implements SecretKey {
        private static final long serialVersionUID=1L;
        private final SecretKey backing;
        Borrowed() throws Exception { KeyGenerator g=KeyGenerator.getInstance("AES","SunJCE"); g.init(256); backing=g.generateKey(); }
        public String getAlgorithm() { return "AES"; }
        public String getFormat() { throw new AssertionError("NO_KEY_EXPORT"); }
        public byte[] getEncoded() { throw new AssertionError("NO_KEY_EXPORT"); }
    }
    public static final class ProviderFixture extends Provider {
        private static final long serialVersionUID=1L;
        ProviderFixture() {
            super("AndroidKeyStore","1.0","FICTIONAL CHILD JVM ONLY");
            put("KeyStore.AndroidKeyStore",Store.class.getName());
            put("KeyGenerator.AES",Generator.class.getName()); put("SecretKeyFactory.AES",Factory.class.getName());
            put("Cipher.AES/GCM/NoPadding",Gcm.class.getName());
        }
    }
    public static final class Store extends KeyStoreSpi {
        public void engineLoad(InputStream i,char[] p) { require(i==null && p==null,"NO_IMPORT"); }
        public Key engineGetKey(String a,char[] p) { require(p==null && a.startsWith("letscube.nmpv."),"ONLY_OWN_DETAILS"); event("lookup"); return keys.get(a); }
        public Enumeration<String> engineAliases() { synchronized(keys) { return Collections.enumeration(new ArrayList<String>(keys.keySet())); } }
        public boolean engineContainsAlias(String a) { return keys.containsKey(a); }
        public void engineDeleteEntry(String a) {
            require(a.startsWith("letscube.nmpv.credential.v1."),"EXACT_CREDENTIAL_DELETE");
            deletes++; trace.add("delete:"+a); keys.remove(a); event("delete");
            if (scenario.equals("no-phase-unknown-delete")) throw new IllegalStateException("FICTIONAL_DELETE_ACK_LOST");
        }
        public void engineSetKeyEntry(String a,Key b,char[] c,Certificate[] d) { throw new AssertionError("NO_IMPORT"); }
        public void engineSetKeyEntry(String a,byte[] b,Certificate[] c) { throw new AssertionError("NO_IMPORT"); }
        public void engineSetCertificateEntry(String a,Certificate b) { throw new AssertionError("NO_IMPORT"); }
        public void engineStore(OutputStream a,char[] b) { throw new AssertionError("NO_EXPORT"); }
        public Certificate[] engineGetCertificateChain(String a) { throw new AssertionError("NO_DETAILS"); }
        public Certificate engineGetCertificate(String a) { throw new AssertionError("NO_DETAILS"); }
        public Date engineGetCreationDate(String a) { throw new AssertionError("NO_DETAILS"); }
        public int engineSize() { throw new AssertionError("NO_DETAILS"); }
        public boolean engineIsKeyEntry(String a) { throw new AssertionError("NO_DETAILS"); }
        public boolean engineIsCertificateEntry(String a) { throw new AssertionError("NO_DETAILS"); }
        public String engineGetCertificateAlias(Certificate a) { throw new AssertionError("NO_DETAILS"); }
    }
    public static final class Generator extends KeyGeneratorSpi {
        private KeyGenParameterSpec policy;
        protected void engineInit(SecureRandom r) { throw new AssertionError("EXACT_POLICY"); }
        protected void engineInit(int n,SecureRandom r) { throw new AssertionError("EXACT_POLICY"); }
        protected void engineInit(AlgorithmParameterSpec spec,SecureRandom r) {
            policy=(KeyGenParameterSpec)spec;
            if (policy.alias.startsWith("letscube.nmpv.credential.")) {
                credentialInits++;
                if (scenario.equals("rising-expiry")) SystemClock.value+=6000;
                if (scenario.equals("rising-regression")) SystemClock.value-=100;
            }
            if (armed && scenario.equals("expiry-before-mint") && policy.alias.startsWith("letscube.nmpv.credential.")) SystemClock.value=2100;
        }
        protected SecretKey engineGenerateKey() {
            require(policy.size==256 && policy.purposes==3 && policy.random && !policy.auth
                && Arrays.equals(policy.modes,new String[]{"GCM"}) && Arrays.equals(policy.paddings,new String[]{"NoPadding"}),"EXACT_POLICY");
            try {
                if (policy.alias.startsWith("letscube.nmpv.credential.")) require(credentialCount()==0,"DELETE_BEFORE_CREATE");
                Borrowed key=new Borrowed(); keys.put(policy.alias,key); generates++;
                trace.add("generate:"+policy.alias);
                event(policy.alias.startsWith("letscube.nmpv.credential.") ? "credential-generate" : "metadata-generate");
                if (armed && scenario.equals("expiry-delta")) SystemClock.value=2100;
                if (armed && scenario.equals("clipped-create")) SystemClock.value=15100;
                return key;
            } catch(RuntimeException e) { throw e; } catch(Exception e) { throw new AssertionError("FIXTURE_PROVIDER"); }
        }
    }
    public static final class Factory extends SecretKeyFactorySpi {
        protected KeySpec engineGetKeySpec(SecretKey key,Class<?> type) {
            require(type==KeyInfo.class,"ACTUAL_READER_KEYINFO"); KeyInfo info=new KeyInfo();
            synchronized(keys) { for (Map.Entry<String,Borrowed> e:keys.entrySet()) if(e.getValue()==key) info.alias=e.getKey(); }
            require(info.alias!=null,"ACTUAL_EXISTING_KEY"); return info;
        }
        protected SecretKey engineGenerateSecret(KeySpec s) { throw new AssertionError("NO_IMPORT"); }
        protected SecretKey engineTranslateKey(SecretKey k) { throw new AssertionError("NO_FALLBACK"); }
    }
    public static final class Gcm extends CipherSpi {
        private final Cipher actual;
        private boolean credentialDecrypt, metadataDecrypt;
        public Gcm() throws Exception { actual=Cipher.getInstance("AES/GCM/NoPadding","SunJCE"); }
        protected void engineSetMode(String m) { require(m.equals("GCM"),"GCM"); }
        protected void engineSetPadding(String p) { require(p.equals("NoPadding"),"NO_PADDING"); }
        protected int engineGetBlockSize() { return actual.getBlockSize(); }
        protected int engineGetOutputSize(int n) { return actual.getOutputSize(n); }
        protected byte[] engineGetIV() { return actual.getIV(); }
        protected AlgorithmParameters engineGetParameters() { return actual.getParameters(); }
        private Key backing(Key k) { require(k instanceof Borrowed,"NO_EXPORT_OR_FALLBACK"); return ((Borrowed)k).backing; }
        protected void engineInit(int o,Key k,SecureRandom r) throws InvalidKeyException { actual.init(o,backing(k),r); }
        protected void engineInit(int o,Key k,AlgorithmParameterSpec p,SecureRandom r) throws InvalidKeyException,InvalidAlgorithmParameterException {
            actual.init(o,backing(k),p,r);
            if (o==Cipher.DECRYPT_MODE) synchronized(keys) {
                for (Map.Entry<String,Borrowed> e:keys.entrySet()) if(e.getValue()==k) {
                    credentialDecrypt=e.getKey().startsWith("letscube.nmpv.credential.");
                    metadataDecrypt=e.getKey().startsWith("letscube.nmpv.metadata.");
                }
            }
        }
        protected void engineInit(int o,Key k,AlgorithmParameters p,SecureRandom r) throws InvalidKeyException,InvalidAlgorithmParameterException { actual.init(o,backing(k),p,r); }
        protected void engineUpdateAAD(byte[] b,int o,int n) { actual.updateAAD(b,o,n); }
        protected byte[] engineUpdate(byte[] b,int o,int n) { return actual.update(b,o,n); }
        protected int engineUpdate(byte[] b,int o,int n,byte[] d,int x) throws ShortBufferException { return actual.update(b,o,n,d,x); }
        protected byte[] engineDoFinal(byte[] b,int o,int n) throws IllegalBlockSizeException,BadPaddingException {
            byte[] result=actual.doFinal(b,o,n);
            if (armed && scenario.equals("held-jio-preauthentication") && !heldOnce && metadataDecrypt
                && inFrame("MessagePreviewJournalIO","write")) {
                actualWritePreauthentication=true;
                require(AtomicFile.starts==preauthStarts,"PREAUTHENTICATION_BEFORE_STORAGE_EFFECT");
                event("jio-preauthentication");
            }
            if (credentialDecrypt) {
                credentialVerified=true;
                if (scenario.equals("readback-mismatch")) result[result.length-1]^=1;
            }
            return result;
        }
        protected int engineDoFinal(byte[] b,int o,int n,byte[] d,int x) throws ShortBufferException,IllegalBlockSizeException,BadPaddingException { return actual.doFinal(b,o,n,d,x); }
    }
    private static final class Await implements MessagePreviewPristineInitializer.ProvisionCompletion {
        final CountDownLatch done=new CountDownLatch(1);
        volatile MessagePreviewPristineInitializer.ProvisionResult result;
        public void complete(MessagePreviewPristineInitializer.ProvisionResult r) { result=r; done.countDown(); }
        MessagePreviewPristineInitializer.ProvisionResult get() throws Exception { require(done.await(5,TimeUnit.SECONDS),"FINITE_COMPLETION"); return result; }
    }
    private static final class Erase implements MessagePreviewPristineInitializer.TransitionCompletion {
        final CountDownLatch done=new CountDownLatch(1);
        volatile MessagePreviewPristineInitializer.TransitionResult result;
        public void complete(MessagePreviewPristineInitializer.TransitionResult r) { result=r; done.countDown(); }
        MessagePreviewPristineInitializer.TransitionResult get() throws Exception { require(done.await(5,TimeUnit.SECONDS),"FINITE_ERASURE"); return result; }
    }
    private static Path journal() { return new File(app.root,"native-message-previews-v1/journal-v1.bin").toPath(); }
    private static MessagePreviewMetadataEnvelope.Record record() throws Exception { return MessagePreviewMetadataEnvelope.open(Files.readAllBytes(journal()),installation,keys.get(metadataAlias)); }
    private static int credentialCount() { synchronized(keys) { return (int)keys.keySet().stream().filter(k -> k.startsWith("letscube.nmpv.credential.")).count(); } }
    private static Await begin(String id,long rev,long g,MessagePreviewVaultFence.Owner tuple) { Await a=new Await(); owner.beginOwned(id,rev,g,CAPTURED,tuple,a); return a; }
    private static Await provision(String id,String ticket) { Await a=new Await(); owner.provisionExact(id,ticket,ACCESS,a); return a; }
    private static Erase erase(String id,long rev,long g,MessagePreviewVaultFence.Correlation correlation) { Erase a=new Erase(); owner.retireExact(id,rev,g,correlation,a); return a; }
    private static MessagePreviewPristineInitializer.ProvisionResult pending(String id,long revision,long generation) throws Exception {
        MessagePreviewPristineInitializer.ProvisionResult r=begin(id,revision,generation,TUPLE).get();
        require(r.status==MessagePreviewPristineInitializer.ProvisionStatus.PENDING && r.generation==generation+1
            && r.ticket!=null && r.ticket.matches("[0-9a-f]{32}"),"CHECKED_PENDING_TICKET"); return r;
    }
    private static void initialized() throws Exception {
        CountDownLatch done=new CountDownLatch(1); MessagePreviewPristineInitializer.InitResult[] result=new MessagePreviewPristineInitializer.InitResult[1];
        owner.initializeExplicit(r -> { result[0]=r; done.countDown(); }); require(done.await(5,TimeUnit.SECONDS),"FINITE_INITIALIZATION");
        require(result[0].status==MessagePreviewPristineInitializer.Status.INITIALIZED_EMPTY_G0 && result[0].generation==0,"ACTUAL_G0");
        installation=MessagePreviewInstallationMarker.decode(Files.readAllBytes(new File(app.root,"native-message-previews-v1/installation-v1.bin").toPath()));
        metadataAlias="letscube.nmpv.metadata.v1."+installation;
        originalG0=Files.readAllBytes(journal()); keys.put("unrelated.fixture",new Borrowed());
    }
    private static void positive(boolean replacement) throws Exception {
        MessagePreviewPristineInitializer.ProvisionResult p=pending(A,0,0);
        MessagePreviewPristineInitializer.ProvisionResult r=provision(A,p.ticket).get();
        require(r.status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED && r.generation==1 && r.ticket==null,"ACTUAL_NONEMPTY_G1");
        MessagePreviewMetadataEnvelope.Record h=record();
        require(h.header.generation==1 && h.header.baseGeneration==0 && h.header.vaultRevision==0
            && h.header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED && h.credentialBytes().length>=28,"LITERAL_NONEMPTY_G1");
        require(!new String(Files.readAllBytes(journal()),java.nio.charset.StandardCharsets.ISO_8859_1).contains(ACCESS),"NO_PLAINTEXT_JOURNAL");
        Await observe=new Await(); owner.observeOwned(A,observe); require(observe.get().status==MessagePreviewPristineInitializer.ProvisionStatus.DORMANT
            && observe.result.ticket==null && verifies==1,"OBSERVE_NO_CREDENTIAL_OR_REPLAY");
        long base=1;
        if (replacement) {
            String old=h.header.alias; p=pending(B,1,1); require(!keys.containsKey(old),"OLD_DELETE_BEFORE_TICKET");
            r=provision(B,p.ticket).get(); require(r.status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED && r.generation==2,"REPLACEMENT_G2");
            require(deletes==1 && credentialCount()==1,"ONE_LIVE_ALIAS"); base=2;
        }
        Erase e=erase(C,2,base,null); require(e.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && e.result.generation==base+1,"CHECKED_ERASURE");
        h=record(); require(h.header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY && h.header.generation==base+1
            && h.header.baseGeneration==base && h.header.alias.isEmpty() && h.credentialBytes().length==0
            && credentialCount()==0 && keys.containsKey(metadataAlias) && keys.containsKey("unrelated.fixture"),"LITERAL_EMPTY_PRESERVED");
    }
    private static void noPhaseCancellation() throws Exception {
        boolean nonzero=scenario.equals("no-phase-nonzero") || scenario.equals("no-phase-old-key-absent")
            || scenario.equals("no-phase-unknown-delete");
        boolean expired=scenario.equals("no-phase-expired");
        if (nonzero) {
            MessagePreviewPristineInitializer.ProvisionResult seed=pending(D,0,0);
            require(provision(D,seed.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED,
                "NO_PHASE_AUTHENTICATED_COMMITTED_PREDECESSOR");
        }
        MessagePreviewMetadataEnvelope.Record predecessor=record();
        long base=nonzero ? 1 : 0, revision=nonzero ? 1 : 0;
        require(predecessor.header.generation==base && predecessor.header.kind==(nonzero
            ? MessagePreviewMetadataEnvelope.Kind.COMMITTED : MessagePreviewMetadataEnvelope.Kind.EMPTY),"NO_PHASE_EXACT_PREDECESSOR");
        if (scenario.equals("no-phase-old-key-absent")) require(keys.remove(predecessor.header.alias)!=null,"NO_PHASE_EXACT_OLD_KEY_ABSENCE_FIXTURE");
        int starts=AtomicFile.starts, minted=generates, deleted=deletes, checked=verifies, inits=credentialInits;
        byte[] predecessorBytes=Files.readAllBytes(journal());
        byte[] marker=Files.readAllBytes(new File(app.root,"native-message-previews-v1/installation-v1.bin").toPath());
        SecretKey originalMetadata=keys.get(metadataAlias), unrelated=keys.get("unrelated.fixture");
        Await cancelled=new Await(); holdEvent="journal-read"; armed=true;
        MessagePreviewVaultFence.Owner tuple=scenario.equals("no-phase-refused")
            ? new MessagePreviewVaultFence.Owner(TUPLE.recipient,TUPLE.session,"bad",2) : TUPLE;
        owner.beginOwned(A,revision,base,CAPTURED,tuple,r -> {
            cancelled.result=r; noPhaseSettled=true; cancelled.done.countDown();
        });
        require(held.await(3,TimeUnit.SECONDS),"NO_PHASE_HELD_INITIAL_READ");
        require(noPhaseInitialRead && AtomicFile.starts==starts && generates==minted && deletes==deleted
            && credentialInits==inits && verifies==checked && Arrays.equals(Files.readAllBytes(journal()),predecessorBytes),
            "NO_PHASE_NO_ATTEMPT_OR_ENTERED_KEY");
        if (scenario.equals("no-phase-foreign-correlation")) {
            Erase foreign=erase(B,revision+1,base,new MessagePreviewVaultFence.Correlation(E,revision));
            require(foreign.get().status==MessagePreviewPristineInitializer.TransitionStatus.STALE_OWNER
                && AtomicFile.starts==starts && generates==minted && deletes==deleted,"NO_PHASE_FOREIGN_NO_MUTATION");
            release.countDown();
            MessagePreviewPristineInitializer.ProvisionResult pending=cancelled.get();
            require(pending.status==MessagePreviewPristineInitializer.ProvisionStatus.PENDING && pending.ticket!=null
                && pending.generation==base+1,"NO_PHASE_FOREIGN_DID_NOT_INVALIDATE_A");
            require(provision(A,pending.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED,
                "NO_PHASE_FOREIGN_ORDINARY_CONTINUATION"); return;
        }
        Erase retired=erase(B,revision+1,base,new MessagePreviewVaultFence.Correlation(A,revision));
        require(cancelled.done.getCount()==1 && retired.done.getCount()==1,"NO_PHASE_NO_EARLY_SETTLEMENT_ACK");
        noPhaseRetirementAdmitted=true;
        require(begin(C,revision+2,base+1,TUPLE).get().status==MessagePreviewPristineInitializer.ProvisionStatus.BUSY,
            "NO_PHASE_SUCCESSOR_BUSY_UNTIL_SETTLEMENT");
        require(erase(E,revision+2,base+2,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.BUSY,
            "NO_PHASE_ONE_OWNED_CONTINUATION");
        require(AtomicFile.starts==starts && generates==minted && deletes==deleted && verifies==checked
            && Arrays.equals(Files.readAllBytes(journal()),predecessorBytes),"NO_PHASE_NO_EFFECTS_WHILE_HELD");
        if (expired) SystemClock.value=10100;
        if (scenario.equals("no-phase-drift")) {
            MessagePreviewMetadataEnvelope.Header h=predecessor.header;
            Files.write(journal(),MessagePreviewMetadataEnvelope.seal(new MessagePreviewMetadataEnvelope.Header(
                h.installation,h.generation,h.kind,h.alias,h.expiresWallMillis,h.wallHighWaterMillis+1,
                h.operationId,h.baseGeneration,h.vaultRevision),predecessor.credentialBytes(),originalMetadata));
        }
        if (scenario.equals("no-phase-missing-metadata")) require(keys.remove(metadataAlias)==originalMetadata,"NO_PHASE_METADATA_LOSS_FIXTURE");
        if (scenario.equals("no-phase-foreign-history")) {
            java.lang.reflect.Field stateField=MessagePreviewPristineInitializer.class.getDeclaredField("initialized"); stateField.setAccessible(true);
            Object state=stateField.get(owner);
            java.lang.reflect.Field acquiringField=state.getClass().getDeclaredField("acquisition"); acquiringField.setAccessible(true);
            Object acquisition=acquiringField.get(state);
            java.lang.reflect.Field programField=acquisition.getClass().getDeclaredField("program"); programField.setAccessible(true);
            MessagePreviewVaultProvisioning.Work actual=(MessagePreviewVaultProvisioning.Work)programField.get(acquisition);
            MessagePreviewVaultFence foreign=new MessagePreviewVaultFence(base); require(foreign.bindContext(CAPTURED),"FOREIGN_HISTORY_FIXTURE_CONTEXT");
            MessagePreviewVaultFence.Operation copied=foreign.begin(A,revision,base,CAPTURED,TUPLE).operation;
            require(copied!=actual.operation && copied.generation==actual.operation.generation,"FOREIGN_HISTORY_REFERENCE_CALIBRATED");
            MessagePreviewVaultProvisioning.Work impostor=new MessagePreviewVaultProvisioning.Work(copied,actual.identity,
                actual.original,actual.admitted,actual.deadline,actual.candidate);
            java.lang.reflect.Field currentField=state.getClass().getDeclaredField("current"); currentField.setAccessible(true);
            Object current=currentField.get(state);
            java.lang.reflect.Field priorField=current.getClass().getDeclaredField("predecessorProgram"); priorField.setAccessible(true);
            synchronized(owner) { priorField.set(current,impostor); }
        }
        release.countDown();
        MessagePreviewPristineInitializer.ProvisionResult abandoned=cancelled.get();
        require(abandoned.status==MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE
            && abandoned.ticket==null && noPhaseSettled,"NO_PHASE_NO_CANCELLED_ACQUISITION_ACK");
        MessagePreviewPristineInitializer.TransitionResult result=retired.get();
        if (scenario.equals("no-phase-foreign-history")) {
            require(result.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && result.generation==null
                && AtomicFile.starts==starts && generates==minted && deletes==deleted
                && Arrays.equals(Files.readAllBytes(journal()),predecessorBytes),"NO_PHASE_FOREIGN_HISTORY_NOT_AUTHORITY"); return;
        }
        if (scenario.equals("no-phase-drift") || scenario.equals("no-phase-missing-metadata")) {
            require(result.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && result.generation==null
                && AtomicFile.starts==starts && generates==minted && deletes==deleted,"NO_PHASE_UNTRUSTED_PREDECESSOR_NO_EFFECTS");
            if (scenario.equals("no-phase-missing-metadata")) require(!keys.containsKey(metadataAlias)
                && Arrays.equals(Files.readAllBytes(journal()),predecessorBytes),"NO_PHASE_NO_METADATA_RECREATION");
            else require(record().header.wallHighWaterMillis==predecessor.header.wallHighWaterMillis+1,"NO_PHASE_DRIFT_NOT_OVERWRITTEN");
            return;
        }
        if (scenario.equals("no-phase-unknown-finish") || scenario.equals("no-phase-unknown-delete")) {
            require(result.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && result.generation==null
                && generates==minted && credentialInits==inits && verifies==checked,"NO_PHASE_UNKNOWN_ACK_NO_EMPTY");
            if (scenario.equals("no-phase-unknown-finish")) require(failFinish && AtomicFile.starts==starts+1 && deletes==deleted
                && Arrays.equals(Files.readAllBytes(journal()),predecessorBytes),"NO_PHASE_UNKNOWN_WRITE_RESIDUE");
            else require(deletes==deleted+1 && AtomicFile.starts==starts+1 && credentialCount()==0
                && record().header.kind==MessagePreviewMetadataEnvelope.Kind.RETIRING,"NO_PHASE_UNKNOWN_DELETE_RESIDUE");
            int effects=AtomicFile.starts, deletedAfter=deletes;
            Erase observed=new Erase(); owner.observeRetirement(B,observed);
            require(observed.get().status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE
                && erase(E,revision+2,base+2,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.UNAVAILABLE
                && AtomicFile.starts==effects && deletes==deletedAfter,"NO_PHASE_UNKNOWN_ACK_NO_REPLAY"); return;
        }
        if (expired) {
            require(result.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && result.generation==null
                && AtomicFile.starts==starts && generates==minted && deletes==deleted
                && Arrays.equals(Files.readAllBytes(journal()),predecessorBytes),"NO_PHASE_ERASE_DEADLINE_NOT_RENEWED");
            return;
        }
        require(result.status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            || (result.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && result.generation==null),
            "NO_PHASE_REAL_RUNTIME_RESULT_NOT_SETUP_REFUSAL");
        require(result.status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED && result.generation==base+2,
            "NO_PHASE_EXACT_EMPTY_RETIREMENT_REQUIRED");
        MessagePreviewMetadataEnvelope.Record empty=record();
        require(empty.header.generation==base+2 && empty.header.baseGeneration==base+1 && empty.header.vaultRevision==revision+1
            && empty.header.operationId.equals(B) && empty.header.installation.equals(installation)
            && empty.header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY && empty.header.alias.isEmpty()
            && empty.header.expiresWallMillis==0 && empty.credentialBytes().length==0,"NO_PHASE_LITERAL_R_EMPTY_NOT_INVENTED_A");
        boolean sawRetiring=false, sawEmpty=false;
        for (MessagePreviewMetadataEnvelope.Header h:noPhaseHeads) {
            require(!h.operationId.equals(A),"NO_PHASE_NEVER_MATERIALIZED_ABANDONED_GENERATION");
            if (h.operationId.equals(B)) {
                require(h.generation==base+2 && h.baseGeneration==base+1 && h.vaultRevision==revision+1
                    && h.expiresWallMillis==0,"NO_PHASE_EXACT_R_LINEAGE");
                if (h.kind==MessagePreviewMetadataEnvelope.Kind.RETIRING) {
                    require(h.alias.equals(predecessor.header.alias),"NO_PHASE_EXACT_PREDECESSOR_ALIAS"); sawRetiring=true;
                } else if (h.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY) sawEmpty=true;
                else require(false,"NO_PHASE_RETIREMENT_ONLY_PHASES");
            }
        }
        require(sawRetiring && sawEmpty && AtomicFile.starts==starts+2,"NO_PHASE_REAL_CHECKED_R_PHASES");
        require(generates==minted && credentialInits==inits && verifies==checked && credentialCount()==0
            && deletes==deleted+(scenario.equals("no-phase-nonzero") ? 1 : 0),"NO_PHASE_DELETE_ONLY_NO_ACQUISITION_AUTHORITY");
        require(keys.get(metadataAlias)==originalMetadata && keys.get("unrelated.fixture")==unrelated
            && Arrays.equals(Files.readAllBytes(new File(app.root,"native-message-previews-v1/installation-v1.bin").toPath()),marker),
            "NO_PHASE_MARKER_METADATA_UNRELATED_PRESERVED");
        int completedStarts=AtomicFile.starts;
        Erase observed=new Erase(); owner.observeRetirement(B,observed);
        require(observed.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && observed.result.generation==base+2 && AtomicFile.starts==completedStarts && generates==minted
            && verifies==checked,"NO_PHASE_COMPLETED_OBSERVATION_READ_ONLY");
        if (scenario.equals("no-phase-zero")) {
            armed=false;
            MessagePreviewPristineInitializer.ProvisionResult next=pending(C,2,2);
            require(provision(C,next.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED
                && record().header.generation==3,"NO_PHASE_SUCCESSOR_WITHOUT_REINITIALIZATION");
            Erase last=erase(D,3,3,null);
            require(last.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
                && last.result.generation==4 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY
                && credentialCount()==0,"NO_PHASE_SUCCESSOR_EXACT_ERASURE");
        }
    }
    private static void heldCase() throws Exception {
        boolean beforeBegin=scenario.equals("unmaterialized") || scenario.equals("held-initial-read")
            || scenario.equals("held-jio-preauthentication");
        MessagePreviewPristineInitializer.ProvisionResult p=beforeBegin ? null : pending(A,0,0);
        holdEvent=scenario.equals("held-generate") ? "credential-generate" : scenario.equals("held-readback") ? "journal-finish"
            : scenario.equals("held-initial-read") ? "journal-read" : scenario.equals("held-jio-preauthentication") ? "jio-preauthentication"
            : scenario.equals("unmaterialized") ? "current"
            : scenario.equals("held-ack") ? "final-current" : "verify";
        preauthStarts=AtomicFile.starts; armed=true;
        Await pending=beforeBegin ? begin(A,0,0,TUPLE) : provision(A,p.ticket);
        require(held.await(3,TimeUnit.SECONDS),"HELD_ENTERED");
        if (scenario.equals("held-jio-preauthentication")) require(actualWritePreauthentication
            && AtomicFile.starts==preauthStarts,"ACTUAL_JIO_WRITE_PREAUTHENTICATION_HELD");
        if (scenario.equals("queue-expired")) SystemClock.value=5100;
        Erase e=erase(B,1,0,new MessagePreviewVaultFence.Correlation(A,0));
        Await successor=begin(C,2,1,TUPLE); require(successor.get().status==MessagePreviewPristineInitializer.ProvisionStatus.BUSY,"NO_SUCCESSOR_WHILE_HELD");
        Erase contender=erase(D,2,2,null);
        require(contender.done.getCount()==0,"ONE_QUEUED_ERASURE");
        require(contender.get().status==MessagePreviewPristineInitializer.TransitionStatus.BUSY,"ONE_QUEUED_ERASURE");
        require(e.done.getCount()==1,"NO_EARLY_ERASURE_ACK");
        if (scenario.equals("queue-expired")) SystemClock.value=15100;
        release.countDown(); require(pending.get().status==MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE,"NO_LATE_ACQUISITION_ACK");
        MessagePreviewPristineInitializer.TransitionResult er=e.get();
        if (scenario.equals("held-jio-preauthentication"))
            require(aStartsAfterPreauthentication==0,"NO_A_START_WRITE_AFTER_JIO_PREAUTH");
        if (scenario.equals("held-jio-preauthentication") || scenario.equals("queue-expired")) {
            require(er.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && er.generation==null,"NO_INVENTED_EMPTY_OR_RENEWAL");
            require(deletes==0 && record().header.generation==(beforeBegin ? 0 : 1),"UNRESOLVED_RESIDUE_RETAINED");
            require(begin(C,2,2,TUPLE).get().status==MessagePreviewPristineInitializer.ProvisionStatus.UNAVAILABLE,"UNCERTAIN_REFUSES_SUCCESSOR");
            require(erase(D,2,2,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.UNAVAILABLE,"UNRESOLVED_CLEANUP_IDENTITY_RETAINED");
            Await observed=new Await(); owner.observeOwned(A,observed);
            require(observed.get().status==MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE
                && observed.result.ticket==null,"UNRESOLVED_HISTORY_OBSERVABLE");
        } else {
            require(er.status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED && er.generation==2,"ORDERED_ERASURE_AFTER_SETTLEMENT");
            require(credentialCount()==0 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY,"NO_STALE_KEY_OR_COMMIT");
            if (beforeBegin) require(generates==1 && verifies==0 && deletes==0,"NO_PHASE_OLD_CASE_ERASURE_ONLY");
        }
    }
    private static MessagePreviewMetadataEnvelope.Record fixtureRecord(long generation, long base, String id,
            long revision, MessagePreviewMetadataEnvelope.Kind kind, String alias) throws Exception {
        return MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(new MessagePreviewMetadataEnvelope.Header(
            installation,generation,kind,alias,0,record().header.wallHighWaterMillis,id,base,revision),new byte[0],keys.get(metadataAlias)),
            installation,keys.get(metadataAlias));
    }
    private static void requestBasis() throws Exception {
        MessagePreviewMetadataEnvelope.Record predecessor=record();
        MessagePreviewVaultFence fence=new MessagePreviewVaultFence(0); require(fence.bindContext(CAPTURED),"BASIS_BOUND_FICTIONAL_CONTEXT");
        MessagePreviewVaultFence.Operation abandoned=fence.begin(A,0,0,CAPTURED,TUPLE).operation;
        MessagePreviewVaultFence.Operation retire=fence.retire(B,1,0,new MessagePreviewVaultFence.Correlation(A,0)).operation;
        MessagePreviewMetadataEnvelope.Record head=fixtureRecord(2,1,B,1,MessagePreviewMetadataEnvelope.Kind.RETIRING,"");
        MessagePreviewJournalIO journal=new MessagePreviewJournalIO(new MessagePreviewAtomicBackend(app));
        MessagePreviewCredentialKeyCustody.Request[] registered=new MessagePreviewCredentialKeyCustody.Request[1];
        MessagePreviewCredentialKeyCustody custody=new MessagePreviewCredentialKeyCustody(app,10123,Thread.currentThread(),installation,journal,r -> {
            if (r!=registered[0] || r.unmaterializedAllocation!=abandoned) throw new Exception("FICTIONAL_UNAVAILABLE");
        });
        MessagePreviewCredentialKeyCustody.Request valid=MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(
            custody,fence,retire,predecessor,abandoned,head,100,10100);
        require(valid.unmaterializedAllocation==abandoned && valid.retainedPredecessor==predecessor
            && valid.expectedHead==head && valid.operation==retire && valid.admittedAtElapsedMillis==100
            && valid.deadlineElapsedMillis==10100,"BASIS_EXACT_IMMUTABLE_REFERENCES");
        if (scenario.equals("basis-ordinary-gap")) {
            boolean refused=false;
            try { new MessagePreviewCredentialKeyCustody.Request(custody,fence,retire,predecessor,head,100,10100); }
            catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused,"ORDINARY_EXACT_BASIS_REQUIRED"); return;
        }
        if (scenario.equals("basis-lineage")) {
            MessagePreviewMetadataEnvelope.Record wrong=fixtureRecord(1,0,D,0,MessagePreviewMetadataEnvelope.Kind.EMPTY,"");
            boolean refused=false;
            try { MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(custody,fence,retire,wrong,abandoned,head,100,10100); }
            catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused,"ONE_UNMATERIALIZED_BASE_REQUIRED");
            refused=false;
            try { MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(custody,fence,retire,wrong,null,head,100,10100); }
            catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused,"NULL_BASIS_NOT_RETIRE_AUTHORITY");
            String other="letscube.nmpv.credential.v1."+installation+"."+E;
            refused=false;
            try { MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(custody,fence,retire,predecessor,abandoned,
                fixtureRecord(2,1,B,1,MessagePreviewMetadataEnvelope.Kind.RETIRING,other),100,10100); }
            catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused,"UNMATERIALIZED_ALIAS_MUST_EQUAL_P"); return;
        }
        if (scenario.equals("basis-no-create")) {
            int reads=AtomicFile.reads, starts=AtomicFile.starts, minted=generates;
            boolean refused=false;
            try { custody.createPendingKey(valid); } catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused && AtomicFile.reads==reads && AtomicFile.starts==starts && generates==minted,"UNMATERIALIZED_BASIS_NEVER_CREATES");
            refused=false;
            try { custody.deleteRetiringKey(valid); } catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused && AtomicFile.reads==reads,"SPENT_BASIS_NOT_REPLAYED");
            MessagePreviewVaultFence acquiring=new MessagePreviewVaultFence(0); require(acquiring.bindContext(CAPTURED),"BASIS_ACQUISITION_FIXTURE_CONTEXT");
            MessagePreviewVaultFence.Operation prior=acquiring.begin(A,0,0,CAPTURED,TUPLE).operation;
            MessagePreviewVaultFence.Operation next=acquiring.begin(B,1,1,CAPTURED,TUPLE).operation;
            MessagePreviewMetadataEnvelope.Record pending=fixtureRecord(2,1,B,1,MessagePreviewMetadataEnvelope.Kind.PENDING,
                "letscube.nmpv.credential.v1."+installation+"."+E);
            refused=false;
            try { MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(custody,acquiring,next,predecessor,prior,pending,100,10100); }
            catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused && AtomicFile.reads==reads && generates==minted,"UNMATERIALIZED_FACTORY_REJECTS_ACQUISITION"); return;
        }
        if (scenario.equals("basis-foreign-gate")) {
            MessagePreviewVaultFence foreign=new MessagePreviewVaultFence(0); require(foreign.bindContext(CAPTURED),"FOREIGN_FICTIONAL_CONTEXT");
            MessagePreviewVaultFence.Operation copy=foreign.begin(A,0,0,CAPTURED,TUPLE).operation;
            MessagePreviewCredentialKeyCustody.Request different=MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(
                custody,fence,retire,predecessor,copy,head,100,10100);
            registered[0]=different;
            boolean refused=false; int reads=AtomicFile.reads;
            try { custody.deleteRetiringKey(different); } catch(MessagePreviewCredentialKeyCustody.Unavailable expected) { refused=true; }
            require(refused && AtomicFile.reads==reads && generates==1 && deletes==0,"FOREIGN_NUMERIC_MATCH_IS_NOT_GATE_AUTHORITY"); return;
        }
        throw new AssertionError("KNOWN_BASIS_SCENARIO");
    }
    private static void repeatedErasure() throws Exception {
        MessagePreviewPristineInitializer.ProvisionResult p=pending(A,0,0);
        require(provision(A,p.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED,"ACTUAL_NONEMPTY_G1");
        Erase first=erase(B,1,1,null);
        require(first.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && first.result.generation==2 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY,"CHECKED_EMPTY_G2");
        int starts=AtomicFile.starts, calls=verifies;
        Erase observed=new Erase(); owner.observeRetirement(B,observed);
        require(observed.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && observed.result.generation==2 && AtomicFile.starts==starts && verifies==calls,"COMPLETED_RETIRE_READ_ONLY_OBSERVATION");
        Erase second=erase(C,2,2,null);
        require(second.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && second.result.generation==3,"CHECKED_EMPTY_G3");
        MessagePreviewMetadataEnvelope.Record head=record();
        require(head.header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY && head.header.generation==3
            && head.header.baseGeneration==2 && head.header.operationId.equals(C) && head.header.vaultRevision==2
            && head.header.alias.isEmpty() && head.credentialBytes().length==0,"LITERAL_COMPLETED_EMPTY_G3");
        starts=AtomicFile.starts;
        Await old=new Await(); owner.observeOwned(A,old);
        require(old.get().status==MessagePreviewPristineInitializer.ProvisionStatus.UNKNOWN && old.result.ticket==null
            && AtomicFile.starts==starts && verifies==calls,"COMPLETED_ACQUISITION_DETACHED_NO_EFFECTS");
        p=pending(D,3,3);
        MessagePreviewPristineInitializer.ProvisionResult next=provision(D,p.ticket).get();
        require(next.status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED && next.generation==4
            && record().header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED && credentialCount()==1,"SUCCESSOR_WITHOUT_REINITIALIZATION");
        Await current=new Await(); owner.observeOwned(D,current);
        require(current.get().status==MessagePreviewPristineInitializer.ProvisionStatus.DORMANT
            && current.result.ticket==null && verifies==2,"SUCCESSOR_DORMANT_OBSERVATION");
        Erase last=erase(E,4,4,null);
        require(last.get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && last.result.generation==5 && credentialCount()==0 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY,"SUCCESSOR_ERASURE_G5");
    }
    private static void risingRefusal() throws Exception {
        MessagePreviewPristineInitializer.ProvisionResult p=pending(A,0,0);
        MessagePreviewPristineInitializer.ProvisionResult result=provision(A,p.ticket).get();
        require(credentialInits==1 && verifies==1,"RISING_REFUSAL_REACHED_KEY_INIT");
        require(result.status==MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE && result.ticket==null
            && generates==1 && credentialCount()==0 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.PENDING,
            "RISING_EXPIRY_OR_REGRESSION_REFUSES_MINT");
    }
    private static void boundaries() throws Exception {
        if (scenario.equals("refused-context-loss")) {
            holdEvent="journal-finish"; armed=true;
            MessagePreviewVaultFence.Owner bad=new MessagePreviewVaultFence.Owner(TUPLE.recipient,TUPLE.session,"bad",2);
            Await a=begin(A,0,0,bad); require(held.await(3,TimeUnit.SECONDS),"REFUSED_ERASURE_ENTERED");
            owner.invalidate(); release.countDown();
            require(a.get().status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_OWNER && a.result.ticket==null
                && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY && generates==1,"REFUSED_ERASURE_SURVIVES_CONTEXT_LOSS"); return;
        }
        if (scenario.equals("unbound")) {
            require(begin(A,0,0,TUPLE).get().status==MessagePreviewPristineInitializer.ProvisionStatus.UNAVAILABLE
                && record().header.generation==0 && generates==1 && verifies==0,"DEFAULT_UNBOUND_REFUSES"); return;
        }
        if (scenario.equals("invalid-owner")) {
            MessagePreviewVaultFence.Owner bad=new MessagePreviewVaultFence.Owner(TUPLE.recipient,TUPLE.session,"bad",2);
            MessagePreviewPristineInitializer.ProvisionResult r=begin(A,0,0,bad).get();
            require(r.status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_OWNER && r.ticket==null && r.generation==1
                && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY && generates==1,"INVALID_OWNER_ERASURE_ONLY"); return;
        }
        if (scenario.equals("empty-retire")) {
            require(erase(A,0,0,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
                && record().header.generation==1 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY,"PRESERVED_EMPTY_ERASURE"); return;
        }
        if (scenario.equals("lost-begin")) {
            CountDownLatch lost=new CountDownLatch(1);
            owner.beginOwned(A,0,0,CAPTURED,TUPLE,r -> { lost.countDown(); throw new IllegalStateException("FICTIONAL_ACK_LOST"); });
            require(lost.await(5,TimeUnit.SECONDS),"ACTUAL_LOST_BEGIN_CALLBACK");
            require(erase(B,1,0,new MessagePreviewVaultFence.Correlation(A,0)).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
                && record().header.generation==2 && verifies==0,"EXACT_LOST_BEGIN_ERASURE");
            Await observed=new Await(); owner.observeOwned(A,observed);
            require(observed.get().ticket==null,"LOST_ACK_OBSERVATION_CANNOT_RESTORE_TICKET"); return;
        }
        MessagePreviewPristineInitializer.ProvisionResult p=pending(A,0,0);
        if (scenario.equals("no-match")) {
            int reads=AtomicFile.reads;
            require(erase(B,100,0,new MessagePreviewVaultFence.Correlation(C,0)).get().status==MessagePreviewPristineInitializer.TransitionStatus.STALE_OWNER
                && AtomicFile.reads==reads && deletes==0,"FOREIGN_CORRELATION_NO_EFFECTS");
            require(provision(A,p.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED,"FOREIGN_DOES_NOT_INVALIDATE"); return;
        }
        if (scenario.equals("invalidate-erase")) {
            owner.invalidate();
            require(erase(B,1,0,new MessagePreviewVaultFence.Correlation(A,0)).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED
                && record().header.generation==2 && verifies==0,"ERASURE_WITHOUT_ACCESS_CONTEXT"); return;
        }
        if (scenario.equals("rejected-context")) {
            MessagePreviewVaultFence.Context next=new MessagePreviewVaultFence.Context(2,CAPTURED.epoch,CAPTURED.recipient,CAPTURED.session,2);
            Await rejected=new Await(); owner.beginOwned(B,0,1,next,TUPLE,rejected);
            require(rejected.get().status==MessagePreviewPristineInitializer.ProvisionStatus.STALE_OWNER,"STALE_INTENT_REFUSED");
            require(provision(A,p.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED,"REJECTED_INTENT_NO_CONTEXT_MUTATION"); return;
        }
        if (scenario.equals("invalidate")) owner.invalidate();
        if (scenario.equals("ticket-deadline")) SystemClock.value=15100;
        if (scenario.equals("clipped-create")) SystemClock.value=14000;
        armed=true; MessagePreviewPristineInitializer.ProvisionResult r=provision(A,p.ticket).get();
        if (scenario.equals("ticket-replay")) {
            require(r.status==MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED,"HEALTHY_FIRST_TICKET");
            require(provision(A,p.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST && verifies==1,"SINGLE_USE_TICKET"); return;
        }
        require(r.status==MessagePreviewPristineInitializer.ProvisionStatus.INCOMPLETE || r.status==MessagePreviewPristineInitializer.ProvisionStatus.UNAVAILABLE
            || r.status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST,"REFUSAL_NO_COMMIT_ACK");
        if (scenario.equals("readback-mismatch")) {
            require(record().header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED && credentialCount()==1,"UNKNOWN_COMMIT_DORMANT_RESIDUE");
            require(erase(B,1,1,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED,"EXACT_COMMIT_ERASURE"); return;
        }
        require(record().header.kind!=MessagePreviewMetadataEnvelope.Kind.COMMITTED,"NO_COMMITTED_AFTER_REFUSAL");
        if (scenario.equals("failed-ticket-replay")) {
            require(provision(A,p.ticket).get().status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST && verifies==1,"FAILED_TICKET_STILL_SINGLE_USE"); return;
        }
        if (scenario.equals("clipped-create")) {
            require(generates==2 && credentialCount()==1,"CLIPPED_CREATE_RETAINS_ENTERED_KEY");
            require(erase(B,1,1,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED,"ERASE_BUDGET_INDEPENDENT_OF_TICKET"); return;
        }
        if (scenario.equals("entered-key-original-rewind")) {
            java.lang.reflect.Field stateField=MessagePreviewPristineInitializer.class.getDeclaredField("initialized"); stateField.setAccessible(true);
            Object state=stateField.get(owner);
            java.lang.reflect.Field acquiringField=state.getClass().getDeclaredField("acquisition"); acquiringField.setAccessible(true);
            Object acquisition=acquiringField.get(state);
            java.lang.reflect.Field programField=acquisition.getClass().getDeclaredField("program"); programField.setAccessible(true);
            MessagePreviewVaultProvisioning.Work work=(MessagePreviewVaultProvisioning.Work)programField.get(acquisition);
            require(work.keyRequestEntered && work.candidateEntered && work.attempts>=2 && record().header.generation==0,
                "ENTERED_KEY_HISTORY_NOT_DERIVED_FROM_OLD_DISK");
            int starts=AtomicFile.starts;
            Erase e=erase(B,1,1,null);
            require(e.get().status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && e.result.generation==null
                && AtomicFile.starts==starts && deletes==0 && credentialCount()==1
                && Arrays.equals(Files.readAllBytes(journal()),originalG0),"ENTERED_KEY_OLD_P_CANNOT_SELECT_NO_PHASE");
        } else if (scenario.equals("fallback") || scenario.equals("drift")) {
            Erase e=erase(B,1,1,null); require(e.get().status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE
                && credentialCount()==1 && deletes==0,"NO_UNKNOWN_HISTORY_DELETE");
        } else if (scenario.equals("phase-rollback")) {
            int starts=AtomicFile.starts;
            require(erase(B,1,1,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE
                && credentialCount()==1 && deletes==0 && AtomicFile.starts==starts,"NO_PHASE_ROLLBACK_REWRITE");
        } else if (scenario.equals("key-loss")) require(erase(B,1,1,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED,"EXACT_MATERIALIZED_ABSENCE");
        else if (scenario.equals("unknown-finish")) require(erase(B,1,1,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED,"KNOWN_ATTEMPTED_PHASE_RECONCILED");
        else if (scenario.equals("expiry-delta")) require(generates==2 && credentialCount()==1,"EXPIRED_ENTERED_KEY_RETAINED");
        else require(generates==1,"NO_MINT_AFTER_BAD_VERIFICATION_OR_DEADLINE");
    }
    private static void liveWall() throws Exception {
        MessagePreviewVaultProvisioning.Work w=new MessagePreviewVaultProvisioning.Work(null,null,record(),100,15100,"");
        w.effectiveWall=1000;
        require(w.advanceWall(200,500)==1100 && w.advanceWall(300,400)==1200,"LITERAL_MONOTONIC_LIVE_WALL");
        require(!w.unexpiredAt(1250,350) && w.unexpiredAt(1251,350),"NO_EXPIRY_EXTENSION_AFTER_WALL_ROLLBACK");
        try { w.advanceWall(299,500); throw new AssertionError("ELAPSED_REGRESSION_REFUSED"); }
        catch(MessagePreviewVaultProvisioning.Unavailable expected) { }
        w.effectiveWall=9007199254740991L;
        try { w.advanceWall(301,500); throw new AssertionError("SAFE_WALL_OVERFLOW_REFUSED"); }
        catch(MessagePreviewVaultProvisioning.Unavailable expected) { }
    }
    public static void main(String[] args) throws Exception {
        try { Class.forName("com.kub.messenger.MessagePreviewVaultProvisioning"); }
        catch (ClassNotFoundException absent) { throw new AssertionError("D3_FEATURE_ABSENT"); }
        if (args[0].equals("feature")) { System.out.println("PASS feature"); return; }
        try {
            scenario=args[0]; Looper.getMainLooper(); app=new App(new File(args[1]));
            require(Security.getProvider("AndroidKeyStore")==null,"ISOLATED_PROVIDER"); Security.insertProviderAt(new ProviderFixture(),1);
            AtomicFile.onEvent=MessagePreviewVaultProvisioningProbe::event;
            owner=MessagePreviewPristineInitializer.getOrCreate(app,new Passive(),scenario.equals("unbound") ? null : new Conditional());
            initialized();
            if (scenario.startsWith("rising-")) SystemClock.ticking=true;
            if (scenario.equals("healthy") || scenario.equals("replace") || scenario.equals("rising-healthy")) positive(scenario.equals("replace"));
            else if (scenario.equals("rising-expiry") || scenario.equals("rising-regression")) risingRefusal();
            else if (scenario.equals("repeat-erase")) repeatedErasure();
            else if (scenario.startsWith("no-phase-")) noPhaseCancellation();
            else if (scenario.startsWith("basis-")) requestBasis();
            else if (scenario.startsWith("held-") || scenario.equals("unmaterialized") || scenario.equals("queue-expired")) heldCase();
            else if (scenario.equals("live-wall")) liveWall();
            else boundaries();
            require((scenario.equals("no-phase-missing-metadata") || keys.containsKey(metadataAlias))
                && keys.containsKey("unrelated.fixture"),"PRESERVED_NONCREDENTIAL_KEYS");
            System.out.println("PASS "+scenario);
        } catch(AssertionError error) { System.err.println("FAIL "+error.getMessage()); System.exit(1); }
        catch(Throwable failure) { System.err.println("FAIL UNEXPECTED_SOURCE_GRAPH"); System.exit(1); }
        finally { if(owner!=null) owner.close(); }
    }
}
