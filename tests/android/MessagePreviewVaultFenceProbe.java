package com.kub.messenger;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class MessagePreviewVaultFenceProbe {
    private static final String USER_A = "10000000-0000-4000-8000-000000000001";
    private static final String USER_B = "10000000-0000-4000-8000-000000000002";
    private static final String SESSION_A = "20000000-0000-4000-8000-000000000001";
    private static final String SESSION_B = "20000000-0000-4000-8000-000000000002";
    private static final String DEVICE = "30000000-0000-4000-8000-000000000001";
    private static final String EPOCH_A = "40000000-0000-4000-8000-000000000001";
    private static final String EPOCH_B = "40000000-0000-4000-8000-000000000002";
    private static final String A = "0000000000000000000000000000000a";
    private static final String B = "0000000000000000000000000000000b";
    private static final String C = "0000000000000000000000000000000c";

    private static void check(boolean value, String oracle) {
        if (!value) throw new AssertionError(oracle);
    }
    private static MessagePreviewVaultFence.Context context(long revision) {
        return new MessagePreviewVaultFence.Context(revision, EPOCH_A, USER_A, SESSION_A, 2);
    }
    private static MessagePreviewVaultFence.Owner owner() {
        return new MessagePreviewVaultFence.Owner(USER_A, SESSION_A, DEVICE, 2);
    }
    private static MessagePreviewVaultFence fence() {
        MessagePreviewVaultFence fence = new MessagePreviewVaultFence(7);
        check(fence.bindContext(context(100)), "CONTEXT_SETUP");
        return fence;
    }
    private static Object field(Object value, String name) throws Exception {
        Field field = value.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(value);
    }
    private static long number(Object value, String name) throws Exception {
        return (Long) field(value, name);
    }
    private static List<Object> snapshot(MessagePreviewVaultFence fence) throws Exception {
        List<Object> values = new ArrayList<>();
        for (String name : new String[] {"generation", "vaultRevision", "contextRevision", "context", "current"}) {
            values.add(field(fence, name));
        }
        values.add(Set.copyOf((Set<?>) field(fence, "seenIds")));
        Object current = field(fence, "current");
        if (current != null) {
            for (String name : new String[] {"operationId", "vaultRevision", "baseGeneration", "generation", "context", "owner", "kind", "closed", "completed"}) {
                values.add(field(current, name));
            }
        }
        return values;
    }
    private static MessagePreviewVaultFence.Operation begin(MessagePreviewVaultFence fence, String id, long revision, long generation) {
        MessagePreviewVaultFence.Admission result = fence.begin(id, revision, generation, context(100), owner());
        check(result.decision == MessagePreviewVaultFence.Decision.RESERVED && result.operation != null, "BEGIN_SETUP");
        return result.operation;
    }
    private static void unchanged(MessagePreviewVaultFence fence, List<Object> before, String oracle) throws Exception {
        check(before.equals(snapshot(fence)), oracle);
    }
    private static void inactive() throws Exception {
        MessagePreviewVaultFence fence = new MessagePreviewVaultFence(7);
        List<Object> before = snapshot(fence);
        check(fence.begin(A, 1, 7, context(100), owner()).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "INACTIVE");
        unchanged(fence, before, "INACTIVE_NO_EFFECTS");
        check(!fence.canContinue(null) && !fence.complete(null) && !fence.refuse(null), "INACTIVE_NO_CONTINUATION");
    }
    private static void reserve() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        check(a.generation == 8 && a.baseGeneration == 7 && a.vaultRevision == 1, "RESERVATION_LITERAL");
        check(a.context.revision == 100 && number(fence, "contextRevision") == 100, "SEPARATE_DOMAINS");
        List<Object> before = snapshot(fence);
        check(fence.begin(B, 1, 8, context(100), owner()).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "INTENT_HIGH_WATER");
        unchanged(fence, before, "INTENT_NO_EFFECTS");
        MessagePreviewVaultFence.Operation b = begin(fence, B, 2, 8);
        check(b.generation == 9 && !fence.canContinue(a) && fence.canContinue(b), "RESERVED_SUCCESSOR");
        check(number(fence, "contextRevision") == 100 && b.context.epoch.equals(EPOCH_A), "NO_TASK5_ADVANCE");
    }
    private static void staleGeneration() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        List<Object> before = snapshot(fence);
        check(fence.begin(B, 999, 7, context(100), owner()).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "GENERATION_CAS");
        unchanged(fence, before, "GENERATION_NO_EFFECTS");
        check(fence.canContinue(a), "GENERATION_OWNER_PRESERVED");
        begin(fence, B, 2, 8);
    }
    private static void capturedContext(boolean epochOnly) throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Context wrong = epochOnly
            ? new MessagePreviewVaultFence.Context(100, EPOCH_B, USER_A, SESSION_A, 2) : context(99);
        List<Object> before = snapshot(fence);
        String oracle = epochOnly ? "CONTEXT_EPOCH" : "CAPTURED_CONTEXT";
        check(fence.begin(B, 9, 8, wrong, owner()).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, oracle);
        unchanged(fence, before, oracle);
        check(!fence.bindContext(wrong), "CONTEXT_HIGH_WATER");
        unchanged(fence, before, oracle);
        check(fence.canContinue(a), "CONTEXT_OWNER_PRESERVED");
    }
    private static void ownerGuard() throws Exception {
        MessagePreviewVaultFence.Owner[] wrong = {
            new MessagePreviewVaultFence.Owner(USER_B, SESSION_A, DEVICE, 2),
            new MessagePreviewVaultFence.Owner(USER_A, SESSION_B, DEVICE, 2),
            new MessagePreviewVaultFence.Owner(USER_A, SESSION_A, DEVICE, 3),
        };
        String[] oracles = {"OWNER_RECIPIENT", "OWNER_SESSION", "OWNER_ACCOUNT_EPOCH"};
        for (int i = 0; i < wrong.length; i++) {
            MessagePreviewVaultFence fence = fence();
            MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
            MessagePreviewVaultFence.Admission result = fence.begin(B, 2, 8, context(100), wrong[i]);
            check(result.decision == MessagePreviewVaultFence.Decision.INVALID_OWNER && result.operation != null
                && fence.canErase(result.operation) && !fence.canContinue(result.operation), oracles[i]);
            check(number(fence, "generation") == 9 && !fence.canContinue(a), "INVALID_OWNER_CLOSES_OLD");
        }
    }
    private static void capturedOwner() throws Exception {
        MessagePreviewVaultFence.Context[] wrong = {
            new MessagePreviewVaultFence.Context(100, EPOCH_A, USER_B, SESSION_A, 2),
            new MessagePreviewVaultFence.Context(100, EPOCH_A, USER_A, SESSION_B, 2),
            new MessagePreviewVaultFence.Context(100, EPOCH_A, USER_A, SESSION_A, 3),
        };
        String[] oracles = {"CAPTURED_RECIPIENT", "CAPTURED_SESSION", "CAPTURED_ACCOUNT_EPOCH"};
        for (int i = 0; i < wrong.length; i++) {
            MessagePreviewVaultFence fence = fence();
            MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
            List<Object> before = snapshot(fence);
            MessagePreviewVaultFence.Owner foreign = new MessagePreviewVaultFence.Owner(wrong[i].recipient, wrong[i].session, DEVICE, wrong[i].accountEpoch);
            check(fence.begin(B, 2, 8, wrong[i], foreign).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, oracles[i]);
            check(!fence.expireContext(wrong[i]), oracles[i]);
            unchanged(fence, before, oracles[i]);
            check(fence.complete(a), "CAPTURED_OWNER_HEALTHY_COMPLETION");
        }
    }
    private static void invalidOwner() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        List<Object> before = snapshot(fence);
        check(fence.begin(B, 9, 7, context(100), null).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "BAD_OWNER_STALE_CAS");
        unchanged(fence, before, "BAD_OWNER_STALE_NO_EFFECTS");
        MessagePreviewVaultFence.Admission result = fence.begin(B, 2, 8, context(100), null);
        check(result.decision == MessagePreviewVaultFence.Decision.INVALID_OWNER && result.operation != null
            && fence.canErase(result.operation) && !fence.canContinue(result.operation), "BAD_OWNER_ERASURE_ONLY");
        check(number(fence, "generation") == 9 && number(fence, "vaultRevision") == 2, "BAD_OWNER_RESERVES_ONCE");
        check(!fence.complete(a) && !fence.refuse(a), "BAD_OWNER_OLD_CONTINUATIONS");
    }
    private static void retireAfterLoss(boolean expiry) throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        if (expiry) check(fence.expireContext(context(100)), "EXPIRE_CURRENT");
        else check(fence.clearContext(101), "CLEAR_CURRENT");
        check(!fence.canContinue(a), "CONTEXT_LOSS_CONTINUATION");
        MessagePreviewVaultFence.Admission result = fence.retire(B, 2, 7, new MessagePreviewVaultFence.Correlation(A, 1));
        check(result.decision == MessagePreviewVaultFence.Decision.RESERVED && result.operation.generation == 9, "ERASURE_AFTER_CONTEXT_LOSS");
        check(!fence.canContinue(result.operation) && fence.canErase(result.operation)
            && fence.complete(result.operation), "ERASURE_COMPLETION_WITHOUT_CONTEXT");
        check(!fence.complete(a) && !fence.refuse(a), "LOST_ACK_OLD_CONTINUATION");
    }
    private static void invalidOwnerErasure() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Admission refused = fence.begin(B, 2, 8, context(100), null);
        check(refused.decision == MessagePreviewVaultFence.Decision.INVALID_OWNER && refused.operation != null,
            "INVALID_OWNER_ERASURE_RESERVATION");
        check(refused.operation.generation == 9 && refused.operation.baseGeneration == 8,
            "INVALID_OWNER_EXACT_ERASURE_TARGET");
        check(!fence.canContinue(refused.operation) && !fence.canContinue(a), "INVALID_OWNER_NO_ACCESS");
        check(fence.clearContext(101), "INVALID_OWNER_CONTEXT_CLEAR");
        check(fence.complete(refused.operation), "INVALID_OWNER_ERASURE_AFTER_CLEAR");
        check(!fence.complete(refused.operation), "INVALID_OWNER_SINGLE_ERASURE_COMPLETION");
        MessagePreviewVaultFence other = fence();
        begin(other, A, 1, 7);
        MessagePreviewVaultFence.Operation held = other.begin(B, 2, 8, context(100), null).operation;
        MessagePreviewVaultFence.Operation successor = begin(other, C, 3, 9);
        List<Object> before = snapshot(other);
        check(!other.canErase(held) && !other.complete(held) && !other.refuse(held), "INVALID_OWNER_LATE_ERASURE");
        unchanged(other, before, "INVALID_OWNER_SUCCESSOR_NO_EFFECTS");
        check(other.canContinue(successor) && !other.canErase(successor), "INVALID_OWNER_SUCCESSOR_ACCESS_ONLY");
    }
    private static void retireBeforeBegin() throws Exception {
        MessagePreviewVaultFence fence = fence();
        check(fence.clearContext(101), "CLEAR_BEFORE_BEGIN");
        MessagePreviewVaultFence.Admission retired = fence.retire(B, 2, 7, new MessagePreviewVaultFence.Correlation(A, 1));
        check(retired.decision == MessagePreviewVaultFence.Decision.RESERVED && retired.operation.generation == 8, "EARLY_RETIRE");
        check(fence.bindContext(context(102)), "REBIND_AFTER_CLEAR");
        List<Object> before = snapshot(fence);
        check(fence.begin(A, 1, 7, context(100), owner()).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "LATE_UNRECEIVED_BEGIN");
        unchanged(fence, before, "EARLY_RETIRE_NO_REOPEN");
    }
    private static void invalidOwnerLostAck() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Admission held = fence.begin(A, 1, 7, context(100), null);
        check(held.decision == MessagePreviewVaultFence.Decision.INVALID_OWNER && held.operation != null, "LOST_INVALID_OWNER_SETUP");
        check(fence.clearContext(101), "LOST_INVALID_OWNER_CLEAR");
        MessagePreviewVaultFence.Admission retired = fence.retire(B, 2, 7, new MessagePreviewVaultFence.Correlation(A, 1));
        check(retired.decision == MessagePreviewVaultFence.Decision.RESERVED && retired.operation.generation == 9,
            "INVALID_OWNER_LOST_ACK_ERASURE");
        check(fence.canErase(retired.operation) && !fence.canContinue(retired.operation), "LOST_INVALID_OWNER_ERASURE_ONLY");
        check(!fence.complete(held.operation) && !fence.refuse(held.operation), "LOST_INVALID_OWNER_LATE_ACK");
        check(fence.complete(retired.operation), "LOST_INVALID_OWNER_CURRENT_COMPLETION");

        MessagePreviewVaultFence mismatched = fence();
        mismatched.begin(A, 1, 7, context(100), null);
        check(mismatched.expireContext(context(100)), "LOST_INVALID_OWNER_EXPIRE");
        MessagePreviewVaultFence.Correlation[] wrong = {
            new MessagePreviewVaultFence.Correlation(C, 1), new MessagePreviewVaultFence.Correlation(A, 0),
            new MessagePreviewVaultFence.Correlation(A, 1),
        };
        for (int i = 0; i < wrong.length; i++) {
            List<Object> beforeMismatch = snapshot(mismatched);
            check(mismatched.retire(B, 2, i == 2 ? 6 : 7, wrong[i]).decision == MessagePreviewVaultFence.Decision.STALE_OWNER,
                "REFUSED_CORRELATION_EXACT_FIELDS");
            unchanged(mismatched, beforeMismatch, "REFUSED_CORRELATION_NO_EFFECTS");
        }

        MessagePreviewVaultFence foreign = fence();
        foreign.begin(A, 1, 7, context(100), null);
        MessagePreviewVaultFence.Operation b = begin(foreign, B, 2, 8);
        List<Object> before = snapshot(foreign);
        check(foreign.retire(C, 999, 7, new MessagePreviewVaultFence.Correlation(A, 1)).decision == MessagePreviewVaultFence.Decision.STALE_OWNER,
            "LOST_INVALID_OWNER_FOREIGN_SUCCESSOR");
        unchanged(foreign, before, "LOST_INVALID_OWNER_FOREIGN_NO_EFFECTS");
        check(foreign.canContinue(b), "LOST_INVALID_OWNER_B_PRESERVED");

        MessagePreviewVaultFence explicit = fence();
        MessagePreviewVaultFence.Operation r = explicit.retire(A, 1, 7, null).operation;
        before = snapshot(explicit);
        check(explicit.retire(B, 2, 7, new MessagePreviewVaultFence.Correlation(A, 1)).decision == MessagePreviewVaultFence.Decision.STALE_OWNER,
            "RETIRE_NOT_BEGIN_CORRELATION");
        unchanged(explicit, before, "EXPLICIT_RETIRE_NO_CORRELATION_EFFECTS");
        check(explicit.canErase(r), "EXPLICIT_RETIRE_PRESERVED");
    }
    private static void correlation() throws Exception {
        MessagePreviewVaultFence fence = fence();
        begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Correlation[] wrong = {
            new MessagePreviewVaultFence.Correlation(C, 1), new MessagePreviewVaultFence.Correlation(A, 0),
            new MessagePreviewVaultFence.Correlation(A, 1),
        };
        String[] oracles = {"CORRELATION_ID", "CORRELATION_REVISION", "CORRELATION_BASE"};
        for (int i = 0; i < wrong.length; i++) {
            List<Object> before = snapshot(fence);
            check(fence.retire(B, 3, i == 2 ? 6 : 7, wrong[i]).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, oracles[i]);
            unchanged(fence, before, oracles[i]);
        }
        check(fence.retire(B, 2, 7, new MessagePreviewVaultFence.Correlation(A, 1)).operation.generation == 9, "EXACT_CORRELATION");
    }
    private static void foreignSuccessor() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Context bContext = new MessagePreviewVaultFence.Context(101, EPOCH_B, USER_B, SESSION_B, 3);
        check(fence.bindContext(bContext), "B_CONTEXT");
        MessagePreviewVaultFence.Admission b = fence.begin(B, 2, 8, bContext, new MessagePreviewVaultFence.Owner(USER_B, SESSION_B, DEVICE, 3));
        check(b.decision == MessagePreviewVaultFence.Decision.RESERVED, "B_BEGIN");
        List<Object> before = snapshot(fence);
        check(fence.retire(C, 999, 7, new MessagePreviewVaultFence.Correlation(A, 1)).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "FOREIGN_SUCCESSOR");
        unchanged(fence, before, "FOREIGN_SUCCESSOR");
        check(fence.canContinue(b.operation) && !fence.complete(a) && !fence.refuse(a), "B_CONTINUATION");
        unchanged(fence, before, "B_NO_LATE_EFFECTS");
        check(fence.retire(C, 3, 9, null).decision == MessagePreviewVaultFence.Decision.RESERVED, "NO_POISONED_HIGH_WATER");
    }
    private static void duplicateId() throws Exception {
        MessagePreviewVaultFence fence = fence();
        begin(fence, A, 1, 7);
        List<Object> before = snapshot(fence);
        check(fence.begin(A, 2, 8, context(100), owner()).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "DUPLICATE_ID");
        unchanged(fence, before, "DUPLICATE_NO_EFFECTS");
        begin(fence, B, 2, 8);
        before = snapshot(fence);
        check(fence.retire(A, 3, 9, null).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "SUPERSEDED_ID_NO_REPLAY");
        unchanged(fence, before, "SUPERSEDED_ID_NO_EFFECTS");
    }
    private static void lateCompletion() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Operation b = begin(fence, B, 2, 8);
        List<Object> before = snapshot(fence);
        check(!fence.complete(a), "LATE_COMPLETION");
        unchanged(fence, before, "LATE_COMPLETION");
        check(fence.complete(b), "CURRENT_MEMORY_COMPLETION");
        check(!fence.complete(b), "ONE_COMPLETION");
        check(!fence.refuse(b), "COMPLETED_NO_REFUSAL");
    }
    private static void lateRefusal() throws Exception {
        MessagePreviewVaultFence fence = fence();
        MessagePreviewVaultFence.Operation a = begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Operation b = begin(fence, B, 2, 8);
        List<Object> before = snapshot(fence);
        check(!fence.refuse(a), "LATE_REFUSAL");
        unchanged(fence, before, "LATE_REFUSAL");
        check(fence.refuse(b) && !fence.canContinue(b) && !fence.complete(b), "CURRENT_REFUSAL");
        check(fence.retire(C, 3, 8, new MessagePreviewVaultFence.Correlation(B, 2)).decision == MessagePreviewVaultFence.Decision.RESERVED, "REFUSAL_RETAINS_ERASURE_TARGET");
    }
    private static void erasureCompletion() throws Exception {
        MessagePreviewVaultFence fence = fence();
        begin(fence, A, 1, 7);
        MessagePreviewVaultFence.Operation retired = fence.retire(B, 2, 8, null).operation;
        MessagePreviewVaultFence.Operation c = begin(fence, C, 3, 9);
        List<Object> before = snapshot(fence);
        check(!fence.complete(retired) && !fence.refuse(retired), "OLD_ERASURE_CONTINUATION");
        unchanged(fence, before, "ERASURE_NO_SUCCESSOR_EFFECTS");
        check(fence.canContinue(c), "SUCCESSOR_AFTER_ERASURE");
        check(fence.clearContext(101), "LOSE_CONTEXT_AFTER_ERASURE");
        check(!fence.complete(c), "CONTEXT_LOST_COMPLETION");
    }
    private static void bounds() throws Exception {
        MessagePreviewVaultFence fence = fence();
        List<Object> before = snapshot(fence);
        check(fence.begin(A, 9007199254740992L, 7, context(100), owner()).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "UNSAFE_INTENT");
        unchanged(fence, before, "UNSAFE_NO_EFFECTS");
        for (long bad : new long[] {-1, 9007199254740992L}) {
            check(fence.retire(A, 1, bad, null).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "BAD_EXPECTED_GENERATION");
            check(!fence.clearContext(bad) && !fence.bindContext(context(bad)), "BAD_CONTEXT_NUMBER");
            unchanged(fence, before, "BAD_NUMBERS_NO_EFFECTS");
            boolean refused = false;
            try { new MessagePreviewVaultFence(bad); } catch (IllegalArgumentException expected) { refused = true; }
            check(refused, "BAD_BOOTSTRAP_GENERATION");
        }
        MessagePreviewVaultFence exhausted = new MessagePreviewVaultFence(9007199254740991L);
        check(exhausted.bindContext(context(100)), "MAX_CONTEXT_SETUP");
        before = snapshot(exhausted);
        check(exhausted.begin(A, 1, 9007199254740991L, context(100), owner()).decision == MessagePreviewVaultFence.Decision.EXHAUSTED, "GENERATION_EXHAUSTION");
        unchanged(exhausted, before, "EXHAUSTION_NO_EFFECTS");
        check(exhausted.retire(B, 1, 9007199254740991L, null).decision == MessagePreviewVaultFence.Decision.EXHAUSTED, "RETIRE_EXHAUSTION");
        unchanged(exhausted, before, "RETIRE_EXHAUSTION_NO_EFFECTS");
        before = snapshot(fence);
        check(fence.begin(A, 9007199254740991L, 7, context(100), owner()).decision == MessagePreviewVaultFence.Decision.EXHAUSTED,
            "MAX_INTENT_RESERVED_FOR_ERASURE");
        unchanged(fence, before, "MAX_BEGIN_INTENT_NO_EFFECTS");
        MessagePreviewVaultFence.Operation a = begin(fence, A, 9007199254740990L, 7);
        check(fence.canContinue(a), "PREMAX_INTENT_ALLOWED");
        before = snapshot(fence);
        check(fence.retire(B, 9007199254740990L, 8, null).decision == MessagePreviewVaultFence.Decision.STALE_OWNER, "NO_INTENT_WRAP");
        unchanged(fence, before, "NO_INTENT_WRAP_EFFECTS");
    }
    private static void syntax() throws Exception {
        for (String id : new String[] {null, "", "a", "0000000000000000000000000000000A", A + "0"}) {
            MessagePreviewVaultFence fence = fence();
            List<Object> before = snapshot(fence);
            check(fence.begin(id, 1, 7, context(100), owner()).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "BAD_OPERATION_ID");
            check(fence.retire(id, 1, 7, null).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "BAD_RETIRE_ID");
            unchanged(fence, before, "BAD_ID_NO_EFFECTS");
        }
        MessagePreviewVaultFence fence = fence();
        List<Object> before = snapshot(fence);
        check(fence.begin(A, 1, 7, null, owner()).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "BAD_CONTEXT_HANDLE");
        check(fence.retire(A, 1, 7, new MessagePreviewVaultFence.Correlation("bad", 0)).decision == MessagePreviewVaultFence.Decision.INVALID_REQUEST, "BAD_CORRELATION_SYNTAX");
        check(!fence.bindContext(new MessagePreviewVaultFence.Context(101, "bad", USER_A, SESSION_A, 2)), "BAD_CONTEXT_UUID");
        unchanged(fence, before, "BAD_SYNTAX_NO_EFFECTS");
    }
    private static void lockedCas() throws Exception {
        MessagePreviewVaultFence fence = fence();
        CountDownLatch ready = new CountDownLatch(2), start = new CountDownLatch(1);
        MessagePreviewVaultFence.Admission[] replies = new MessagePreviewVaultFence.Admission[2];
        Throwable[] failures = new Throwable[2];
        Thread[] workers = new Thread[2];
        for (int i = 0; i < 2; i++) {
            final int index = i;
            workers[i] = new Thread(() -> {
                try {
                    ready.countDown();
                    check(start.await(2, TimeUnit.SECONDS), "CAS_START_TIMEOUT");
                    replies[index] = fence.begin(index == 0 ? A : B, index + 1, 7, context(100), owner());
                } catch (Throwable error) { failures[index] = error; }
            });
            workers[i].start();
        }
        check(ready.await(2, TimeUnit.SECONDS), "CAS_READY_TIMEOUT");
        start.countDown();
        for (Thread worker : workers) { worker.join(2_000); check(!worker.isAlive(), "CAS_JOIN_TIMEOUT"); }
        for (Throwable failure : failures) check(failure == null, "CAS_THREAD_FAILURE");
        int reserved = 0, stale = 0;
        for (MessagePreviewVaultFence.Admission reply : replies) {
            if (reply.decision == MessagePreviewVaultFence.Decision.RESERVED) reserved++;
            if (reply.decision == MessagePreviewVaultFence.Decision.STALE_OWNER) stale++;
        }
        check(reserved == 1 && stale == 1 && number(fence, "generation") == 8, "LOCKED_CAS_ONE_RESERVATION");
    }
    private static void boundedIdentities() throws Exception {
        MessagePreviewVaultFence fence = fence();
        for (int i = 0; i < 255; i++) {
            MessagePreviewVaultFence.Admission result = fence.begin(String.format("%032x", i), i, 7 + i, context(100), owner());
            check(result.decision == MessagePreviewVaultFence.Decision.RESERVED, "IDENTITY_CAPACITY_CONTROL");
        }
        List<Object> before = snapshot(fence);
        check(fence.begin(String.format("%032x", 255), 255, 262, context(100), owner()).decision == MessagePreviewVaultFence.Decision.EXHAUSTED, "IDENTITY_EXHAUSTION");
        unchanged(fence, before, "IDENTITY_EXHAUSTION_NO_EFFECTS");
        MessagePreviewVaultFence.Admission retired = fence.retire(String.format("%032x", 255), 255, 262, null);
        check(retired.decision == MessagePreviewVaultFence.Decision.RESERVED && fence.complete(retired.operation), "IDENTITY_CAP_RETAINS_ERASURE_SLOT");
    }
    private static void generationHeadroom() throws Exception {
        for (boolean refusedOwner : new boolean[] {false, true}) {
            MessagePreviewVaultFence.Owner submitted = refusedOwner ? null : owner();
            MessagePreviewVaultFence fence = new MessagePreviewVaultFence(9007199254740990L);
            check(fence.bindContext(context(100)), "GENERATION_HEADROOM_CONTEXT");
            List<Object> before = snapshot(fence);
            MessagePreviewVaultFence.Admission exhausted = fence.begin(A, 1, 9007199254740990L, context(100), submitted);
            String oracle = refusedOwner ? "REFUSED_GENERATION_HEADROOM" : "BEGIN_GENERATION_HEADROOM";
            check(exhausted.decision == MessagePreviewVaultFence.Decision.EXHAUSTED && exhausted.operation == null, oracle);
            unchanged(fence, before, oracle);
            MessagePreviewVaultFence.Admission terminal = fence.retire(B, 2, 9007199254740990L, null);
            check(terminal.decision == MessagePreviewVaultFence.Decision.RESERVED && terminal.operation.generation == 9007199254740991L,
                "FINAL_GENERATION_RETIRE_ALLOWED");
            check(!fence.canContinue(terminal.operation) && fence.canErase(terminal.operation), "FINAL_GENERATION_ERASURE_ONLY");

            MessagePreviewVaultFence beforeBoundary = new MessagePreviewVaultFence(9007199254740989L);
            check(beforeBoundary.bindContext(context(100)), "PREBOUNDARY_GENERATION_CONTEXT");
            MessagePreviewVaultFence.Admission a = beforeBoundary.begin(A, 1, 9007199254740989L, context(100), submitted);
            check(a.decision == (refusedOwner ? MessagePreviewVaultFence.Decision.INVALID_OWNER : MessagePreviewVaultFence.Decision.RESERVED)
                && a.operation != null && a.operation.generation == 9007199254740990L, "PREBOUNDARY_GENERATION_ALLOWED");
            check(refusedOwner ? beforeBoundary.canErase(a.operation) : beforeBoundary.canContinue(a.operation), "PREBOUNDARY_GENERATION_CONTINUATION");
            before = snapshot(beforeBoundary);
            check(beforeBoundary.begin(B, 2, 9007199254740990L, context(100), submitted).decision == MessagePreviewVaultFence.Decision.EXHAUSTED, oracle);
            unchanged(beforeBoundary, before, "GENERATION_EXHAUSTED_OWNER_PRESERVED");
            terminal = beforeBoundary.retire(B, 2, 9007199254740989L, new MessagePreviewVaultFence.Correlation(A, 1));
            check(terminal.decision == MessagePreviewVaultFence.Decision.RESERVED && terminal.operation.generation == 9007199254740991L,
                "PREBOUNDARY_GENERATION_CORRELATED_RETIRE");
            check(!beforeBoundary.canContinue(a.operation) && !beforeBoundary.canErase(a.operation), "PREBOUNDARY_GENERATION_OLD_OWNER_CLOSED");
            check(beforeBoundary.clearContext(101) && beforeBoundary.complete(terminal.operation), "FINAL_GENERATION_ERASURE_AFTER_CLEAR");
        }
    }
    private static void intentHeadroom() throws Exception {
        for (boolean refusedOwner : new boolean[] {false, true}) {
            MessagePreviewVaultFence.Owner submitted = refusedOwner ? null : owner();
            MessagePreviewVaultFence fence = fence();
            List<Object> before = snapshot(fence);
            MessagePreviewVaultFence.Admission exhausted = fence.begin(A, 9007199254740991L, 7, context(100), submitted);
            String oracle = refusedOwner ? "REFUSED_INTENT_HEADROOM" : "BEGIN_INTENT_HEADROOM";
            check(exhausted.decision == MessagePreviewVaultFence.Decision.EXHAUSTED && exhausted.operation == null, oracle);
            unchanged(fence, before, oracle);
            MessagePreviewVaultFence.Admission a = fence.begin(A, 9007199254740990L, 7, context(100), submitted);
            check(a.decision == (refusedOwner ? MessagePreviewVaultFence.Decision.INVALID_OWNER : MessagePreviewVaultFence.Decision.RESERVED)
                && a.operation != null && a.operation.generation == 8, "PREBOUNDARY_INTENT_ALLOWED");
            check(refusedOwner ? fence.canErase(a.operation) : fence.canContinue(a.operation), "PREBOUNDARY_INTENT_CONTINUATION");
            before = snapshot(fence);
            check(fence.begin(B, 9007199254740991L, 8, context(100), submitted).decision == MessagePreviewVaultFence.Decision.EXHAUSTED, oracle);
            unchanged(fence, before, "INTENT_EXHAUSTED_OWNER_PRESERVED");
            MessagePreviewVaultFence.Admission terminal = fence.retire(B, 9007199254740991L, 7,
                new MessagePreviewVaultFence.Correlation(A, 9007199254740990L));
            check(terminal.decision == MessagePreviewVaultFence.Decision.RESERVED && terminal.operation.generation == 9
                && terminal.operation.vaultRevision == 9007199254740991L, "FINAL_INTENT_RETIRE_ALLOWED");
            check(!fence.canContinue(terminal.operation) && fence.canErase(terminal.operation), "FINAL_INTENT_ERASURE_ONLY");
            check(!fence.canContinue(a.operation) && !fence.canErase(a.operation), "PREBOUNDARY_INTENT_OLD_OWNER_CLOSED");
            check(fence.clearContext(101) && fence.complete(terminal.operation), "FINAL_INTENT_ERASURE_AFTER_CLEAR");
        }
    }
    public static void main(String[] args) throws Exception {
        switch (args[0]) {
            case "inactive": inactive(); break;
            case "reserve": reserve(); break;
            case "stale-generation": staleGeneration(); break;
            case "context": capturedContext(false); break;
            case "context-epoch": capturedContext(true); break;
            case "context-owner": capturedOwner(); break;
            case "owner": ownerGuard(); break;
            case "invalid-owner": invalidOwner(); break;
            case "invalid-owner-erasure": invalidOwnerErasure(); break;
            case "invalid-owner-lost-ack": invalidOwnerLostAck(); break;
            case "retire-clear": retireAfterLoss(false); break;
            case "retire-expiry": retireAfterLoss(true); break;
            case "retire-before-begin": retireBeforeBegin(); break;
            case "correlation": correlation(); break;
            case "foreign-successor": foreignSuccessor(); break;
            case "duplicate-id": duplicateId(); break;
            case "late-completion": lateCompletion(); break;
            case "late-refusal": lateRefusal(); break;
            case "erasure-completion": erasureCompletion(); break;
            case "bounds": bounds(); break;
            case "syntax": syntax(); break;
            case "locked-cas": lockedCas(); break;
            case "bounded-identities": boundedIdentities(); break;
            case "generation-headroom": generationHeadroom(); break;
            case "intent-headroom": intentHeadroom(); break;
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
        System.out.println("PASS " + args[0]);
    }
}
