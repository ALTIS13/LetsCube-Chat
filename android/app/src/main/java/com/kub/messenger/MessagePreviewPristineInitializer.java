package com.kub.messenger;

import android.content.Context;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

// Inactive native-private composition. The genuine passive lifecycle issuer is a future input.
final class MessagePreviewPristineInitializer {
    enum Status { INITIALIZED_EMPTY_G0, LOADED_EXISTING, LOADED_FOR_RETIREMENT, UNAVAILABLE }
    static final class InitResult {
        final Status status;
        final Long generation;
        final Long vaultRevision;
        private InitResult(Status status, Long generation) { this(status, generation, generation == null ? null : 0L); }
        private InitResult(Status status, Long generation, Long vaultRevision) {
            this.status=status; this.generation=generation; this.vaultRevision=vaultRevision;
        }
    }
    interface Completion { void complete(InitResult result); }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private static final InitResult REFUSED = new InitResult(Status.UNAVAILABLE, null);
    private static MessagePreviewPristineInitializer registered;
    private final Context context;
    private final int uid;
    private final MessagePreviewInitializationGate.ForegroundAuthority issuer;
    private final MessagePreviewInitializationGate gate;
    private final Thread worker;
    private Attempt pending;
    private boolean busy;
    private volatile boolean closed;
    private MessagePreviewJournalIO journal;
    private SecretKey metadataKey;
    private InitializedState initialized;
    private TransitionWork pendingTransition, activeTransition;
    private final MessagePreviewVaultProvisioning.Authority provisioningAuthority;
    private final boolean nativeSession;
    private AcquiringTask pendingAcquiring, activeAcquiring;
    private TransitionWork queuedErasure;

    enum ProvisionStatus { PENDING, COMMITTED, DORMANT, INCOMPLETE, UNAVAILABLE, INVALID_REQUEST, INVALID_OWNER, STALE_OWNER, EXHAUSTED, BUSY, UNKNOWN }
    static final class ProvisionResult {
        final ProvisionStatus status;
        final Long generation;
        final String ticket;
        final Long expiresAt;
        private ProvisionResult(ProvisionStatus status, Long generation, String ticket) {
            this(status, generation, ticket, null);
        }
        private ProvisionResult(ProvisionStatus status, Long generation, String ticket, Long expiresAt) {
            this.status=status; this.generation=generation; this.ticket=ticket;
            this.expiresAt=expiresAt;
        }
    }
    interface ProvisionCompletion { void complete(ProvisionResult result); }
    private static final class Acquisition {
        final MessagePreviewVaultProvisioning.Work program;
        String ticket;
        boolean consumed, cancelled;
        Acquisition(MessagePreviewVaultProvisioning.Work program) { this.program=program; }
    }
    private static final class AcquiringTask {
        final InitializedState state;
        final Acquisition target;
        final boolean begin, observe;
        final ProvisionCompletion completion;
        final long deadline;
        String access;
        AcquiringTask(InitializedState state, Acquisition target, boolean begin, boolean observe,
                String access, ProvisionCompletion completion, long deadline) {
            this.state=state; this.target=target; this.begin=begin; this.observe=observe;
            this.access=access; this.completion=completion;
            this.deadline=deadline;
        }
    }

    private static final long TRANSITION_BUDGET_MILLIS = 10_000;
    enum TransitionStatus { RETIRED, INCOMPLETE, UNAVAILABLE, UNKNOWN, STALE_OWNER, INVALID_REQUEST, EXHAUSTED, BUSY }
    static final class TransitionResult {
        final TransitionStatus status;
        final Long generation;
        private TransitionResult(TransitionStatus status, Long generation) { this.status=status; this.generation=generation; }
    }
    interface TransitionCompletion { void complete(TransitionResult result); }
    private static final class InitializedState {
        final String installation;
        final MessagePreviewJournalIO journal;
        final MessagePreviewVaultFence fence;
        final boolean nativeSession;
        MessagePreviewMetadataEnvelope.Record checkedHead;
        Retirement current;
        boolean uncertain;
        long lastMillis;
        Acquisition acquisition;
        MessagePreviewVaultFence.Context boundContext;
        long acceptedVaultRevision=-1;
        final Set<String> acceptedOperations=new HashSet<>();
        private InitializedState(Prepared prepared, boolean nativeSession) {
            this.nativeSession=nativeSession;
            installation=prepared.record.header.installation;
            journal=prepared.journal;
            checkedHead=prepared.record;
            fence=nativeSession ? new MessagePreviewVaultFence(checkedHead.header.generation, checkedHead.header.vaultRevision,
                    checkedHead.header.operationId, installation.substring(0,16))
                : checkedHead.header.generation == 0 ? new MessagePreviewVaultFence(0)
                    : new MessagePreviewVaultFence(checkedHead.header.generation, checkedHead.header.vaultRevision, checkedHead.header.operationId);
            if (nativeSession) acceptedVaultRevision=checkedHead.header.vaultRevision;
            if (checkedHead.header.generation > 0) {
                acceptedVaultRevision=checkedHead.header.vaultRevision;
                acceptedOperations.add(checkedHead.header.operationId);
            }
        }
    }
    private static final class Retirement {
        final MessagePreviewVaultFence.Operation operation;
        final MessagePreviewMetadataEnvelope.Record predecessor;
        MessagePreviewMetadataEnvelope.Header expectedFinal;
        boolean completed;
        MessagePreviewVaultProvisioning.Work program, predecessorProgram;
        private Retirement(MessagePreviewVaultFence.Operation operation, MessagePreviewMetadataEnvelope.Record predecessor) {
            this.operation=operation; this.predecessor=predecessor;
        }
    }
    private static final class TransitionWork {
        final InitializedState state;
        final Retirement target;
        final boolean observe;
        final long deadline;
        final TransitionCompletion completion;
        boolean cancelled;
        private TransitionWork(InitializedState state, Retirement target, boolean observe, long now,
                               TransitionCompletion completion) {
            this.state=state; this.target=target; this.observe=observe;
            deadline=now+TRANSITION_BUDGET_MILLIS; this.completion=completion;
        }
    }

