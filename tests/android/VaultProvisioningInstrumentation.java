package com.kub.messenger;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.os.UserManager;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.SecretKey;

// Offline self-target composition only. Fictional Authority is NOT Task5/production authority.
public final class VaultProvisioningInstrumentation extends Instrumentation {
    static final String PACKAGE = "com.letscube.qa.previewvault20261010r2";
    static final String[] FLAGS = {
        "arguments_checked", "uid_owned", "ce_unlocked", "actual_application",
        "actual_main_entry", "actual_resumed_issuer", "single_owner", "marker_checked",
        "metadata_policy", "authenticated_empty_g0", "pending_g1", "committed_g1",
        "fictional_authority_exact", "dormant_g1", "reader_loaded", "decrypt_match",
        "wrong_owner_mismatch", "ticket_single_use", "retired_empty_g2", "credential_key_absent",
        "missing_key_refused", "metadata_marker_retained", "old_ticket_refused",
        "repeat_init_refused", "no_key_recreated", "phase_completed", "owner_invalidated",
        "owner_recreation_refused", "activity_retired", "activity_destroyed", "issuer_invalidated", "callbacks_removed", "pass"
    };
    private static final AtomicBoolean INVOKED = new AtomicBoolean();
    private static final long BUDGET = 45_000, CLEANUP_RESERVE = 3_000;
    private static final long CLEANUP_WAIT = 750;
    private static final String FICTIONAL_ACCESS = "offline-fictional-vault-access-not-a-token";
    private final Object state = new Object();
    private final boolean[] flags = new boolean[FLAGS.length];
    private final int processId = Process.myPid();
    private final Issuer issuer = new Issuer();
    private final FictionalAuthority authority = new FictionalAuthority();
    private final CountDownLatch resumed = new CountDownLatch(1), retired = new CountDownLatch(1), destroyed = new CountDownLatch(1);
    private volatile boolean live, registered;
    private volatile long deadline;
    private int uid;
    private volatile Application application;
    private volatile VaultProvisioningProbeActivity started;
    private volatile MessagePreviewPristineInitializer owner;
    private volatile Object phaseSnapshot;
    private MessagePreviewVaultFence.Context captured;
    private MessagePreviewVaultFence.Owner fictionalOwner;
    private String beginId;

    private static final class Refused extends Exception {
        private static final long serialVersionUID = 1L;
        Refused() { super("UNAVAILABLE", null, false, false); }
    }
    private interface Action { void run() throws Exception; }
    private interface ProvisionAction {
        void run(MessagePreviewPristineInitializer.ProvisionCompletion completion);
    }
    private static void require(boolean value) throws Refused { if (!value) throw new Refused(); }

    @Override public void onCreate(Bundle arguments) {
        try {
            require(INVOKED.compareAndSet(false, true));
            require(arguments != null && arguments.keySet().size() == 2
                && arguments.containsKey("phase") && arguments.containsKey("expected_uid"));
            Object suppliedPhase = arguments.get("phase"), suppliedUid = arguments.get("expected_uid");
            require(suppliedPhase instanceof String && "COMPOSE".equals(suppliedPhase) && suppliedUid instanceof String);
            String expected = (String) suppliedUid;
            require(expected != null && expected.matches("[1-9][0-9]{0,8}"));
            uid = Integer.parseInt(expected);
            flags[0] = true; live = true;
        } catch (Exception refused) { live = false; }
        start();
    }

