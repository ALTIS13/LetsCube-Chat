package com.kub.messenger;

import java.util.HashSet;
import java.util.Set;

// Inactive, memory-only foundation. No plugin, persistence, verification or credential authority.
final class MessagePreviewVaultFence {
    private static final int MAX_OPERATIONS = 256;
    enum Decision { RESERVED, STALE_OWNER, INVALID_REQUEST, INVALID_OWNER, EXHAUSTED }
    enum Kind { BEGIN, RETIRE, REFUSED }

    static final class Context {
        final long revision, accountEpoch;
        final String epoch, recipient, session;
        Context(long revision, String epoch, String recipient, String session, long accountEpoch) {
            this.revision = revision; this.epoch = epoch;
            this.recipient = recipient; this.session = session; this.accountEpoch = accountEpoch;
        }
    }
    static final class Owner {
        final String recipient, session, device;
        final long accountEpoch;
        Owner(String recipient, String session, String device, long accountEpoch) {
            this.recipient = recipient; this.session = session;
            this.device = device; this.accountEpoch = accountEpoch;
        }
    }
    static final class Correlation {
        final String operationId;
        final long vaultRevision;
        Correlation(String operationId, long vaultRevision) {
            this.operationId = operationId; this.vaultRevision = vaultRevision;
        }
    }
    static final class Operation {
        final String operationId;
        final long vaultRevision, baseGeneration, generation;
        final Context context;
        final Owner owner;
        final Kind kind;
        private boolean closed, completed;
        private Operation(String operationId, long vaultRevision, long baseGeneration, long generation,
                          Context context, Owner owner, Kind kind) {
            this.operationId = operationId; this.vaultRevision = vaultRevision;
            this.baseGeneration = baseGeneration; this.generation = generation;
            this.context = context; this.owner = owner; this.kind = kind;
        }
    }
    static final class Admission {
        final Decision decision;
        final Operation operation;
        private Admission(Decision decision, Operation operation) {
            this.decision = decision; this.operation = operation;
        }
    }

    private final Set<String> seenIds = new HashSet<>();
    private long generation, vaultRevision = -1, contextRevision = -1;
    private Context context;
    private Operation current;

    // Future trusted metadata input; this constructor does not establish durable generation proof.
    MessagePreviewVaultFence(long initialGeneration) {
        if (!safe(initialGeneration)) throw new IllegalArgumentException("INVALID_GENERATION");
        generation = initialGeneration;
    }
    private static boolean safe(long value) {
        return MessagePreviewVerificationState.safe(value);
    }
    private static boolean uuid(String value) {
        return MessagePreviewVerificationState.uuid(value);
    }
    private static boolean operationId(String value) {
        return value != null && value.matches("[0-9a-f]{32}");
    }
    private static boolean validContext(Context value) {
        return value != null && safe(value.revision) && safe(value.accountEpoch)
            && uuid(value.epoch) && uuid(value.recipient) && uuid(value.session);
    }
    private static boolean sameContext(Context left, Context right) {
        return left != null && right != null && left.revision == right.revision
            && left.epoch.equals(right.epoch) && left.recipient.equals(right.recipient)
            && left.session.equals(right.session) && left.accountEpoch == right.accountEpoch;
    }
    private static boolean ownerMatches(Context captured, Owner owner) {
        return owner != null && uuid(owner.recipient) && uuid(owner.session) && uuid(owner.device)
            && safe(owner.accountEpoch) && owner.recipient.equals(captured.recipient)
            && owner.session.equals(captured.session) && owner.accountEpoch == captured.accountEpoch;
    }
    private static Admission rejected(Decision decision) {
        return new Admission(decision, null);
    }