    private static final class Attempt {
        final MessagePreviewInitializationGate.Permit permit;
        final Completion completion;
        final boolean existing;
        Attempt(MessagePreviewInitializationGate.Permit permit, Completion completion) {
            this(permit, completion, false);
        }
        Attempt(MessagePreviewInitializationGate.Permit permit, Completion completion, boolean existing) {
            this.permit=permit; this.completion=completion; this.existing=existing;
        }
    }
    private static final class Prepared {
        final MessagePreviewJournalIO journal;
        final SecretKey key;
        final MessagePreviewMetadataEnvelope.Record record;
        Prepared(MessagePreviewJournalIO journal, SecretKey key, MessagePreviewMetadataEnvelope.Record record) {
            this.journal=journal; this.key=key; this.record=record;
        }
    }

    static MessagePreviewPristineInitializer getOrCreate(Context supplied,
            MessagePreviewInitializationGate.ForegroundAuthority issuer) throws Unavailable {
        return getOrCreate(supplied, issuer, null);
    }
    static MessagePreviewPristineInitializer getOrCreate(Context supplied,
            MessagePreviewInitializationGate.ForegroundAuthority issuer,
            MessagePreviewVaultProvisioning.Authority provisioningAuthority) throws Unavailable {
        return getOrCreate(supplied, issuer, provisioningAuthority, false);
    }
    static MessagePreviewPristineInitializer getOrCreateForSession(Context supplied,
            MessagePreviewInitializationGate.ForegroundAuthority issuer,
            MessagePreviewVaultProvisioning.Authority provisioningAuthority) throws Unavailable {
        if (provisioningAuthority == null) throw new Unavailable();
        return getOrCreate(supplied, issuer, provisioningAuthority, true);
    }
    private static MessagePreviewPristineInitializer getOrCreate(Context supplied,
            MessagePreviewInitializationGate.ForegroundAuthority issuer,
            MessagePreviewVaultProvisioning.Authority provisioningAuthority, boolean nativeSession) throws Unavailable {
        try {
            requireMain();
            if (supplied == null || issuer == null || supplied.isDeviceProtectedStorage()) throw new Unavailable();
            Context application=supplied.getApplicationContext();
            int uid=Process.myUid();
            requireApplication(application, uid);
            MessagePreviewPristineInitializer owner;
            synchronized (MessagePreviewPristineInitializer.class) {
                if (registered != null) {
                    if (registered.context != application || registered.uid != uid || registered.issuer != issuer
                        || registered.closed || registered.provisioningAuthority != provisioningAuthority
                        || registered.nativeSession != nativeSession) throw new Unavailable();
                    return registered;
                }
                owner=new MessagePreviewPristineInitializer(application, uid, issuer, provisioningAuthority, nativeSession);
                registered=owner;
            }
            try { owner.worker.start(); }
            catch (RuntimeException failure) { owner.close(); throw new Unavailable(); }
            return owner;
        } catch (Exception refused) { throw new Unavailable(); }
    }

    private MessagePreviewPristineInitializer(Context context, int uid,
            MessagePreviewInitializationGate.ForegroundAuthority issuer,
            MessagePreviewVaultProvisioning.Authority provisioningAuthority, boolean nativeSession) throws Exception {
        this.context=context; this.uid=uid; this.issuer=issuer;
        this.provisioningAuthority=provisioningAuthority;
        this.nativeSession=nativeSession;
        worker=new Thread(new Runnable() {
            @Override public void run() { MessagePreviewPristineInitializer.this.work(); }
        }, "NmpvPristineOwner");
        worker.setDaemon(true);
        gate=new MessagePreviewInitializationGate(issuer, new MessagePreviewInitializationGate.MonotonicClock() {
            @Override public long nowMillis() { return SystemClock.elapsedRealtime(); }
        }, Thread.currentThread(), worker);
    }

    private static void requireMain() throws Unavailable {
        if (Looper.getMainLooper() == null || Looper.myLooper() != Looper.getMainLooper()) throw new Unavailable();
    }
    private static void requireApplication(Context context, int uid) throws Unavailable {
        if (uid < 10000 || Process.myUid() != uid || context == null || context.getApplicationContext() != context
            || context.isDeviceProtectedStorage() || context.getApplicationInfo() == null
            || context.getApplicationInfo().uid != uid) throw new Unavailable();
        UserManager manager=context.getSystemService(UserManager.class);
        if (manager == null || !manager.isUserUnlocked()) throw new Unavailable();
    }
    private void current(MessagePreviewInitializationGate.Permit permit) throws Exception {
        gate.currentBeforeEffect(permit);
        requireApplication(context, uid);
        gate.currentBeforeEffect(permit);
    }

    void initializeExplicit(Completion completion) {
        prepare(false, completion);
    }
    void loadExisting(Completion completion) {
        prepare(true, completion);
    }
    private void prepare(boolean existing, Completion completion) {
        if (completion == null) return;
        try { requireMain(); requireApplication(context, uid); }
        catch (Exception refused) { deliver(completion, REFUSED); return; }
        boolean admitted=false;
        synchronized (this) {
            try {
                if (closed || busy || initialized != null) throw new Unavailable();
                MessagePreviewInitializationGate.Permit permit=gate.admit(gate.capture());
                busy=true;
                pending=new Attempt(permit, completion, existing);
                admitted=true; notifyAll();
            } catch (Exception refused) { /* Fixed refusal, no platform effects or queued successor. */ }
        }
        if (!admitted) deliver(completion, REFUSED);
    }
    synchronized void invalidate() {
        gate.invalidate();
        if (initialized != null && initialized.boundContext != null) initialized.fence.expireContext(initialized.boundContext);
        if (initialized != null && initialized.acquisition != null
            && initialized.acquisition.program.operation.kind==MessagePreviewVaultFence.Kind.BEGIN) {
            initialized.acquisition.cancelled=true; initialized.acquisition.ticket=null;
        }
    }
    synchronized void close() {
        closed=true; gate.close();
        if (activeTransition != null) activeTransition.cancelled=true;
        if (initialized != null && initialized.acquisition != null) {
            initialized.acquisition.cancelled=true; initialized.acquisition.ticket=null;
        }
        notifyAll();
    }

