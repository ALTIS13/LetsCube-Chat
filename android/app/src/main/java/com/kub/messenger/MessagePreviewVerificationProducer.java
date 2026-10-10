package com.kub.messenger;

// Dormant conditional port. No plugin caller, executor, ticket/credential getter or activation.
final class MessagePreviewVerificationProducer implements MessagePreviewVaultProvisioning.Authority {
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private static final class Admission {
        final MessagePreviewVaultProvisioning.Identity submitted;
        final Object lifecycle;
        final long originalDeadline;
        MessagePreviewVaultProvisioning.Identity invocation;
        boolean attempted, refused;
        Admission(MessagePreviewVaultProvisioning.Identity submitted, Object lifecycle, long originalDeadline) {
            this.submitted = submitted; this.lifecycle = lifecycle; this.originalDeadline = originalDeadline;
        }
    }
    private final MessagePreviewVerificationRuntime runtime;
    private final MessagePreviewInitializationGate.ForegroundAuthority lifecycleAuthority;
    private final String publicKey;
    private Admission current;
    private boolean closed;

    MessagePreviewVerificationProducer(MessagePreviewVerificationRuntime runtime,
            MessagePreviewInitializationGate.ForegroundAuthority lifecycleAuthority, String publicKey) throws Unavailable {
        require(runtime != null && lifecycleAuthority != null && MessagePreviewVerificationRuntime.header(publicKey, 4096));
        this.runtime = runtime; this.lifecycleAuthority = lifecycleAuthority; this.publicKey = publicKey;
    }
    private static void require(boolean value) throws Unavailable { if (!value) throw new Unavailable(); }
    private static boolean shape(MessagePreviewVaultProvisioning.Identity identity) {
        if (identity == null || identity.context == null || identity.owner == null) return false;
        MessagePreviewVaultFence.Context c = identity.context;
        MessagePreviewVaultFence.Owner o = identity.owner;
        return identity.operationId != null && identity.operationId.matches("[0-9a-f]{32}")
            && MessagePreviewVerificationState.safe(identity.vaultRevision)
            && MessagePreviewVerificationState.safe(identity.baseGeneration)
            && identity.baseGeneration < 9007199254740990L && identity.vaultRevision < 9007199254740991L
            && identity.generation == identity.baseGeneration + 1
            && MessagePreviewVerificationState.safe(c.revision) && MessagePreviewVerificationState.safe(c.accountEpoch)
            && MessagePreviewVerificationState.uuid(c.epoch) && MessagePreviewVerificationState.uuid(c.recipient)
            && MessagePreviewVerificationState.uuid(c.session) && MessagePreviewVerificationState.uuid(o.device)
            && c.recipient.equals(o.recipient) && c.session.equals(o.session) && c.accountEpoch == o.accountEpoch;
    }
    private static boolean same(MessagePreviewVaultProvisioning.Identity a, MessagePreviewVaultProvisioning.Identity b) {
        return shape(b) && a.operationId.equals(b.operationId) && a.vaultRevision == b.vaultRevision
            && a.baseGeneration == b.baseGeneration && a.generation == b.generation
            && a.context.revision == b.context.revision && a.context.accountEpoch == b.context.accountEpoch
            && a.context.epoch.equals(b.context.epoch) && a.context.recipient.equals(b.context.recipient)
            && a.context.session.equals(b.context.session) && a.owner.device.equals(b.owner.device);
    }
    private boolean runtimeCurrent(Admission admitted, MessagePreviewVaultProvisioning.Identity identity) {
        MessagePreviewVaultFence.Context c = identity.context;
        return runtime.producerCurrent(admitted, c.revision, c.epoch, c.recipient, c.session, c.accountEpoch, identity.owner.device)
            && (admitted.originalDeadline == Long.MAX_VALUE || runtime.deadlineFuture(admitted.originalDeadline));
    }
    // Credential-free admission does not begin/reset/verify Task5 or initialize a vault.
    void arm(MessagePreviewVaultProvisioning.Identity submitted) throws Unavailable {
        // The unsafe sentinel is internal only; legacy callers add no clock/deadline guard.
        armInternal(submitted, Long.MAX_VALUE);
    }
    void arm(MessagePreviewVaultProvisioning.Identity submitted, long originalDeadline) throws Unavailable {
        require(runtime.deadlineFuture(originalDeadline));
        armInternal(submitted, originalDeadline);
    }
    private void armInternal(MessagePreviewVaultProvisioning.Identity submitted, long originalDeadline) throws Unavailable {
        require(shape(submitted));
        try {
            Object lifecycle = lifecycleAuthority.capture();
            require(lifecycle != null && lifecycleAuthority.isCurrent(lifecycle));
            synchronized (this) {
                require(originalDeadline == Long.MAX_VALUE || runtime.deadlineFuture(originalDeadline));
                require(!closed && (current == null || !runtimeCurrent(current, current.submitted)));
                Admission next = new Admission(submitted, lifecycle, originalDeadline);
                MessagePreviewVaultFence.Context c = submitted.context;
                require(runtime.admitProducer(next, c.revision, c.epoch, c.recipient, c.session, c.accountEpoch, submitted.owner.device));
                current = next;
            }
        } catch (Exception refused) { throw new Unavailable(); }
    }
    @Override public void requireCurrent(MessagePreviewVaultProvisioning.Identity identity) throws Unavailable {
        Admission admitted;
        synchronized (this) {
            admitted = current;
            require(!closed && admitted != null && !admitted.refused && same(admitted.submitted, identity)
                && (admitted.invocation == null || admitted.invocation == identity));
        }
        try {
            require(lifecycleAuthority.isCurrent(admitted.lifecycle) && runtimeCurrent(admitted, identity));
        } catch (Exception refused) { throw new Unavailable(); }
        synchronized (this) { require(!closed && current == admitted && !admitted.refused); }
    }
    @Override public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,
            String borrowedAccess, long deadlineElapsedMillis) throws Unavailable {
        throw new Unavailable();
    }
    @Override public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,
            String borrowedAccess, long deadlineElapsedMillis, MessagePreviewVaultProvisioning.Current ownerCurrent) throws Unavailable {
        Admission admitted = null;
        try {
            require(ownerCurrent != null);
            ownerCurrent.requireCurrent(); requireCurrent(identity);
            synchronized (this) {
                require(!closed && current != null && !current.refused && same(current.submitted, identity)
                    && !current.attempted);
                admitted = current;
                admitted.attempted = true; admitted.invocation = identity;
            }
            require(MessagePreviewVerificationState.safe(deadlineElapsedMillis));
            long deadline = Math.min(admitted.originalDeadline, deadlineElapsedMillis);
            MessagePreviewVaultFence.Context c = identity.context;
            MessagePreviewVaultProvisioning.Verification result = runtime.verifyProducer(admitted, c.revision, c.epoch,
                c.recipient, c.session, c.accountEpoch, identity.owner.device, borrowedAccess, publicKey, deadline,
                new MessagePreviewVerificationRuntime.Producer<MessagePreviewVaultProvisioning.Verification>() {
                    @Override public void current() throws Exception {
                        ownerCurrent.requireCurrent(); requireCurrent(identity);
                    }
                    @Override public MessagePreviewVaultProvisioning.Verification complete(long expiry,
                            MessagePreviewVerificationState.ProducerPermit permit) throws Exception {
                        ownerCurrent.requireCurrent(); requireCurrent(identity);
                        return new MessagePreviewVaultProvisioning.Verification(identity, borrowedAccess, expiry, permit);
                    }
                });
            ownerCurrent.requireCurrent(); requireCurrent(identity); require(result != null);
            return result;
        } catch (Exception refused) {
            synchronized (this) { if (admitted != null && current == admitted) admitted.refused = true; }
            if (admitted != null) runtime.retireProducer(admitted);
            throw new Unavailable();
        }
    }
    void close() {
        Admission admitted;
        synchronized (this) { closed = true; admitted = current; current = null; }
        if (admitted != null) runtime.retireProducer(admitted);
    }
}