    // Only a future trusted Task5 lifecycle adapter may supply these snapshots; no SDK is read here.
    synchronized boolean bindContext(Context next) {
        if (!validContext(next) || next.revision <= contextRevision) return false;
        contextRevision = next.revision; context = next;
        return true;
    }
    synchronized boolean clearContext(long next) {
        if (!safe(next) || next <= contextRevision) return false;
        contextRevision = next; context = null;
        return true;
    }
    synchronized boolean expireContext(Context expected) {
        if (!validContext(expected) || !sameContext(context, expected)) return false;
        context = null;
        return true;
    }
    private Decision intentError(String operationId, long nextRevision, long expectedGeneration) {
        if (!operationId(operationId) || !safe(nextRevision) || !safe(expectedGeneration)) return Decision.INVALID_REQUEST;
        if (nextRevision <= vaultRevision) return Decision.STALE_OWNER;
        if (seenIds.contains(operationId)) return Decision.INVALID_REQUEST;
        return null;
    }
    synchronized Admission begin(String operationId, long nextRevision, long expectedGeneration, Context captured, Owner owner) {
        Decision error = intentError(operationId, nextRevision, expectedGeneration);
        if (error != null) return rejected(error);
        if (!validContext(captured)) return rejected(Decision.INVALID_REQUEST);
        if (!sameContext(context, captured)) return rejected(Decision.STALE_OWNER);
        if (expectedGeneration != generation) return rejected(Decision.STALE_OWNER);
        boolean validOwner = ownerMatches(captured, owner);
        return reserve(operationId, nextRevision, validOwner ? captured : null, validOwner ? owner : null,
            validOwner ? Kind.BEGIN : Kind.REFUSED);
    }
    synchronized Admission retire(String operationId, long nextRevision, long expectedGeneration, Correlation lost) {
        Decision error = intentError(operationId, nextRevision, expectedGeneration);
        if (error != null) return rejected(error);
        if (lost != null && (!operationId(lost.operationId) || !safe(lost.vaultRevision)
            || lost.vaultRevision >= nextRevision)) return rejected(Decision.INVALID_REQUEST);
        boolean direct = generation == expectedGeneration;
        boolean correlated = lost != null && current != null && (current.kind == Kind.BEGIN || current.kind == Kind.REFUSED)
            && current.operationId.equals(lost.operationId) && current.vaultRevision == lost.vaultRevision
            && current.baseGeneration == expectedGeneration && current.generation == generation;
        // Target CAS precedes every fence/identity mutation; retirement deliberately needs no context.
        if (!direct && !correlated) return rejected(Decision.STALE_OWNER);
        return reserve(operationId, nextRevision, null, null, Kind.RETIRE);
    }
    private Admission reserve(String operationId, long nextRevision, Context captured, Owner owner, Kind kind) {
        if (generation == 9007199254740991L) return rejected(Decision.EXHAUSTED);
        // Every BEGIN intake, including REFUSED, leaves numeric headroom for exact erasure.
        if (kind != Kind.RETIRE && generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);
        if (kind != Kind.RETIRE && nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);
        // Never evict replay identities; keep the final slot available for erasure of the last begin.
        if (seenIds.size() >= MAX_OPERATIONS - (kind == Kind.RETIRE ? 0 : 1)) return rejected(Decision.EXHAUSTED);
        long base = generation;
        generation = base + 1; vaultRevision = nextRevision;
        seenIds.add(operationId);
        current = new Operation(operationId, nextRevision, base, generation, captured, owner, kind);
        return new Admission(kind == Kind.REFUSED ? Decision.INVALID_OWNER : Decision.RESERVED, current);
    }
    private boolean ownsContinuation(Operation operation) {
        return operation != null && current == operation && generation == operation.generation
            && vaultRevision == operation.vaultRevision && !operation.closed && !operation.completed;
    }
    synchronized boolean canContinue(Operation operation) {
        return ownsContinuation(operation) && operation.kind == Kind.BEGIN && sameContext(context, operation.context);
    }
    synchronized boolean canErase(Operation operation) {
        return ownsContinuation(operation) && (operation.kind == Kind.RETIRE || operation.kind == Kind.REFUSED);
    }
    // Only consumes a memory continuation. Never a durable ACK, ticket or verified/access-ready result.
    synchronized boolean complete(Operation operation) {
        if (!canContinue(operation) && !canErase(operation)) return false;
        operation.completed = true;
        return true;
    }
    synchronized boolean refuse(Operation operation) {
        if (!canContinue(operation) && !canErase(operation)) return false;
        operation.closed = true;
        return true;
    }
}