    @Override public void onStart() {
        long now = SystemClock.elapsedRealtime();
        deadline = now >= 0 && now <= Long.MAX_VALUE - BUDGET ? now + BUDGET : 0;
        ExecutorService observer = Executors.newSingleThreadExecutor();
        Future<?> work = null;
        boolean completed = false;
        try {
            alive();
            work = observer.submit(new Runnable() {
                @Override public void run() {
                    try { compose(); mark("phase_completed"); }
                    catch (Exception refused) { /* Fixed unavailable, never print platform details. */ }
                }
            });
            while (true) {
                long left = remaining();
                try { work.get(Math.min(left, 100), TimeUnit.MILLISECONDS); break; }
                catch (TimeoutException waiting) { /* Local wait only; no native/IPC retries. */ }
            }
            alive(); completed = true;
        } catch (Exception refused) { /* Partial state is retained, never reset or repaired. */ }
        finally {
            VaultProvisioningProbeActivity.disallowLaunch();
            synchronized (state) { live = false; }
            authority.invalidate();
            MessagePreviewPristineInitializer retained = owner;
            if (retained != null) {
                retained.invalidate(); retained.close(); setFinal("owner_invalidated", true);
            }
            if (work != null) work.cancel(false);
            observer.shutdown();
            disposeMain();
            boolean pass = completed;
            synchronized (state) {
                for (int i = 0; i < flags.length - 1; i++) pass &= flags[i];
                pass &= deadline > 0 && SystemClock.elapsedRealtime() < deadline;
                flags[flags.length - 1] = pass;
            }
            Bundle result = new Bundle();
            result.putString("nmpv_vault", "NMPV_VAULT " + booleanJson());
            if (processId > 0) result.putInt("nmpv_vault_pid", processId);
            addResults(result);
            finish(pass ? -1 : 0, new Bundle());
        }
    }