    String nextOperationId(long revision) {
        try { requireMain(); }
        catch (Unavailable refused) { return null; }
        synchronized (this) {
            if (!nativeSession || closed || initialized == null || revision<=initialized.acceptedVaultRevision) return null;
            String id=MessagePreviewVaultFence.nativeOperationId(initialized.installation.substring(0,16), revision);
            return id != null && !initialized.acceptedOperations.contains(id) ? id : null;
        }
    }
    boolean beginOwned(String operationId, long vaultRevision, long expectedGeneration,
            MessagePreviewVaultFence.Context captured, MessagePreviewVaultFence.Owner owner,
            ProvisionCompletion completion) {
        if (completion == null) return false;
        ProvisionStatus status=ProvisionStatus.UNAVAILABLE;
        try {
            requireMain();
            if (provisioningAuthority == null) throw new Unavailable();
            if (!intentShape(operationId, vaultRevision, expectedGeneration) || !contextShape(captured)) {
                deliverProvision(completion, new ProvisionResult(ProvisionStatus.INVALID_REQUEST, null, null)); return false;
            }
            MessagePreviewVaultProvisioning.Identity identity=new MessagePreviewVaultProvisioning.Identity(
                operationId, vaultRevision, expectedGeneration, captured, owner);
            provisioningAuthority.requireCurrent(identity);
            long now=SystemClock.elapsedRealtime();
            String suffix=MessagePreviewVaultProvisioning.opaque();
            synchronized (this) {
                if (closed || initialized == null) throw new Unavailable();
                if (busy) status=ProvisionStatus.BUSY;
                else if (initialized.uncertain || (nativeSession && initialized.acquisition == null
                    && retirementKind(initialized.checkedHead.header.kind)) || !timeShape(now, 15_000)) status=ProvisionStatus.UNAVAILABLE;
                else if (initialized.checkedHead.header.generation != expectedGeneration) status=ProvisionStatus.STALE_OWNER;
                else if (vaultRevision<=initialized.acceptedVaultRevision) status=ProvisionStatus.STALE_OWNER;
                else if (initialized.acceptedOperations.contains(operationId)) status=ProvisionStatus.INVALID_REQUEST;
                else if (nativeSession && !operationId.equals(MessagePreviewVaultFence.nativeOperationId(
                    initialized.installation.substring(0,16), vaultRevision))) status=ProvisionStatus.INVALID_REQUEST;
                else if (expectedGeneration>=9007199254740990L || vaultRevision==9007199254740991L
                    || (!nativeSession && initialized.acceptedOperations.size()>=255)) status=ProvisionStatus.EXHAUSTED;
                else if (initialized.boundContext != null && captured.revision <= initialized.boundContext.revision
                    && !sameContext(initialized.boundContext, captured)) status=ProvisionStatus.STALE_OWNER;
                else {
                    if (initialized.boundContext == null || captured.revision > initialized.boundContext.revision) {
                        if (!initialized.fence.bindContext(captured)) throw new Unavailable();
                        initialized.boundContext=captured;
                    }
                    MessagePreviewVaultFence.Admission admission=initialized.fence.begin(operationId, vaultRevision,
                        expectedGeneration, captured, owner);
                    if (admission.operation != null) {
                        rememberIntent(initialized, admission.operation);
                        MessagePreviewVaultProvisioning.Work program=new MessagePreviewVaultProvisioning.Work(admission.operation,
                            identity, initialized.checkedHead, now, now+(admission.operation.kind==MessagePreviewVaultFence.Kind.BEGIN ? 15_000 : 10_000),
                            "letscube.nmpv.credential.v1."+initialized.installation+"."+suffix);
                        if (initialized.acquisition != null) {
                            initialized.acquisition.cancelled=true; initialized.acquisition.ticket=null;
                        }
                        Acquisition target=new Acquisition(program);
                        initialized.acquisition=target; initialized.uncertain=true; initialized.lastMillis=now;
                        queueAcquiring(new AcquiringTask(initialized, target, true, false, null, completion, program.deadline)); return true;
                    }
                    status=ProvisionStatus.valueOf(admission.decision.name());
                }
            }
        } catch (Exception refused) { /* Unbound/stale authority never reserves or touches storage. */ }
        deliverProvision(completion, new ProvisionResult(status, null, null));
        return false;
    }
    void provisionExact(String operationId, String ticket, String borrowedAccess, ProvisionCompletion completion) {
        if (completion == null) return;
        ProvisionStatus status=ProvisionStatus.UNAVAILABLE;
        try {
            requireMain(); long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                if (closed || initialized == null || provisioningAuthority == null) throw new Unavailable();
                Acquisition target=initialized.acquisition;
                if (busy) status=ProvisionStatus.BUSY;
                else if (target == null || !target.program.operation.operationId.equals(operationId)) status=ProvisionStatus.UNKNOWN;
                else if (target.cancelled || target.consumed || target.ticket == null || !target.ticket.equals(ticket))
                    status=ProvisionStatus.INVALID_REQUEST;
                else if (borrowedAccess == null || borrowedAccess.length()<1 || borrowedAccess.length()>8192)
                    status=ProvisionStatus.INVALID_REQUEST;
                else {
                    target.consumed=true; target.ticket=null;
                    if (!timeShape(now, 0) || now>=target.program.deadline || !initialized.fence.canContinue(target.program.operation))
                        throw new Unavailable();
                    initialized.lastMillis=now;
                    queueAcquiring(new AcquiringTask(initialized, target, false, false, borrowedAccess, completion, target.program.deadline)); return;
                }
            }
        } catch (Exception refused) { /* An exact ticket is consumed before any credential work. */ }
        deliverProvision(completion, new ProvisionResult(status, null, null));
    }
    void observeOwned(String operationId, ProvisionCompletion completion) {
        if (completion == null) return;
        ProvisionStatus status=ProvisionStatus.UNAVAILABLE;
        try {
            requireMain(); long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                if (closed || initialized == null) throw new Unavailable();
                if (busy) status=ProvisionStatus.BUSY;
                else if (initialized.acquisition == null || !initialized.acquisition.program.operation.operationId.equals(operationId))
                    status=ProvisionStatus.UNKNOWN;
                else if (!timeShape(now, 10_000)) status=ProvisionStatus.UNAVAILABLE;
                else {
                    initialized.lastMillis=now;
                    queueAcquiring(new AcquiringTask(initialized, initialized.acquisition, false, true, null, completion, now+10_000)); return;
                }
            }
        } catch (Exception refused) { /* Credential-free observation issues no ticket and performs no decrypt. */ }
        deliverProvision(completion, new ProvisionResult(status, null, null));
    }
    private boolean timeShape(long now, long budget) {
        return now>=0 && now>=initialized.lastMillis && now<=Long.MAX_VALUE-budget;
    }
    private static boolean intentShape(String id, long revision, long generation) {
        return id!=null && id.matches("[0-9a-f]{32}") && MessagePreviewVerificationState.safe(revision)
            && MessagePreviewVerificationState.safe(generation);
    }
    private static void rememberIntent(InitializedState state, MessagePreviewVaultFence.Operation operation) {
        state.acceptedVaultRevision=operation.vaultRevision;
        if (!state.nativeSession) state.acceptedOperations.add(operation.operationId);
    }
    private static boolean contextShape(MessagePreviewVaultFence.Context c) {
        return c!=null && MessagePreviewVerificationState.safe(c.revision) && MessagePreviewVerificationState.safe(c.accountEpoch)
            && MessagePreviewVerificationState.uuid(c.epoch) && MessagePreviewVerificationState.uuid(c.recipient)
            && MessagePreviewVerificationState.uuid(c.session);
    }
    private static boolean sameContext(MessagePreviewVaultFence.Context a, MessagePreviewVaultFence.Context b) {
        return a.revision==b.revision && a.accountEpoch==b.accountEpoch && a.epoch.equals(b.epoch)
            && a.recipient.equals(b.recipient) && a.session.equals(b.session);
    }
    private void queueAcquiring(AcquiringTask work) {
        busy=true; activeAcquiring=work; pendingAcquiring=work; notifyAll();
    }
    private static void deliverProvision(ProvisionCompletion completion, ProvisionResult result) {
        try { completion.complete(result); } catch (RuntimeException ignored) { /* Lost ACK cannot restore or replay a ticket. */ }
    }

    // Admission uses only retained checked state. UID/CE/key/record reads belong to the worker.
    void retireExact(String operationId, long vaultRevision, long expectedGeneration,
                     MessagePreviewVaultFence.Correlation correlation, TransitionCompletion completion) {
        if (completion == null) return;
        TransitionStatus status=TransitionStatus.UNAVAILABLE;
        try {
            requireMain();
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                if (closed || initialized == null) throw new Unavailable();
                if (!busy && initialized.uncertain && initialized.current!=null
                    && initialized.current.program!=null && !initialized.current.completed) status=TransitionStatus.UNAVAILABLE;
                else if (initialized.acquisition != null && (!busy || (activeAcquiring != null && !activeAcquiring.observe))
                    && queuedErasure == null) {
                    if (!intentShape(operationId, vaultRevision, expectedGeneration)) status=TransitionStatus.INVALID_REQUEST;
                    else if (!timeShape(now, TRANSITION_BUDGET_MILLIS)) status=TransitionStatus.UNAVAILABLE;
                    else {
                        MessagePreviewVaultFence.Admission admission=initialized.fence.retire(operationId, vaultRevision,
                            expectedGeneration, correlation);
                        if (admission.decision == MessagePreviewVaultFence.Decision.RESERVED) {
                            rememberIntent(initialized, admission.operation);
                            Acquisition prior=initialized.acquisition;
                            prior.cancelled=true; prior.ticket=null;
                            Retirement target=new Retirement(admission.operation, initialized.checkedHead);
                            target.predecessorProgram=prior.program;
                            target.program=new MessagePreviewVaultProvisioning.Work(admission.operation, null,
                                initialized.checkedHead, now, now+TRANSITION_BUDGET_MILLIS, "");
                            initialized.current=target; initialized.uncertain=true; initialized.lastMillis=now;
                            TransitionWork erasure=new TransitionWork(initialized, target, false, now, completion);
                            if (busy) queuedErasure=erasure;
                            else queueTransition(erasure);
                            return;
                        }
                        status=TransitionStatus.valueOf(admission.decision.name());
                    }
                }
                else if (busy) status=TransitionStatus.BUSY;
                else if (operationId == null || !operationId.matches("[0-9a-f]{32}")
                    || !MessagePreviewVerificationState.safe(vaultRevision)
                    || !MessagePreviewVerificationState.safe(expectedGeneration)) status=TransitionStatus.INVALID_REQUEST;
                else if (initialized.uncertain) status=TransitionStatus.UNAVAILABLE;
                else if (correlation != null) status=TransitionStatus.INVALID_REQUEST; // No BEGIN in this slice.
                else if (now < initialized.lastMillis || now < 0 || now > Long.MAX_VALUE-TRANSITION_BUDGET_MILLIS)
                    status=TransitionStatus.UNAVAILABLE;
                else if (initialized.checkedHead.header.generation != expectedGeneration)
                    status=TransitionStatus.STALE_OWNER;
                else {
                    MessagePreviewVaultFence.Admission admission=initialized.fence.retire(operationId, vaultRevision, expectedGeneration, null);
                    if (admission.decision == MessagePreviewVaultFence.Decision.RESERVED) {
                        rememberIntent(initialized, admission.operation);
                        Retirement target=new Retirement(admission.operation, initialized.checkedHead);
                        if (initialized.checkedHead.header.kind == MessagePreviewMetadataEnvelope.Kind.COMMITTED
                            || (nativeSession && retirementKind(initialized.checkedHead.header.kind)))
                            target.program=new MessagePreviewVaultProvisioning.Work(admission.operation, null,
                                initialized.checkedHead, now, now+TRANSITION_BUDGET_MILLIS, "");
                        initialized.current=target; initialized.uncertain=true; initialized.lastMillis=now;
                        queueTransition(new TransitionWork(initialized, target, false, now, completion));
                        return;
                    }
                    status=TransitionStatus.valueOf(admission.decision.name());
                }
            }
        } catch (Exception refused) { /* Fixed refusal without storage or reservation replay. */ }
        deliverTransition(completion, new TransitionResult(status, null));
    }

    void observeRetirement(String operationId, TransitionCompletion completion) {
        if (completion == null) return;
        TransitionStatus status=TransitionStatus.UNAVAILABLE;
        try {
            requireMain();
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                if (closed || initialized == null) throw new Unavailable();
                if (busy) status=TransitionStatus.BUSY;
                else if (operationId == null || !operationId.matches("[0-9a-f]{32}")) status=TransitionStatus.INVALID_REQUEST;
                else if (initialized.current == null || !initialized.current.operation.operationId.equals(operationId))
                    status=TransitionStatus.UNKNOWN;
                else if (now < initialized.lastMillis || now < 0 || now > Long.MAX_VALUE-TRANSITION_BUDGET_MILLIS)
                    status=TransitionStatus.UNAVAILABLE;
                else {
                    initialized.lastMillis=now;
                    queueTransition(new TransitionWork(initialized, initialized.current, true, now, completion));
                    return;
                }
            }
        } catch (Exception refused) { /* Observation never reserves a generation or executes a write. */ }
        deliverTransition(completion, new TransitionResult(status, null));
    }
    synchronized void cancelRetirement(String operationId) {
        if (activeTransition != null && activeTransition.target.operation.operationId.equals(operationId))
            activeTransition.cancelled=true;
    }
    private void queueTransition(TransitionWork work) {
        busy=true; activeTransition=work; pendingTransition=work; notifyAll();
    }
    private static void deliverTransition(TransitionCompletion completion, TransitionResult result) {
        try { completion.complete(result); }
        catch (RuntimeException ignored) { /* A checked internal head survives a lost callback. */ }
    }

    private static void deliver(Completion completion, InitResult result) {
        try { completion.complete(result); }
        catch (RuntimeException ignored) { /* A lost callback never authorizes initialization replay. */ }
    }
    private void work() {
        while (true) {
            Attempt attempt;
            TransitionWork transition;
            AcquiringTask acquiring;
            synchronized (this) {
                while (pending == null && pendingTransition == null && pendingAcquiring == null && !closed) {
                    try { wait(); }
                    catch (InterruptedException refused) { closed=true; gate.close(); }
                }
                if (pending == null && pendingTransition == null && pendingAcquiring == null) return;
                attempt=pending; pending=null;
                transition=pendingTransition; pendingTransition=null;
                acquiring=pendingAcquiring; pendingAcquiring=null;
            }
            if (transition != null) { performTransition(transition); continue; }
            if (acquiring != null) { performAcquiring(acquiring); continue; }
            InitResult result=REFUSED;
            boolean finished=false;
            try {
                gate.consume(attempt.permit);
                Prepared prepared=attempt.existing ? load(attempt.permit) : initialize(attempt.permit);
                current(attempt.permit);
                synchronized (this) {
                    if (closed) throw new Unavailable();
                    gate.currentBeforeEffect(attempt.permit);
                    if (attempt.existing) gate.finishLoaded(attempt.permit);
                    else gate.finishInitialized(attempt.permit);
                    journal=prepared.journal;
                    metadataKey=prepared.key;
                    initialized=new InitializedState(prepared, nativeSession);
                    finished=true;
                    result=new InitResult(attempt.existing
                        ? (nativeSession && retirementKind(prepared.record.header.kind) ? Status.LOADED_FOR_RETIREMENT : Status.LOADED_EXISTING)
                        : Status.INITIALIZED_EMPTY_G0,
                        prepared.record.header.generation, prepared.record.header.vaultRevision);
                }
            } catch (Exception refused) { /* Retain every attempted marker/key/journal residue. */ }
            finally {
                if (!finished) {
                    try { gate.settleFailure(attempt.permit); }
                    catch (Exception refused) { close(); }
                    metadataKey=null;
                }
                // No cancellation/timeout releases this slot while a platform call is still held.
                synchronized (this) { busy=false; }
            }
            deliver(attempt.completion, result);
        }
    }

    private void cleanInventory(KeyStore store, MessagePreviewInitializationGate.Permit permit) throws Exception {
        current(permit);
        MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(store.aliases(), new MessagePreviewOwnedKeyInventory.CurrentCheck() {
            @Override public boolean isCurrent() throws Exception {
                MessagePreviewPristineInitializer.this.current(permit); return true;
            }
        });
        current(permit);
    }
    private static boolean retirementKind(MessagePreviewMetadataEnvelope.Kind kind) {
        return kind == MessagePreviewMetadataEnvelope.Kind.PENDING || kind == MessagePreviewMetadataEnvelope.Kind.RETIRING;
    }
    private Prepared load(MessagePreviewInitializationGate.Permit permit) throws Exception {
        current(permit);
        MessagePreviewExistingVault reader=MessagePreviewExistingVault.open(context);
        MessagePreviewMetadataEnvelope.Record record=reader.readAuthenticated();
        current(permit);
        if (record.header.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            && record.header.kind != MessagePreviewMetadataEnvelope.Kind.COMMITTED
            && !(nativeSession && retirementKind(record.header.kind))) throw new Unavailable();
        SecretKey key=new MessagePreviewKeystoreReader(context, record.header.installation).loadMetadata();
        MessagePreviewJournalIO candidate=new MessagePreviewJournalIO(new TransitionBackend(new MessagePreviewAtomicBackend(context)));
        MessagePreviewMetadataEnvelope.Record fresh=candidate.read(record.header.installation, key);
        if (!sameHeader(record.header, fresh.header) || !Arrays.equals(record.credentialBytes(), fresh.credentialBytes())) throw new Unavailable();
        MessagePreviewMetadataEnvelope.Record finalRecord=reader.readAuthenticated();
        if (!sameHeader(record.header, finalRecord.header)
            || !Arrays.equals(record.credentialBytes(), finalRecord.credentialBytes())) throw new Unavailable();
        current(permit);
        return new Prepared(candidate, key, fresh);
    }
    private void beforeMint(KeyStore store, String alias, MessagePreviewInitializationGate.Permit permit,
            MessagePreviewAtomicBackend.MarkerIO markers, MessagePreviewAtomicBackend.MarkerReservation reservation) throws Exception {
        current(permit); markers.requireCurrent(reservation);
        cleanInventory(store, permit);
        current(permit);
        if (store.containsAlias(alias)) throw new Unavailable();
        current(permit); markers.requireCurrent(reservation);
    }

    private Prepared initialize(MessagePreviewInitializationGate.Permit permit) throws Exception {
        current(permit);
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");
        current(permit); store.load(null); current(permit);
        cleanInventory(store, permit);
        MessagePreviewAtomicBackend.MarkerIO markers=new MessagePreviewAtomicBackend.MarkerIO(context, gate, permit);
        MessagePreviewAtomicBackend.MarkerReservation reservation=markers.reserve();
        current(permit); markers.requireCurrent(reservation);
        String installation=reservation.installation;
        String alias="letscube.nmpv.metadata.v1." + installation;
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        beforeMint(store, alias, permit, markers, reservation);
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build());
        beforeMint(store, alias, permit, markers, reservation);
        generator.generateKey();
        current(permit); markers.requireCurrent(reservation);
        SecretKey key=new MessagePreviewKeystoreReader(context, installation).loadMetadata();
        current(permit); markers.requireCurrent(reservation);
        MessagePreviewJournalIO candidate=new MessagePreviewJournalIO(new TransitionBackend(new MessagePreviewAtomicBackend(context)));
        current(permit); markers.requireCurrent(reservation);
        long wall=System.currentTimeMillis();
        if (!MessagePreviewVerificationState.safe(wall)) throw new Unavailable();
        MessagePreviewMetadataEnvelope.Header header=new MessagePreviewMetadataEnvelope.Header(
            installation, 0, MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0, wall, "", 0, 0);
        byte[] bytes=MessagePreviewMetadataEnvelope.seal(header, new byte[0], key);
        current(permit); markers.requireCurrent(reservation);
        if (candidate.write(bytes, installation, key) != MessagePreviewJournalIO.Result.CHECKED) throw new Unavailable();
        current(permit); markers.requireCurrentAfterInitialJournal(reservation);
        MessagePreviewMetadataEnvelope.Record readback=candidate.read(installation, key);
        current(permit); markers.requireCurrentAfterInitialJournal(reservation);
        MessagePreviewMetadataEnvelope.Header h=readback.header;
        if (!installation.equals(h.installation) || h.generation != 0 || h.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            || !h.alias.isEmpty() || h.expiresWallMillis != 0 || h.wallHighWaterMillis != wall
            || !h.operationId.isEmpty() || h.baseGeneration != 0 || h.vaultRevision != 0
            || readback.credentialBytes().length != 0) throw new Unavailable();
        return new Prepared(candidate, key, readback);
    }

    private final class TransitionBackend implements MessagePreviewJournalIO.Backend {
        private final MessagePreviewAtomicBackend delegate;
        private TransitionBackend(MessagePreviewAtomicBackend delegate) { this.delegate=delegate; }
        @Override public InputStream openRead() throws IOException { return delegate.openRead(); }
        @Override public OutputStream startWrite() throws IOException {
            TransitionWork work;
            AcquiringTask acquiring;
            synchronized (MessagePreviewPristineInitializer.this) {
                work=activeTransition;
                acquiring=activeAcquiring;
                if (initialized != null && work == null && acquiring == null) throw new IOException("UNAVAILABLE", (Throwable) null);
            }
            // Kernel prewrite authentication can block before any storage effect.
            try {
                if (work != null) transitionCurrent(work);
                if (acquiring != null) acquiringCurrent(acquiring);
            }
            catch (Exception refused) { throw new IOException("UNAVAILABLE", (Throwable) null); }
            return delegate.startWrite();
        }
        @Override public void sync(OutputStream stream) throws IOException { delegate.sync(stream); }
        @Override public void finishWrite(OutputStream stream) throws IOException { delegate.finishWrite(stream); }
        @Override public void failWrite(OutputStream stream) throws IOException { delegate.failWrite(stream); }
    }

    private void transitionMemory(TransitionWork work, long now) throws Unavailable {
        if (Thread.currentThread() != worker || closed || !busy || activeTransition != work
            || initialized != work.state || initialized.current != work.target || work.cancelled
            || now < work.state.lastMillis || now < 0 || now >= work.deadline
            || (!work.state.fence.canErase(work.target.operation) && !(work.observe && work.target.completed)))
            throw new Unavailable();
        work.state.lastMillis=now;
        if (!work.observe && work.target.program != null && work.target.program.unmaterializedPredecessor != null)
            unmaterializedMemory(work, work.target.program.unmaterializedPredecessor);
    }
    private void unmaterializedMemory(TransitionWork work, MessagePreviewVaultProvisioning.Work abandoned) throws Unavailable {
        MessagePreviewVaultProvisioning.Work retiring=work.target.program;
        if (Thread.currentThread()!=worker || activeAcquiring!=null || pendingAcquiring!=null || queuedErasure!=null
            || work.observe || retiring==null || retiring.operation!=work.target.operation
            || work.target.predecessorProgram!=abandoned || work.state.acquisition==null
            || work.state.acquisition.program!=abandoned || !work.state.acquisition.cancelled
            || work.state.acquisition.ticket!=null || retiring.original!=abandoned.original
            || abandoned.attempts!=0 || abandoned.keyRequestEntered || abandoned.candidateEntered
            || abandoned.checked!=null || abandoned.oldDeleted)
            throw new Unavailable();
        MessagePreviewVaultFence.Operation a=abandoned.operation, r=retiring.operation;
        if ((a.kind!=MessagePreviewVaultFence.Kind.BEGIN && a.kind!=MessagePreviewVaultFence.Kind.REFUSED)
            || r.kind!=MessagePreviewVaultFence.Kind.RETIRE || r.baseGeneration!=a.generation
            || abandoned.original.header.generation!=a.baseGeneration || a.generation!=a.baseGeneration+1
            || r.generation!=r.baseGeneration+1 || r.operationId.equals(a.operationId) || r.vaultRevision<=a.vaultRevision)
            throw new Unavailable();
    }
    private void transitionCurrent(TransitionWork work) throws Exception {
        long now=SystemClock.elapsedRealtime();
        synchronized (this) { transitionMemory(work, now); }
        requireApplication(context, uid);
        now=SystemClock.elapsedRealtime();
        synchronized (this) { transitionMemory(work, now); }
    }
    private SecretKey transitionKey(TransitionWork work) throws Exception {
        transitionCurrent(work);
        SecretKey key=new MessagePreviewKeystoreReader(context, work.state.installation).loadMetadata();
        transitionCurrent(work);
        return key;
    }
    private static boolean sameHeader(MessagePreviewMetadataEnvelope.Header a, MessagePreviewMetadataEnvelope.Header b) {
        return a != null && b != null && a.installation.equals(b.installation) && a.generation == b.generation
            && a.kind == b.kind && a.alias.equals(b.alias) && a.expiresWallMillis == b.expiresWallMillis
            && a.wallHighWaterMillis == b.wallHighWaterMillis && a.operationId.equals(b.operationId)
            && a.baseGeneration == b.baseGeneration && a.vaultRevision == b.vaultRevision;
    }
    private void performTransition(TransitionWork work) {
        TransitionResult result=new TransitionResult(TransitionStatus.INCOMPLETE, null);
        boolean finished=false;
        try {
            MessagePreviewMetadataEnvelope.Record readback;
            if (work.observe) {
                SecretKey key=transitionKey(work);
                readback=work.state.journal.read(work.state.installation, key);
                transitionCurrent(work);
            } else readback=writeRetirement(work);
            if (!sameHeader(readback.header, work.target.expectedFinal) || readback.credentialBytes().length != 0)
                throw new Unavailable();
            transitionKey(work); // A retained Java key reference alone is not current key availability.
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                transitionMemory(work, now);
                if (!work.target.completed && !work.state.fence.complete(work.target.operation)) throw new Unavailable();
                work.target.completed=true; work.state.checkedHead=readback; work.state.uncertain=false;
                // Completed erasure owns the checked head; unresolved acquisition history stays retained on refusal.
                if (work.state.acquisition != null && work.state.acquisition.program == work.target.predecessorProgram)
                    work.state.acquisition=null;
                finished=true;
                result=new TransitionResult(TransitionStatus.RETIRED, readback.header.generation);
            }
        } catch (Exception refused) { /* Unknown/partial bytes retain exact correlation, never reset/replay. */ }
        finally {
            synchronized (this) {
                if (!finished && initialized == work.state && work.state.current == work.target) work.state.uncertain=true;
                if (activeTransition == work) { activeTransition=null; busy=false; }
            }
        }
        // Historical checked operation only, not a current capability or credential lease.
        deliverTransition(work.completion, result);
    }
    private MessagePreviewMetadataEnvelope.Record writeRetirement(TransitionWork work) throws Exception {
        if (work.target.program != null) {
            MessagePreviewVaultProvisioning program=new MessagePreviewVaultProvisioning(context, uid, worker,
                work.state.journal, work.state.fence, work.target.program,
                new MessagePreviewVaultProvisioning.Current() {
                    @Override public void requireCurrent() throws Exception { transitionCurrent(work); }
                    @Override public void requireUnmaterialized(MessagePreviewVaultProvisioning.Work abandoned) throws Exception {
                        transitionCurrent(work);
                        synchronized (MessagePreviewPristineInitializer.this) { unmaterializedMemory(work, abandoned); }
                    }
                }, null);
            MessagePreviewMetadataEnvelope.Record result=program.retire(work.target.predecessorProgram);
            work.target.expectedFinal=result.header;
            return result;
        }
        SecretKey key=transitionKey(work);
        MessagePreviewMetadataEnvelope.Record predecessor=work.state.journal.read(work.state.installation, key);
        transitionCurrent(work);
        if (!sameHeader(predecessor.header, work.target.predecessor.header)
            || !Arrays.equals(predecessor.credentialBytes(), work.target.predecessor.credentialBytes())
            || predecessor.header.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            || !predecessor.header.alias.isEmpty() || predecessor.credentialBytes().length != 0
            || predecessor.header.generation != work.target.operation.baseGeneration) throw new Unavailable();
        long wall=System.currentTimeMillis();
        if (!MessagePreviewVerificationState.safe(wall)) throw new Unavailable();
        wall=Math.max(wall, predecessor.header.wallHighWaterMillis);
        MessagePreviewVaultFence.Operation operation=work.target.operation;
        MessagePreviewMetadataEnvelope.Header empty=new MessagePreviewMetadataEnvelope.Header(work.state.installation,
            operation.generation, MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0, wall, operation.operationId,
            operation.baseGeneration, operation.vaultRevision);
        transitionCurrent(work);
        work.target.expectedFinal=empty;
        MessagePreviewMetadataEnvelope.Header retiring=new MessagePreviewMetadataEnvelope.Header(work.state.installation,
            operation.generation, MessagePreviewMetadataEnvelope.Kind.RETIRING, "", 0, wall, operation.operationId,
            operation.baseGeneration, operation.vaultRevision);
        writeTransitionRecord(work, retiring);
        writeTransitionRecord(work, empty);
        key=transitionKey(work);
        MessagePreviewMetadataEnvelope.Record result=work.state.journal.read(work.state.installation, key);
        transitionCurrent(work);
        return result;
    }
    private void writeTransitionRecord(TransitionWork work, MessagePreviewMetadataEnvelope.Header header) throws Exception {
        SecretKey key=transitionKey(work);
        byte[] bytes=MessagePreviewMetadataEnvelope.seal(header, new byte[0], key);
        transitionCurrent(work);
        // An entered kernel write may finish despite cancellation; no next write/ACK follows a stale return.
        if (work.state.journal.write(bytes, work.state.installation, key) != MessagePreviewJournalIO.Result.CHECKED)
            throw new Unavailable();
        transitionCurrent(work);
    }

    private void acquiringMemory(AcquiringTask work, long now) throws Unavailable {
        MessagePreviewVaultProvisioning.Work program=work.target.program;
        if (Thread.currentThread()!=worker || closed || !busy || activeAcquiring!=work || initialized!=work.state
            || work.state.acquisition!=work.target || now<work.state.lastMillis || now<0 || now>=work.deadline)
            throw new Unavailable();
        if (!work.observe && (work.target.cancelled || (program.operation.kind==MessagePreviewVaultFence.Kind.BEGIN
            ? !work.state.fence.canContinue(program.operation) : !work.state.fence.canErase(program.operation))))
            throw new Unavailable();
        if (!work.observe && program.validatedExpiry>0 && !program.unexpiredAt(program.validatedExpiry, now)) throw new Unavailable();
        if (!work.observe && program.producerPermit!=null
            && (program.producerPermit.revoked || now>=program.producerPermit.deadline)) throw new Unavailable();
        work.state.lastMillis=now;
    }
    private void acquiringCurrent(AcquiringTask work) throws Exception {
        long now=SystemClock.elapsedRealtime();
        synchronized (this) { acquiringMemory(work, now); }
        requireApplication(context, uid);
        if (!work.observe && work.target.program.operation.kind==MessagePreviewVaultFence.Kind.BEGIN) {
            if (provisioningAuthority==null) throw new Unavailable();
            provisioningAuthority.requireCurrent(work.target.program.identity);
        }
        if (!work.observe && work.target.program.validatedExpiry>0) {
            long observed=System.currentTimeMillis(); long elapsed=SystemClock.elapsedRealtime();
            if (work.target.program.advanceWall(elapsed, observed)>=work.target.program.validatedExpiry) throw new Unavailable();
        }
        now=SystemClock.elapsedRealtime();
        synchronized (this) { acquiringMemory(work, now); }
    }
    private void performAcquiring(AcquiringTask work) {
        ProvisionResult result=new ProvisionResult(ProvisionStatus.INCOMPLETE, null, null);
        boolean finished=false;
        try {
            MessagePreviewVaultProvisioning program=new MessagePreviewVaultProvisioning(context, uid, worker,
                work.state.journal, work.state.fence, work.target.program,
                new MessagePreviewVaultProvisioning.Current() {
                    @Override public void requireCurrent() throws Exception { acquiringCurrent(work); }
                }, provisioningAuthority);
            MessagePreviewMetadataEnvelope.Record record=work.observe ? program.observe()
                : work.begin ? program.begin() : program.provision(work.access);
            acquiringCurrent(work);
            String ticket=work.begin && work.target.program.operation.kind==MessagePreviewVaultFence.Kind.BEGIN
                ? MessagePreviewVaultProvisioning.opaque() : null;
            long now=SystemClock.elapsedRealtime();
            synchronized (this) {
                acquiringMemory(work, now);
                if (work.observe) {
                    result=new ProvisionResult(record.header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED
                        ? ProvisionStatus.DORMANT : ProvisionStatus.INCOMPLETE, record.header.generation, null);
                } else {
                    if (!work.begin && !work.target.program.unexpiredAt(record.header.expiresWallMillis, now)) throw new Unavailable();
                    if (ticket==null && !work.state.fence.complete(work.target.program.operation)) throw new Unavailable();
                    work.target.ticket=ticket;
                    work.target.program.completed=ticket==null;
                    work.state.checkedHead=record; work.state.uncertain=false;
                    result=new ProvisionResult(ticket!=null ? ProvisionStatus.PENDING
                        : work.begin ? ProvisionStatus.INVALID_OWNER : ProvisionStatus.COMMITTED, record.header.generation, ticket,
                        record.header.kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED ? record.header.expiresWallMillis : null);
                }
                finished=true;
            }
        } catch (Exception refused) { /* Retain exact entered history/key residue, without replay or inferred ACK. */ }
        finally {
            work.access=null;
            synchronized (this) {
                if (!finished && !work.observe && initialized==work.state && work.state.acquisition==work.target)
                    work.state.uncertain=true;
                if (activeAcquiring==work) {
                    activeAcquiring=null;
                    if (queuedErasure!=null) {
                        activeTransition=queuedErasure; pendingTransition=queuedErasure; queuedErasure=null; notifyAll();
                    } else busy=false;
                }
            }
        }
        deliverProvision(work.completion, result);
    }
}
