package com.kub.messenger;

import java.io.IOException;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.NoSuchElementException;

// Fictional app-independent Enumerations; no AndroidKeyStore/UID/absence authority.
public final class MessagePreviewOwnedKeyInventoryProbe {
    interface Checked { void run() throws Exception; }
    private static void require(boolean condition, String oracle) {
        if (!condition) throw new AssertionError(oracle);
    }
    private static MessagePreviewOwnedKeyInventory.Unavailable refused(Checked action, String oracle) throws Exception {
        try { action.run(); }
        catch (MessagePreviewOwnedKeyInventory.Unavailable error) { return error; }
        catch (Exception unexpected) { throw new AssertionError("CHECKED_REFUSAL_REQUIRED"); }
        throw new AssertionError(oracle);
    }
    private static final class Sequence implements Enumeration<String> {
        final int size, ownedAt;
        int has, next;
        Sequence(int size, int ownedAt) { this.size = size; this.ownedAt = ownedAt; }
        @Override public boolean hasMoreElements() { has++; return next < size; }
        @Override public String nextElement() {
            next++;
            return next == ownedAt ? "letscube.nmpv.future.unknown" : "unrelated.fixture." + next;
        }
    }
    private static Enumeration<String> one(String alias) {
        return Collections.enumeration(Collections.singletonList(alias));
    }
    private static String chars(int count) {
        char[] value = new char[count]; java.util.Arrays.fill(value, 'x'); return new String(value);
    }
    private static void scenario(String name) throws Exception {
        switch (name) {
            case "empty": {
                Sequence empty = new Sequence(0, 0); int[] checks = {0};
                MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(empty, () -> { checks[0]++; return true; });
                require(empty.has == 1 && empty.next == 0 && checks[0] == 2, "CLEAN_END_REQUIRED");
                Sequence untouched = new Sequence(0, 0);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(null, () -> true), "NULL_ENUMERATION");
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(untouched, null), "NULL_CURRENT");
                require(untouched.has == 0 && untouched.next == 0, "NULL_PORTS_NO_EFFECTS");
                break;
            }
            case "entry-bounds": {
                Sequence end256 = new Sequence(256, 0);
                MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(end256, () -> true);
                require(end256.next == 256 && end256.has == 257, "ALLOW_256_OBSERVED_END");
                Sequence overflow = new Sequence(257, 0);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(overflow, () -> true), "ENTRY_OVERFLOW_REFUSED");
                require(overflow.next == 256 && overflow.has == 257, "NO_257TH_NEXT");
                Sequence endless = new Sequence(Integer.MAX_VALUE, 0);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(endless, () -> true), "ENDLESS_REFUSED");
                require(endless.next == 256 && endless.has == 257, "BOUNDED_ITERATOR_EFFECTS");
                break;
            }
            case "alias-bounds": {
                MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(one(chars(256)), () -> true);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(one(chars(257)), () -> true), "ALIAS_SIZE_REFUSED");
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(one(null), () -> true), "NULL_ALIAS_REFUSED");
                break;
            }
            case "prefix": {
                for (String alias : new String[] {"letscube.nmpv.", "letscube.nmpv.metadata.v1.fixture",
                    "letscube.nmpv.credential.v1.fixture", "letscube.nmpv.metadata.v99.", "letscube.nmpv.malformed"}) {
                    refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(one(alias), () -> true), "OWNED_PREFIX_REFUSED");
                }
                MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(Collections.enumeration(List.of(
                    "letscube.nmpv", "LetScube.nmpv.fixture", "xletscube.nmpv.fixture", "other.fixture")), () -> true);
                break;
            }
            case "late-owned": {
                Sequence late = new Sequence(256, 256);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(late, () -> true), "LATE_OWNED_REFUSED");
                require(late.next == 256 && late.has == 256, "LATE_ALIAS_REACHED");
                break;
            }
            case "iterator-errors": {
                Enumeration<String> hasFailure = new Enumeration<String>() {
                    @Override public boolean hasMoreElements() { throw new IllegalStateException("FICTIONAL_PRIVATE"); }
                    @Override public String nextElement() { throw new AssertionError("NO_NEXT_AFTER_HAS_ERROR"); }
                };
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(hasFailure, () -> true), "HAS_ERROR_REFUSED");
                Enumeration<String> nextFailure = new Enumeration<String>() {
                    @Override public boolean hasMoreElements() { return true; }
                    @Override public String nextElement() { throw new NoSuchElementException("FICTIONAL_PRIVATE"); }
                };
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(nextFailure, () -> true), "NEXT_ERROR_REFUSED");
                Sequence untouched = new Sequence(1, 0);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(untouched, () -> { throw new IOException("FICTIONAL_PRIVATE"); }), "CURRENT_ERROR_REFUSED");
                require(untouched.has == 0 && untouched.next == 0, "CURRENT_ERROR_NO_EFFECTS");
                break;
            }
            case "stale-has": {
                Sequence untouched = new Sequence(1, 0);
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(untouched, () -> false), "STALE_HAS_REFUSED");
                require(untouched.has == 0 && untouched.next == 0, "NO_HAS_AFTER_STALE");
                break;
            }
            case "stale-next": {
                boolean[] live = {true}; int[] effects = {0, 0};
                Enumeration<String> aliases = new Enumeration<String>() {
                    @Override public boolean hasMoreElements() { effects[0]++; live[0] = false; return true; }
                    @Override public String nextElement() { effects[1]++; return "unrelated.fixture"; }
                };
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(aliases, () -> live[0]), "STALE_NEXT_REFUSED");
                require(effects[0] == 1 && effects[1] == 0, "NO_NEXT_AFTER_STALE");
                break;
            }
            case "stale-end": {
                boolean[] live = {true};
                Enumeration<String> aliases = new Enumeration<String>() {
                    @Override public boolean hasMoreElements() { live[0] = false; return false; }
                    @Override public String nextElement() { throw new AssertionError("NO_NEXT_AFTER_END"); }
                };
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(aliases, () -> live[0]), "END_ACK_REFUSED");
                break;
            }
            case "stale-repeat": {
                boolean[] live = {true}; int[] effects = {0, 0};
                Enumeration<String> aliases = new Enumeration<String>() {
                    @Override public boolean hasMoreElements() { effects[0]++; return true; }
                    @Override public String nextElement() { effects[1]++; live[0] = false; return "unrelated.fixture"; }
                };
                refused(() -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(aliases, () -> live[0]), "AFTER_NEXT_REFUSED");
                require(effects[0] == 1 && effects[1] == 1, "AFTER_NEXT_NO_MORE_EFFECTS");
                break;
            }
            case "refusal": {
                MessagePreviewOwnedKeyInventory.Unavailable error = refused(
                    () -> MessagePreviewOwnedKeyInventory.requireNoOwnedAlias(null, () -> true), "FIXED_REFUSAL_PRESENT");
                require("UNAVAILABLE".equals(error.getMessage()), "REFUSAL_FIXED_MESSAGE");
                require(error.getCause() == null, "REFUSAL_NO_CAUSE");
                require(error.getStackTrace().length == 0, "REFUSAL_NO_STACK");
                error.addSuppressed(new Exception("FICTIONAL_PRIVATE"));
                require(error.getSuppressed().length == 0, "REFUSAL_NO_SUPPRESSED");
                error.fillInStackTrace();
                error.setStackTrace(new StackTraceElement[] {new StackTraceElement("Fixture", "probe", "Fixture.java", 1)});
                require(error.getStackTrace().length == 0, "REFUSAL_STACK_IMMUTABLE");
                boolean causeRefused = false;
                try { error.initCause(new Exception("FICTIONAL_PRIVATE")); }
                catch (IllegalStateException expected) { causeRefused = true; }
                require(causeRefused && error.getCause() == null, "REFUSAL_CAUSE_IMMUTABLE");
                break;
            }
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
    }
    public static void main(String[] args) throws Exception {
        require(args.length == 1, "ONE_SCENARIO");
        scenario(args[0]);
        System.out.println("PASS " + args[0]);
    }
}
