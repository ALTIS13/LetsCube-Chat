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
    private static int generates, deletes, verifies;
    private static App app;
    private static MessagePreviewPristineInitializer owner;
    private static final CountDownLatch held=new CountDownLatch(1), release=new CountDownLatch(1);
    private static boolean armed, heldOnce, failFinish;
    private static boolean credentialVerified;
    private static byte[] originalG0;
    private static byte[] firstTombstone;
    private static void require(boolean value, String tag) { if (!value) throw new AssertionError(tag); }
    private static void event(String name) {
        trace.add(name);
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
        if (armed && scenario.equals("unknown-finish") && name.equals("journal-finish") && !failFinish) {
            failFinish=true; throw new IllegalStateException("FICTIONAL_FINISH_FAILURE");
        }
        if (armed && scenario.equals("fallback") && name.equals("credential-generate")) {
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
            require(deadline==8100 || deadline==15100,"CLIPPED_VERIFY_DEADLINE"); event("verify");
            if (scenario.equals("verify-timeout")) SystemClock.value=deadline;
            long expiry=System.currentTimeMillis()+60000;
            if (scenario.equals("expired") || scenario.equals("failed-ticket-replay")) expiry=1;
            if (scenario.equals("expiry-delta") || scenario.equals("expiry-before-mint")) expiry=System.currentTimeMillis()+1000;
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
        public void engineDeleteEntry(String a) { require(a.startsWith("letscube.nmpv.credential.v1."),"EXACT_CREDENTIAL_DELETE"); deletes++; trace.add("delete:"+a); keys.remove(a); event("delete"); }
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
        private boolean credentialDecrypt;
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
                for (Map.Entry<String,Borrowed> e:keys.entrySet()) if(e.getValue()==k && e.getKey().startsWith("letscube.nmpv.credential.")) credentialDecrypt=true;
            }
        }
        protected void engineInit(int o,Key k,AlgorithmParameters p,SecureRandom r) throws InvalidKeyException,InvalidAlgorithmParameterException { actual.init(o,backing(k),p,r); }
        protected void engineUpdateAAD(byte[] b,int o,int n) { actual.updateAAD(b,o,n); }
        protected byte[] engineUpdate(byte[] b,int o,int n) { return actual.update(b,o,n); }
        protected int engineUpdate(byte[] b,int o,int n,byte[] d,int x) throws ShortBufferException { return actual.update(b,o,n,d,x); }
        protected byte[] engineDoFinal(byte[] b,int o,int n) throws IllegalBlockSizeException,BadPaddingException {
            byte[] result=actual.doFinal(b,o,n);
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
    private static void heldCase() throws Exception {
        boolean beforeBegin=scenario.equals("unmaterialized") || scenario.equals("held-prewrite");
        MessagePreviewPristineInitializer.ProvisionResult p=beforeBegin ? null : pending(A,0,0);
        holdEvent=scenario.equals("held-generate") ? "credential-generate" : scenario.equals("held-readback") ? "journal-finish"
            : scenario.equals("held-prewrite") ? "journal-read" : scenario.equals("unmaterialized") ? "current"
            : scenario.equals("held-ack") ? "final-current" : "verify";
        armed=true;
        Await pending=beforeBegin ? begin(A,0,0,TUPLE) : provision(A,p.ticket);
        require(held.await(3,TimeUnit.SECONDS),"HELD_ENTERED");
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
        if (scenario.equals("unmaterialized") || scenario.equals("held-prewrite") || scenario.equals("queue-expired")) {
            require(er.status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE && er.generation==null,"NO_INVENTED_EMPTY_OR_RENEWAL");
            require(deletes==0 && record().header.generation==(beforeBegin ? 0 : 1),"UNRESOLVED_RESIDUE_RETAINED");
            require(begin(C,2,2,TUPLE).get().status==MessagePreviewPristineInitializer.ProvisionStatus.UNAVAILABLE,"UNCERTAIN_REFUSES_SUCCESSOR");
            require(erase(D,2,2,null).get().status==MessagePreviewPristineInitializer.TransitionStatus.UNAVAILABLE,"UNRESOLVED_CLEANUP_IDENTITY_RETAINED");
        } else {
            require(er.status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED && er.generation==2,"ORDERED_ERASURE_AFTER_SETTLEMENT");
            require(credentialCount()==0 && record().header.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY,"NO_STALE_KEY_OR_COMMIT");
        }
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
        if (scenario.equals("fallback") || scenario.equals("drift")) {
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
            if (scenario.equals("healthy") || scenario.equals("replace")) positive(scenario.equals("replace"));
            else if (scenario.startsWith("held-") || scenario.equals("unmaterialized") || scenario.equals("queue-expired")) heldCase();
            else if (scenario.equals("live-wall")) liveWall();
            else boundaries();
            require(keys.containsKey(metadataAlias) && keys.containsKey("unrelated.fixture"),"PRESERVED_NONCREDENTIAL_KEYS");
            System.out.println("PASS "+scenario);
        } catch(AssertionError error) { System.err.println("FAIL "+error.getMessage()); System.exit(1); }
        catch(Throwable failure) { System.err.println("FAIL UNEXPECTED_SOURCE_GRAPH"); System.exit(1); }
        finally { if(owner!=null) owner.close(); }
    }
}