    private String booleanJson() {
        synchronized (state) {
            StringBuilder json = new StringBuilder("{");
            for (int i = 0; i < FLAGS.length; i++) {
                if (i > 0) json.append(',');
                json.append('"').append(FLAGS[i]).append("\":").append(flags[i]);
            }
            return json.append('}').toString();
        }
    }
    private void setFinal(String flag, boolean value) {
        synchronized (state) {
            for (int i = 0; i < FLAGS.length; i++) if (FLAGS[i].equals(flag)) { flags[i] = value; return; }
        }
    }
    private void mark(String flag) throws Refused { synchronized (state) { alive(); setFinal(flag, true); } }
    private boolean memoryCurrent() {
        return live && deadline > 0 && SystemClock.elapsedRealtime() < deadline - CLEANUP_RESERVE
            && (phaseSnapshot == null || issuer.isCurrent(phaseSnapshot));
    }
    private void alive() throws Refused { require(memoryCurrent()); }
    private long remaining() throws Refused {
        alive(); long left = deadline - CLEANUP_RESERVE - SystemClock.elapsedRealtime(); require(left > 0); return left;
    }
    private void await(CountDownLatch done, long cap) throws Exception {
        require(done.await(Math.min(cap, remaining()), TimeUnit.MILLISECONDS)); alive();
    }
    private void main(final Action action) throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final boolean[] ok = {false};
        require(new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() {
                try {
                    alive(); require(Looper.myLooper() == Looper.getMainLooper());
                    action.run(); alive(); ok[0] = true;
                } catch (Exception refused) { /* No exception crosses the observer boundary. */ }
                finally { done.countDown(); }
            }
        }));
        await(done, 5_000); require(ok[0]);
    }
    private void contextCurrent() throws Exception {
        alive(); Application app = application;
        require(app != null && app.getApplicationContext() == app && PACKAGE.equals(app.getPackageName())
            && app.getApplicationInfo().uid == uid && Process.myUid() == uid && !app.isDeviceProtectedStorage());
        UserManager manager = app.getSystemService(UserManager.class);
        require(manager != null && manager.isUserUnlocked()); alive();
    }

    // Real lifecycle callbacks, not a synthetic foreground handle or Context/clock substitute.
    private final class Issuer implements Application.ActivityLifecycleCallbacks,
            MessagePreviewInitializationGate.ForegroundAuthority {
        private VaultProvisioningProbeActivity active;
        private long epoch;
        private boolean closed;
        private final class Snapshot {
            final Issuer origin = Issuer.this;
            final VaultProvisioningProbeActivity activity;
            final long revision;
            Snapshot(VaultProvisioningProbeActivity activity, long revision) { this.activity = activity; this.revision = revision; }
        }
        @Override public Object capture() throws Exception {
            require(Looper.myLooper() == Looper.getMainLooper()); contextCurrent();
            synchronized (this) {
                require(!closed && active != null && active.isProbeResumed());
                return new Snapshot(active, epoch);
            }
        }
        @Override public synchronized boolean isCurrent(Object value) {
            if (!(value instanceof Issuer.Snapshot)) return false;
            Snapshot snapshot = (Snapshot) value;
            return !closed && live && active != null && snapshot.origin == this
                && snapshot.activity == active && snapshot.revision == epoch;
        }
        void close() { synchronized (this) { closed = true; active = null; } }
        private void retire(Activity activity) {
            boolean changed;
            synchronized (this) {
                changed = active == activity && active != null;
                if (changed) { active = null; if (epoch == Long.MAX_VALUE) closed = true; else epoch++; }
            }
            MessagePreviewPristineInitializer retained = owner;
            if (changed && retained != null) retained.invalidate();
            if (changed && activity == started) retired.countDown();
        }
        @Override public void onActivityCreated(Activity activity, Bundle bundle) {
            if (activity.getClass() != VaultProvisioningProbeActivity.class) return;
            if (started == null) started = (VaultProvisioningProbeActivity) activity;
            else if (started != activity) { close(); activity.finish(); }
            if (!live) activity.finish();
        }
        @Override public void onActivityResumed(Activity activity) {
            try {
                require(Looper.myLooper() == Looper.getMainLooper()); contextCurrent();
                require(activity == started && activity.getClass() == VaultProvisioningProbeActivity.class
                    && activity.getApplication() == application && ((VaultProvisioningProbeActivity) activity).isProbeResumed());
                synchronized (this) {
                    require(!closed && epoch < Long.MAX_VALUE); active = (VaultProvisioningProbeActivity) activity; epoch++;
                }
                resumed.countDown();
            } catch (Exception refused) { close(); MessagePreviewPristineInitializer retained = owner; if (retained != null) retained.invalidate(); }
        }
        @Override public void onActivityPrePaused(Activity activity) { retire(activity); }
        @Override public void onActivityPreStopped(Activity activity) { retire(activity); }
        @Override public void onActivityPreDestroyed(Activity activity) { retire(activity); }
        @Override public void onActivityPaused(Activity activity) { retire(activity); }
        @Override public void onActivityStopped(Activity activity) { retire(activity); }
        @Override public void onActivityDestroyed(Activity activity) {
            retire(activity); if (activity == started && activity != null) destroyed.countDown();
        }
        @Override public void onActivityStarted(Activity activity) { }
        @Override public void onActivitySaveInstanceState(Activity activity, Bundle bundle) { }
    }

    private final class FictionalAuthority implements MessagePreviewVaultProvisioning.Authority {
        private MessagePreviewVaultProvisioning.Identity exact;
        private volatile boolean invalidated;
        private boolean verified;
        private long expiry;
        void invalidate() { invalidated = true; }
        @Override public synchronized void requireCurrent(MessagePreviewVaultProvisioning.Identity identity) throws Exception {
            alive(); require(!invalidated && phaseSnapshot != null && issuer.isCurrent(phaseSnapshot));
            require(identity != null && identity.context == captured && identity.owner == fictionalOwner
                && beginId.equals(identity.operationId) && identity.vaultRevision == 1
                && identity.baseGeneration == 0 && identity.generation == 1);
            if (exact == null) exact = identity; else require(exact == identity);
        }
        @Override public MessagePreviewVaultProvisioning.Verification verify(
                MessagePreviewVaultProvisioning.Identity identity, String access, long until) throws Exception {
            // Only the current-aware overload is allowed to mint this fictional verification.
            throw new Refused();
        }
        @Override public synchronized MessagePreviewVaultProvisioning.Verification verify(
                MessagePreviewVaultProvisioning.Identity identity, String access, long until,
                MessagePreviewVaultProvisioning.Current current) throws Exception {
            requireCurrent(identity); require(current != null); current.requireCurrent();
            long now = SystemClock.elapsedRealtime(), wall = System.currentTimeMillis();
            require(!verified && FICTIONAL_ACCESS.equals(access) && now >= 0 && until > now
                && until - now <= 8_000 && MessagePreviewVerificationState.safe(wall)
                && wall > 0 && wall <= 9007199254740991L - 60_000);
            expiry = wall + 60_000; verified = true;
            current.requireCurrent(); requireCurrent(identity); mark("fictional_authority_exact");
            return new MessagePreviewVaultProvisioning.Verification(identity, access, expiry);
        }
    }

    private void compose() throws Exception {
        require(processId > 0 && uid >= 10000 && uid / 100000 == 0 && uid == Process.myUid());
        require(PACKAGE.equals(getContext().getPackageName()) && PACKAGE.equals(getTargetContext().getPackageName()));
        Context target = getTargetContext().getApplicationContext(); require(target instanceof Application);
        application = (Application) target; contextCurrent();
        mark("uid_owned"); mark("ce_unlocked"); mark("actual_application");
        main(new Action() {
            @Override public void run() {
                application.registerActivityLifecycleCallbacks(issuer); registered = true;
                VaultProvisioningProbeActivity.allowLaunch(deadline - CLEANUP_RESERVE);
                application.startActivity(new Intent(application, VaultProvisioningProbeActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        });
        await(resumed, 5_000);
        main(new Action() {
            @Override public void run() throws Exception {
                phaseSnapshot = issuer.capture(); require(issuer.isCurrent(phaseSnapshot)); mark("actual_resumed_issuer");
                MessagePreviewPristineInitializer candidate = MessagePreviewPristineInitializer.getOrCreate(application, issuer, authority);
                synchronized (state) {
                    if (!memoryCurrent()) { candidate.invalidate(); candidate.close(); throw new Refused(); }
                    owner = candidate;
                }
                mark("actual_main_entry"); retainedOwner();
            }
        });
        MessagePreviewPristineInitializer.InitResult initial = initialize();
        require(initial != null && initial.status == MessagePreviewPristineInitializer.Status.INITIALIZED_EMPTY_G0
            && Long.valueOf(0).equals(initial.generation));
        Evidence g0 = evidence(); MessagePreviewMetadataEnvelope.Record empty = read(g0);
        exact(empty, g0.installation, MessagePreviewMetadataEnvelope.Kind.EMPTY, 0, 0, 0, "");
        require(empty.header.alias.isEmpty() && empty.header.expiresWallMillis == 0 && empty.credentialBytes().length == 0);
        require(ownedKeys(g0.installation, null)); mark("authenticated_empty_g0");
        String recipient = UUID.randomUUID().toString(), session = UUID.randomUUID().toString();
        captured = new MessagePreviewVaultFence.Context(1, UUID.randomUUID().toString(), recipient, session, 1);
        fictionalOwner = new MessagePreviewVaultFence.Owner(recipient, session, UUID.randomUUID().toString(), 1);
        beginId = MessagePreviewVaultProvisioning.opaque();
        MessagePreviewPristineInitializer.ProvisionResult pending = provision(new ProvisionAction() {
            @Override public void run(MessagePreviewPristineInitializer.ProvisionCompletion completion) {
                owner.beginOwned(beginId, 1, 0, captured, fictionalOwner, completion);
            }
        });
        require(pending != null && pending.status == MessagePreviewPristineInitializer.ProvisionStatus.PENDING
            && Long.valueOf(1).equals(pending.generation) && pending.ticket != null && pending.ticket.matches("[0-9a-f]{32}"));
        final String ticket = pending.ticket;
        MessagePreviewMetadataEnvelope.Record pendingRecord = read(evidence());
        exact(pendingRecord, g0.installation, MessagePreviewMetadataEnvelope.Kind.PENDING, 1, 0, 1, beginId);
        require(pendingRecord.credentialBytes().length == 0 && pendingRecord.header.expiresWallMillis == 0
            && !pendingRecord.header.alias.isEmpty() && ownedKeys(g0.installation, null)); mark("pending_g1");
        MessagePreviewPristineInitializer.ProvisionResult committed = useTicket(ticket);
        require(committed != null && committed.status == MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED
            && Long.valueOf(1).equals(committed.generation) && committed.ticket == null);
        Evidence sealed = evidence(); MessagePreviewMetadataEnvelope.Record record = read(sealed);
        exact(record, g0.installation, MessagePreviewMetadataEnvelope.Kind.COMMITTED, 1, 0, 1, beginId);
        require(record.header.alias.equals(pendingRecord.header.alias) && record.header.expiresWallMillis == authority.expiry
            && record.credentialBytes().length > 0 && ownedKeys(g0.installation, record.header.alias)); mark("committed_g1");
        MessagePreviewPristineInitializer.ProvisionResult observed = provision(new ProvisionAction() {
            @Override public void run(MessagePreviewPristineInitializer.ProvisionCompletion completion) { owner.observeOwned(beginId, completion); }
        });
        require(observed != null && observed.status == MessagePreviewPristineInitializer.ProvisionStatus.DORMANT
            && Long.valueOf(1).equals(observed.generation) && observed.ticket == null);
        require(Arrays.equals(sealed.journal, evidence().journal)); mark("dormant_g1");
        SecretKey credential = new MessagePreviewKeystoreReader(application, g0.installation).loadCredential(record.header.alias);
        contextCurrent(); mark("reader_loaded");
        require(MessagePreviewCredentialEnvelope.verifyMatch(record, record.header, fictionalOwner,
            FICTIONAL_ACCESS, authority.expiry, credential)); contextCurrent(); mark("decrypt_match");
        MessagePreviewVaultFence.Owner wrong = new MessagePreviewVaultFence.Owner(UUID.randomUUID().toString(),
            fictionalOwner.session, fictionalOwner.device, fictionalOwner.accountEpoch);
        require(!MessagePreviewCredentialEnvelope.verifyMatch(record, record.header, wrong,
            FICTIONAL_ACCESS, authority.expiry, credential)); contextCurrent(); mark("wrong_owner_mismatch");
        credential = null;
        MessagePreviewPristineInitializer.ProvisionResult replay = useTicket(ticket);
        require(replay != null && replay.status == MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST
            && replay.generation == null && replay.ticket == null);
        require(Arrays.equals(sealed.journal, evidence().journal)); mark("ticket_single_use");
        final String retireId = MessagePreviewVaultProvisioning.opaque();
        final CountDownLatch done = new CountDownLatch(1);
        final MessagePreviewPristineInitializer.TransitionResult[] retirement = {null};
        main(new Action() {
            @Override public void run() {
                owner.retireExact(retireId, 2, 1, null, new MessagePreviewPristineInitializer.TransitionCompletion() {
                    @Override public void complete(MessagePreviewPristineInitializer.TransitionResult value) {
                        if (memoryCurrent()) retirement[0] = value; done.countDown();
                    }
                });
            }
        });
        await(done, 10_000); contextCurrent();
        require(retirement[0] != null && retirement[0].status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED
            && Long.valueOf(2).equals(retirement[0].generation));
        Evidence g2 = evidence(); MessagePreviewMetadataEnvelope.Record retiredRecord = read(g2);
        exact(retiredRecord, g0.installation, MessagePreviewMetadataEnvelope.Kind.EMPTY, 2, 1, 2, retireId);
        require(retiredRecord.header.alias.isEmpty() && retiredRecord.header.expiresWallMillis == 0
            && retiredRecord.credentialBytes().length == 0); mark("retired_empty_g2");
        require(!keys().containsAlias(record.header.alias) && ownedKeys(g0.installation, null)); mark("credential_key_absent");
        boolean refused = false;
        try { new MessagePreviewKeystoreReader(application, g0.installation).loadCredential(record.header.alias); }
        catch (MessagePreviewKeystoreReader.Unavailable unavailable) { refused = true; }
        require(refused); contextCurrent(); mark("missing_key_refused");
        require(Arrays.equals(g0.marker, g2.marker) && g0.installation.equals(g2.installation));
        SecretKey retainedMetadata = new MessagePreviewKeystoreReader(application, g2.installation).loadMetadata();
        require(MessagePreviewVaultProvisioning.equal(empty,
            MessagePreviewMetadataEnvelope.open(g0.journal, g0.installation, retainedMetadata)));
        contextCurrent(); mark("metadata_marker_retained");
        replay = useTicket(ticket);
        require(replay != null && replay.status == MessagePreviewPristineInitializer.ProvisionStatus.UNKNOWN
            && replay.generation == null && replay.ticket == null); mark("old_ticket_refused");
        MessagePreviewPristineInitializer.InitResult repeated = initialize();
        require(repeated != null && repeated.status == MessagePreviewPristineInitializer.Status.UNAVAILABLE && repeated.generation == null);
        mark("repeat_init_refused"); main(new Action() { @Override public void run() throws Exception { retainedOwner(); } });
        Evidence after = evidence();
        require(Arrays.equals(g2.marker, after.marker) && Arrays.equals(g2.journal, after.journal)
            && !keys().containsAlias(record.header.alias) && ownedKeys(g0.installation, null));
        read(after); mark("no_key_recreated"); contextCurrent();
    }

    private void retainedOwner() throws Exception {
        require(owner != null && owner == MessagePreviewPristineInitializer.getOrCreate(application, issuer, authority));
        mark("single_owner");
    }
    private MessagePreviewPristineInitializer.InitResult initialize() throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final MessagePreviewPristineInitializer.InitResult[] result = {null};
        main(new Action() {
            @Override public void run() {
                owner.initializeExplicit(new MessagePreviewPristineInitializer.Completion() {
                    @Override public void complete(MessagePreviewPristineInitializer.InitResult value) {
                        if (memoryCurrent()) result[0] = value; done.countDown();
                    }
                });
            }
        });
        await(done, 10_000); contextCurrent(); return result[0];
    }
    private MessagePreviewPristineInitializer.ProvisionResult provision(final ProvisionAction action) throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final MessagePreviewPristineInitializer.ProvisionResult[] result = {null};
        main(new Action() {
            @Override public void run() {
                action.run(new MessagePreviewPristineInitializer.ProvisionCompletion() {
                    @Override public void complete(MessagePreviewPristineInitializer.ProvisionResult value) {
                        if (memoryCurrent()) result[0] = value; done.countDown();
                    }
                });
            }
        });
        await(done, 10_000); contextCurrent(); return result[0];
    }
    private MessagePreviewPristineInitializer.ProvisionResult useTicket(final String ticket) throws Exception {
        return provision(new ProvisionAction() {
            @Override public void run(MessagePreviewPristineInitializer.ProvisionCompletion completion) {
                owner.provisionExact(beginId, ticket, FICTIONAL_ACCESS, completion);
            }
        });
    }
    private static void exact(MessagePreviewMetadataEnvelope.Record record, String installation,
            MessagePreviewMetadataEnvelope.Kind kind, long generation, long base, long revision, String operation) throws Exception {
        require(record != null); MessagePreviewMetadataEnvelope.Header h = record.header;
        require(installation.equals(h.installation) && h.kind == kind && h.generation == generation
            && h.baseGeneration == base && h.vaultRevision == revision && operation.equals(h.operationId)
            && MessagePreviewVerificationState.safe(h.wallHighWaterMillis) && h.wallHighWaterMillis > 0);
    }
    private static final class Evidence {
        final String installation;
        final byte[] marker, journal;
        Evidence(byte[] marker, byte[] journal) throws Exception {
            this.marker = marker; this.journal = journal; installation = MessagePreviewInstallationMarker.decode(marker);
        }
    }
    private Evidence evidence() throws Exception {
        contextCurrent(); File root = application.getNoBackupFilesDir();
        require(root != null && root.isAbsolute());
        for (File part = root; part != null; part = part.getParentFile()) require(!".".equals(part.getName()) && !"..".equals(part.getName()));
        StructStat rootStat = Os.lstat(root.getPath()); require(OsConstants.S_ISDIR(rootStat.st_mode) && rootStat.st_uid == uid);
        File namespace = new File(root.getCanonicalFile(), "native-message-previews-v1");
        require(namespace.equals(namespace.getCanonicalFile()));
        StructStat dir = Os.lstat(namespace.getPath());
        require(OsConstants.S_ISDIR(dir.st_mode) && dir.st_uid == uid && (dir.st_mode & 07777) == 0700);
        String[] names = namespace.list();
        require(names != null && names.length == 2 && Arrays.asList(names).contains("installation-v1.bin")
            && Arrays.asList(names).contains("journal-v1.bin"));
        Evidence result = new Evidence(checkedBytes(new File(namespace, "installation-v1.bin"), 28, true),
            checkedBytes(new File(namespace, "journal-v1.bin"), 16_384, false));
        contextCurrent(); mark("marker_checked"); return result;
    }
    private byte[] checkedBytes(File path, int limit, boolean marker) throws Exception {
        contextCurrent(); require(path.equals(path.getCanonicalFile()));
        StructStat before = Os.lstat(path.getPath());
        require(OsConstants.S_ISREG(before.st_mode) && before.st_uid == uid && before.st_size > 0 && before.st_size <= limit
            && (!marker || before.st_size == 28 && (before.st_mode & 07777) == 0600));
        FileDescriptor fd = Os.open(path.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);
        try {
            same(before, Os.fstat(fd)); contextCurrent();
            try (FileInputStream stream = new FileInputStream(fd)) {
                fd = null; byte[] buffer = new byte[limit + 1]; int total = 0;
                while (total < buffer.length) {
                    contextCurrent(); int count = stream.read(buffer, total, buffer.length - total); contextCurrent();
                    if (count == -1) break; require(count > 0); total += count;
                }
                require(total == before.st_size && total <= limit);
                same(before, Os.lstat(path.getPath())); same(before, Os.fstat(stream.getFD()));
                return Arrays.copyOf(buffer, total);
            }
        } finally { if (fd != null) Os.close(fd); }
    }
    private static void same(StructStat a, StructStat b) throws Exception {
        require(a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_uid == b.st_uid
            && a.st_mode == b.st_mode && a.st_size == b.st_size);
    }
    private KeyStore keys() throws Exception {
        contextCurrent(); KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); contextCurrent(); return store;
    }
    private boolean ownedKeys(String installation, String credential) throws Exception {
        Enumeration<String> names = keys().aliases(); int count = 0, metadata = 0, credentials = 0;
        while (names.hasMoreElements()) {
            contextCurrent(); require(++count <= 256); String name = names.nextElement(); require(name != null && name.length() <= 256);
            if (name.startsWith("letscube.nmpv.")) {
                if (name.equals("letscube.nmpv.metadata.v1." + installation)) metadata++;
                else { require(credential != null && name.equals(credential)); credentials++; }
            }
        }
        contextCurrent(); return metadata == 1 && credentials == (credential == null ? 0 : 1);
    }
    private MessagePreviewMetadataEnvelope.Record read(Evidence evidence) throws Exception {
        contextCurrent(); SecretKey key = new MessagePreviewKeystoreReader(application, evidence.installation).loadMetadata();
        contextCurrent(); mark("metadata_policy");
        MessagePreviewMetadataEnvelope.Record record = new MessagePreviewJournalIO(new MessagePreviewAtomicBackend(application))
            .read(evidence.installation, key);
        require(MessagePreviewVaultProvisioning.equal(record,
            MessagePreviewMetadataEnvelope.open(evidence.journal, evidence.installation, key)));
        contextCurrent(); return record;
    }

    private void disposeMain() {
        final CountDownLatch disposed = new CountDownLatch(1);
        final boolean[] ok = {false};
        try {
            require(new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override public void run() {
                    try {
                        if (owner != null && application != null) {
                            boolean refused = false;
                            try {
                                MessagePreviewPristineInitializer unexpected = MessagePreviewPristineInitializer.getOrCreate(application, issuer, authority);
                                unexpected.invalidate(); unexpected.close();
                            }
                            catch (MessagePreviewPristineInitializer.Unavailable unavailable) { refused = true; }
                            setFinal("owner_recreation_refused", refused);
                        }
                        VaultProvisioningProbeActivity activity = started;
                        if (activity != null) { activity.finish(); ok[0] = true; }
                    } catch (Exception refused) { /* Exact host cleanup required on refusal. */ }
                    finally { disposed.countDown(); }
                }
            }));
            if (cleanupAwait(disposed) && ok[0]) {
                setFinal("activity_retired", cleanupAwait(retired));
                setFinal("activity_destroyed", cleanupAwait(destroyed));
            }
        } catch (Exception refused) { /* Fixed unavailable, no unrelated Activity disposal. */ }
        finally { issuer.close(); setFinal("issuer_invalidated", phaseSnapshot != null && !issuer.isCurrent(phaseSnapshot)); }
        final CountDownLatch detached = new CountDownLatch(1);
        try {
            require(new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override public void run() {
                    try {
                        if (registered && application != null) {
                            application.unregisterActivityLifecycleCallbacks(issuer); registered = false;
                            setFinal("callbacks_removed", true);
                        }
                    } catch (Exception refused) { /* Host reconciles only this exact package. */ }
                    finally { detached.countDown(); }
                }
            }));
            require(detached.await(Math.max(0, deadline - SystemClock.elapsedRealtime()), TimeUnit.MILLISECONDS));
        } catch (Exception refused) { setFinal("callbacks_removed", false); }
    }

    private boolean cleanupAwait(CountDownLatch latch) throws InterruptedException {
        long left = Math.max(0, deadline - SystemClock.elapsedRealtime());
        return latch.await(Math.min(left, CLEANUP_WAIT), TimeUnit.MILLISECONDS);
    }
}
