package com.kub.messenger;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.system.Os;
import android.util.AtomicFile;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.Certificate;
import java.security.spec.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.*;
import javax.crypto.spec.SecretKeySpec;

// Fictional Android/JCA provider only; actual composed classes, AES-GCM and JVM files execute.
public final class MessagePreviewPristineInitializerProbe {
    private static final Map<String, SecretKey> keys = new LinkedHashMap<>();
    private static final List<String> trace = Collections.synchronizedList(new ArrayList<>());
    private static String scenario, generatedAlias;
    private static int scans, cleanEnds, inits, generates, contains, lookups;
    private static int finalContextReads;
    private static KeyGenParameterSpec policy;
    private static final CountDownLatch held = new CountDownLatch(1), release = new CountDownLatch(1);
    private static OwnedContext context;
    private static Authority authority;
    private static MessagePreviewPristineInitializer owner;
    private static final class OwnedContext extends Context {
        final File root; final UserManager manager = new UserManager();
        final ApplicationInfo info = new ApplicationInfo();
        boolean dp;
        OwnedContext(File root) { this.root=root; }
        public Context getApplicationContext() { return this; }
        public boolean isDeviceProtectedStorage() { return dp; }
        public File getNoBackupFilesDir() { return root; }
        public Object getSystemService(String name) { return manager; }
        public <T> T getSystemService(Class<T> type) {
            if ((scenario.equals("held-final-context") || scenario.equals("close-final-context"))
                && AtomicFile.reads == 2 && ++finalContextReads == 2) {
                held.countDown();
                try { require(release.await(5,TimeUnit.SECONDS),"FIXTURE_RELEASE"); }
                catch(InterruptedException failure) { throw new AssertionError("FIXTURE_INTERRUPTED"); }
            }
            return type.cast(manager);
        }
        public ApplicationInfo getApplicationInfo() { return info; }
    }
    private static final class Authority implements MessagePreviewInitializationGate.ForegroundAuthority {
        volatile Object current = new Object();
        public Object capture() { return current; }
        public boolean isCurrent(Object captured) { return captured != null && captured == current; }
    }
    public static final class FictionalProvider extends Provider {
        private static final long serialVersionUID = 1L;
        FictionalProvider() {
            super("AndroidKeyStore", "1.0", "FICTIONAL SOURCE TEST ONLY");
            put("KeyStore.AndroidKeyStore", Store.class.getName());
            put("KeyGenerator.AES", Generator.class.getName());
            put("SecretKeyFactory.AES", Factory.class.getName());
        }
    }
    private static void event(String name) {
        trace.add(name);
        if ((scenario.equals("held-generate") || scenario.equals("close-held")) && name.equals("generate")
            || scenario.equals("held-reader") && name.equals("getKey")
            || scenario.equals("held-journal") && name.equals("journal-finish")) {
            held.countDown();
            try { require(release.await(5, TimeUnit.SECONDS), "FIXTURE_RELEASE"); }
            catch (InterruptedException failure) { throw new AssertionError("FIXTURE_INTERRUPTED"); }
        }
        if (scenario.equals("late-before-init") && name.startsWith("close:") && name.endsWith(context.root.getName())) {
            keys.put("letscube.nmpv.future.foreign", new SecretKeySpec(new byte[32], "AES"));
        }
        if (scenario.equals("late-before-generate") && name.equals("generator-init")) {
            keys.put("letscube.nmpv.other", new SecretKeySpec(new byte[32], "AES"));
        }
        if ((scenario.equals("alias-before-init") && cleanEnds == 2 || scenario.equals("alias-before-generate") && cleanEnds == 3)
            && name.equals("clean-end")) {
            try {
                String installation=MessagePreviewInstallationMarker.decode(Files.readAllBytes(marker().toPath()));
                keys.put("letscube.nmpv.metadata.v1."+installation,new SecretKeySpec(new byte[32],"AES"));
            } catch(Exception failure) { throw new AssertionError("FIXTURE_ALIAS"); }
        }
        if (scenario.equals("expired-return") && name.equals("generate")) SystemClock.value=10_100;
        if (scenario.equals("locked-return") && name.equals("getKey")) context.manager.unlocked=false;
        if (scenario.equals("post-extra") && name.equals("journal-read") && AtomicFile.reads == 2) {
            try { Files.write(new File(namespace(), "extra").toPath(), new byte[0]); }
            catch (IOException failure) { throw new AssertionError("FIXTURE_WRITE"); }
        }
        if (scenario.equals("post-marker") && name.equals("journal-read") && AtomicFile.reads == 2) {
            try { byte[] bytes=Files.readAllBytes(marker().toPath()); bytes[12]^=1; Files.write(marker().toPath(),bytes); }
            catch (IOException failure) { throw new AssertionError("FIXTURE_WRITE"); }
        }
        if (scenario.equals("wrong-g0") && name.equals("journal-read") && AtomicFile.reads == 2) {
            try {
                String installation=MessagePreviewInstallationMarker.decode(Files.readAllBytes(marker().toPath()));
                MessagePreviewMetadataEnvelope.Record old=MessagePreviewMetadataEnvelope.open(Files.readAllBytes(journal().toPath()),installation,keys.get(generatedAlias));
                MessagePreviewMetadataEnvelope.Header changed=new MessagePreviewMetadataEnvelope.Header(installation,1,
                    MessagePreviewMetadataEnvelope.Kind.EMPTY,"",0,old.header.wallHighWaterMillis,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",0,0);
                Files.write(journal().toPath(),MessagePreviewMetadataEnvelope.seal(changed,new byte[0],keys.get(generatedAlias)));
            } catch(Exception failure) { throw new AssertionError("FIXTURE_AUTHENTICATED_G1"); }
        }
    }
    public static final class Store extends KeyStoreSpi {
        public void engineLoad(InputStream input, char[] password) { require(input == null && password == null,"LOAD_ONLY"); event("load"); }
        public Enumeration<String> engineAliases() {
            scans++; event("aliases");
            Enumeration<String> names=Collections.enumeration(new ArrayList<>(keys.keySet()));
            return new Enumeration<String>() {
                public boolean hasMoreElements() { boolean more=names.hasMoreElements(); if (!more) { cleanEnds++; event("clean-end"); } return more; }
                public String nextElement() { return names.nextElement(); }
            };
        }
        public boolean engineContainsAlias(String alias) { contains++; event("contains"); return keys.containsKey(alias); }
        public Key engineGetKey(String alias, char[] password) { lookups++; event("getKey"); require(alias.equals(generatedAlias),"ONLY_OWN_KEY_DETAILS"); return keys.get(alias); }
        public void engineSetKeyEntry(String a, Key k, char[] p, Certificate[] c) { throw new AssertionError("NO_IMPORT"); }
        public void engineSetKeyEntry(String a, byte[] k, Certificate[] c) { throw new AssertionError("NO_IMPORT"); }
        public void engineSetCertificateEntry(String a, Certificate c) { throw new AssertionError("NO_IMPORT"); }
        public void engineDeleteEntry(String a) { throw new AssertionError("NO_DELETE"); }
        public void engineStore(OutputStream o, char[] p) { throw new AssertionError("NO_STORE_EXPORT"); }
        public Certificate[] engineGetCertificateChain(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public Certificate engineGetCertificate(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public Date engineGetCreationDate(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public int engineSize() { throw new AssertionError("NO_UNBOUNDED_SIZE"); }
        public boolean engineIsKeyEntry(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public boolean engineIsCertificateEntry(String a) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
        public String engineGetCertificateAlias(Certificate c) { throw new AssertionError("NO_UNRELATED_DETAILS"); }
    }
    public static final class Generator extends KeyGeneratorSpi {
        protected void engineInit(SecureRandom r) { throw new AssertionError("EXACT_POLICY_REQUIRED"); }
        protected void engineInit(int size, SecureRandom r) { throw new AssertionError("EXACT_POLICY_REQUIRED"); }
        protected void engineInit(AlgorithmParameterSpec spec, SecureRandom r) {
            require(spec instanceof KeyGenParameterSpec, "ANDROID_POLICY"); policy=(KeyGenParameterSpec) spec; inits++; event("generator-init");
        }
        protected SecretKey engineGenerateKey() {
            generates++; event("generate"); generatedAlias=policy.alias;
            SecretKey key=new SecretKeySpec(new byte[32], "AES"); keys.put(generatedAlias,key); return key;
        }
    }
    public static final class Factory extends SecretKeyFactorySpi {
        protected KeySpec engineGetKeySpec(SecretKey key, Class<?> requested) {
            require(key == keys.get(generatedAlias) && requested == KeyInfo.class,"REAL_READER_POLICY");
            KeyInfo info=new KeyInfo(); info.alias=generatedAlias; return info;
        }
        protected SecretKey engineGenerateSecret(KeySpec spec) { throw new AssertionError("NO_IMPORT"); }
        protected SecretKey engineTranslateKey(SecretKey key) { throw new AssertionError("NO_FALLBACK"); }
    }
    private static final class Await implements MessagePreviewPristineInitializer.Completion {
        final CountDownLatch done=new CountDownLatch(1);
        volatile MessagePreviewPristineInitializer.InitResult result;
        public void complete(MessagePreviewPristineInitializer.InitResult result) { this.result=result; done.countDown(); }
        MessagePreviewPristineInitializer.InitResult get() throws Exception { require(done.await(5,TimeUnit.SECONDS),"FINITE_COMPLETION"); return result; }
    }
    private static void require(boolean value,String oracle) { if (!value) throw new AssertionError(oracle); }
    private static File namespace() { return new File(context.root,"native-message-previews-v1"); }
    private static File marker() { return new File(namespace(),"installation-v1.bin"); }
    private static File journal() { return new File(namespace(),"journal-v1.bin"); }
    private static void refused(MessagePreviewPristineInitializer.InitResult result,String oracle) {
        require(result.status == MessagePreviewPristineInitializer.Status.UNAVAILABLE && result.generation == null,oracle);
    }
    private static MessagePreviewPristineInitializer.InitResult start() throws Exception {
        Await result=new Await(); owner.initializeExplicit(result); return result.get();
    }
    private static void healthy() throws Exception {
        MessagePreviewPristineInitializer.InitResult result=start();
        require(result.status == MessagePreviewPristineInitializer.Status.INITIALIZED_EMPTY_G0 && Long.valueOf(0).equals(result.generation),"ACTUAL_G0_REQUIRED");
        String installation=MessagePreviewInstallationMarker.decode(Files.readAllBytes(marker().toPath()));
        require(generatedAlias.equals("letscube.nmpv.metadata.v1."+installation),"EXACT_METADATA_ALIAS");
        require(policy.size == 256 && policy.purposes == 3 && Arrays.equals(policy.modes,new String[]{"GCM"})
            && Arrays.equals(policy.paddings,new String[]{"NoPadding"}) && policy.random && !policy.auth,"EXACT_CREATION_POLICY");
        MessagePreviewMetadataEnvelope.Record record=MessagePreviewMetadataEnvelope.open(Files.readAllBytes(journal().toPath()),installation,keys.get(generatedAlias));
        MessagePreviewMetadataEnvelope.Header h=record.header;
        require(h.generation == 0 && h.kind == MessagePreviewMetadataEnvelope.Kind.EMPTY && h.installation.equals(installation)
            && h.alias.equals("") && h.operationId.equals("") && h.baseGeneration == 0 && h.vaultRevision == 0
            && h.expiresWallMillis == 0 && h.wallHighWaterMillis > 0 && record.credentialBytes().length == 0,"LITERAL_EMPTY_G0");
        require(scans == 3 && cleanEnds == 3 && contains == 2 && inits == 1 && generates == 1 && lookups == 1,"THREE_FULL_SCANS_TWO_ABSENCE_BOUNDARIES");
        require(trace.indexOf("clean-end") < trace.indexOf("mkdir:448") && trace.indexOf("generate") < trace.indexOf("getKey")
            && trace.indexOf("getKey") < trace.indexOf("journal-start"),"MARKER_KEY_READER_JOURNAL_ORDER");
        require(keys.containsKey("unrelated") && keys.size() == 2,"UNRELATED_PRESERVED");
        require(MessagePreviewPristineInitializer.getOrCreate(context,authority) == owner,"ONE_RETAINED_OWNER");
        refused(start(),"NO_INITIALIZATION_REPLAY");
    }
    private static void negative() throws Exception {
        refused(start(),"CURRENT_COMPOSITION_REFUSED");
        if (scenario.equals("initial-owned")) require(!namespace().exists() && generates == 0,"INVENTORY_BEFORE_RESERVATION");
        if (scenario.startsWith("late-before")) require(marker().length() == 28 && generates == 0 && !journal().exists(),"LATE_PREFIX_NO_MINT_RESIDUE");
        if (scenario.startsWith("alias-before")) require(marker().length() == 28 && generates == 0 && !journal().exists()
            && inits == (scenario.equals("alias-before-init") ? 0 : 1),"EXACT_ALIAS_AT_BOTH_BOUNDARIES");
        if (scenario.equals("expired-return") || scenario.equals("locked-return")) require(marker().length() == 28 && generates == 1 && !journal().exists(),"STALE_PLATFORM_RETURN_NO_NEXT_STAGE");
        if (scenario.equals("journal-failure")) require(marker().exists() && keys.size() == 2 && !journal().exists(),"FAILED_JOURNAL_RESIDUE_NO_SUCCESS");
        if (scenario.startsWith("post-")) require(journal().exists() && marker().exists(),"POST_G0_REFUSAL_PRESERVES_RESIDUE");
    }
    private static void heldCase() throws Exception {
        Await old=new Await(); owner.initializeExplicit(old);
        require(held.await(5,TimeUnit.SECONDS),"ACTUAL_HELD_PLATFORM_CALL");
        refused(start(),"HELD_BUSY_NO_QUEUE");
        if (scenario.equals("close-held")) owner.close(); else owner.invalidate();
        refused(start(),"HELD_SLOT_NOT_RELEASED_BY_RETIREMENT");
        require(old.done.getCount() == 1,"NO_PREEMPTED_COMPLETION");
        release.countDown(); refused(old.get(),"LATE_COMPLETION_NO_SUCCESS");
        require(marker().exists() && keys.size() == 2,"LATE_RESIDUE_RETAINED");
        require(scenario.equals("held-journal") == journal().exists(),"NO_STAGE_AFTER_STALE_RETURN");
        if (scenario.equals("held-generate") || scenario.equals("close-held")) require(lookups == 0,"NO_READER_AFTER_STALE_GENERATE");
        if (scenario.equals("held-reader")) require(trace.subList(trace.indexOf("getKey")+1,trace.size()).stream().noneMatch(s->s.startsWith("lstat:")),"NO_BACKEND_AFTER_STALE_READER");
        if (scenario.equals("held-journal")) require(AtomicFile.reads == 1,"NO_OWNER_READ_AFTER_STALE_WRITE");
        refused(start(),"POST_EFFECT_NO_RETRY");
    }
    private static void finalContext() throws Exception {
        Await old=new Await(); owner.initializeExplicit(old);
        require(held.await(5,TimeUnit.SECONDS),"HELD_FINAL_PLATFORM_READ");
        CountDownLatch retired=new CountDownLatch(1);
        Thread retirement=new Thread(()->{ if(scenario.equals("close-final-context")) owner.close(); else owner.invalidate(); retired.countDown(); });
        retirement.start();
        boolean prompt=retired.await(400,TimeUnit.MILLISECONDS);
        if(!prompt) { release.countDown(); retirement.join(2000); throw new AssertionError("MEMORY_RETIREMENT_PROMPT"); }
        refused(start(),"FINAL_HELD_SLOT_NOT_REUSED");
        require(old.done.getCount()==1,"FINAL_READ_NOT_PREEMPTED");
        release.countDown(); refused(old.get(),"NO_STALE_FINAL_ACK");
        require(journal().exists() && marker().exists() && keys.size()==2,"FINAL_READ_RESIDUE_RETAINED");
        retirement.join(2000); require(!retirement.isAlive(),"FINITE_RETIREMENT_THREAD");
    }
    private static void factory() throws Exception {
        try { MessagePreviewPristineInitializer.getOrCreate(context,new Authority()); throw new AssertionError("FOREIGN_ISSUER_REFUSED"); }
        catch (MessagePreviewPristineInitializer.Unavailable expected) { }
        AtomicReference<Throwable> failure=new AtomicReference<>();
        Thread foreign=new Thread(() -> {
            try { MessagePreviewPristineInitializer.getOrCreate(context,authority); failure.set(new AssertionError("MAIN_FACTORY_ONLY")); }
            catch (MessagePreviewPristineInitializer.Unavailable expected) { }
        }); foreign.start(); foreign.join(2000); require(!foreign.isAlive() && failure.get() == null,"MAIN_FACTORY_ONLY");
        context.info.uid=10124;
        try { MessagePreviewPristineInitializer.getOrCreate(context,authority); throw new AssertionError("EXACT_UID_REFUSED"); }
        catch (MessagePreviewPristineInitializer.Unavailable expected) { }
        context.info.uid=10123; owner.close();
        try { MessagePreviewPristineInitializer.getOrCreate(context,authority); throw new AssertionError("CLOSED_OWNER_NOT_REPLACED"); }
        catch (MessagePreviewPristineInitializer.Unavailable expected) { require(expected.getCause()==null && expected.getStackTrace().length==0,"FIXED_REFUSAL"); }
    }
    private interface Checked { void run() throws Exception; }
    private static void markerRefused(Checked action,String oracle) throws Exception {
        try { action.run(); }
        catch (MessagePreviewAtomicBackend.MarkerUnavailable expected) { return; }
        throw new AssertionError(oracle);
    }
    private static void markerPhases() throws Exception {
        MessagePreviewInitializationGate[] gate=new MessagePreviewInitializationGate[1];
        MessagePreviewInitializationGate.Permit[] permit=new MessagePreviewInitializationGate.Permit[1];
        AtomicReference<Throwable> failure=new AtomicReference<>();
        Thread worker=new Thread(()->{
            try {
                gate[0].consume(permit[0]);
                MessagePreviewAtomicBackend.MarkerIO io=new MessagePreviewAtomicBackend.MarkerIO(context,gate[0],permit[0]);
                MessagePreviewAtomicBackend.MarkerReservation r=io.reserve();
                markerRefused(()->io.requireCurrentAfterInitialJournal(r),"POST_BASE_REQUIRED");
                Files.write(journal().toPath(),new byte[]{1});
                markerRefused(()->io.requireCurrent(r),"INITIAL_MARKER_ONLY_UNCHANGED");
                io.requireCurrentAfterInitialJournal(r); // Raw phase only, NOT authenticated G0 authority.
                for(String extra:new String[]{"journal-v1.bin.new","journal-v1.bin.bak","other"}) {
                    File file=new File(namespace(),extra); Files.write(file.toPath(),new byte[0]);
                    markerRefused(()->io.requireCurrentAfterInitialJournal(r),"POST_EXACT_CHILDREN"); Files.delete(file.toPath());
                }
                for(int size:new int[]{0,16385}) {
                    Files.write(journal().toPath(),new byte[size]);
                    markerRefused(()->io.requireCurrentAfterInitialJournal(r),"POST_BOUNDED_BASE");
                }
                Files.write(journal().toPath(),new byte[]{1});
                Os.owners.put(journal().getPath(),10124);
                markerRefused(()->io.requireCurrentAfterInitialJournal(r),"POST_OWNED_BASE"); Os.owners.clear();
                Os.types.put(journal().getPath(),0120000);
                markerRefused(()->io.requireCurrentAfterInitialJournal(r),"POST_REGULAR_BASE"); Os.types.clear();
                markerRefused(()->io.requireCurrentAfterInitialJournal(null),"POST_EXACT_RESERVATION");
                io.requireCurrentAfterInitialJournal(r);
                gate[0].invalidate(); markerRefused(()->io.requireCurrentAfterInitialJournal(r),"POST_CURRENT_REQUIRED");
                gate[0].settleFailure(permit[0]);
            } catch(Throwable caught) { failure.set(caught); }
        });
        gate[0]=new MessagePreviewInitializationGate(authority,SystemClock::elapsedRealtime,Thread.currentThread(),worker);
        permit[0]=gate[0].admit(gate[0].capture()); worker.start(); worker.join(5000);
        require(!worker.isAlive(),"FINITE_PHASE_WORKER");
        if(failure.get()!=null) throw new AssertionError(failure.get().getMessage());
    }
    public static void main(String[] args) throws Exception {
        scenario=args[0]; Looper.getMainLooper();
        context=new OwnedContext(new File(args[1])); authority=new Authority();
        keys.put("unrelated",new SecretKeySpec(new byte[32],"AES"));
        Security.addProvider(new FictionalProvider()); Os.onEvent=MessagePreviewPristineInitializerProbe::event;
        AtomicFile.onEvent=MessagePreviewPristineInitializerProbe::event;
        if (scenario.equals("initial-owned")) keys.put("letscube.nmpv.future",new SecretKeySpec(new byte[32],"AES"));
        if (scenario.equals("journal-failure")) AtomicFile.startThrows=true;
        owner=MessagePreviewPristineInitializer.getOrCreate(context,authority);
        try {
            if (scenario.equals("healthy")) healthy();
            else if(scenario.equals("marker-phases")) markerPhases();
            else if(scenario.equals("held-final-context") || scenario.equals("close-final-context")) finalContext();
            else if (scenario.startsWith("held-") || scenario.equals("close-held")) heldCase();
            else if (scenario.equals("factory")) factory();
            else negative();
            Os.assertClosed(); System.out.println("PASS "+scenario);
        } finally { release.countDown(); owner.close(); }
    }
}
