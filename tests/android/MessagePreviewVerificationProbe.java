package com.kub.messenger;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class MessagePreviewVerificationProbe {
    static final String USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    static final String SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    static final String DEVICE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    static final String OTHER = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    static final class Clock implements MessagePreviewVerificationState.Clock {
        long wall = 1_800_000_000_000L, elapsed = 10_000;
        public long wallTime() { return wall; }
        public long elapsedTime() { return elapsed; }
        void advance(long ms) { wall += ms; elapsed += ms; }
    }
    static Map<String,Object> object(Object... pairs) {
        Map<String,Object> result = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]);
        return result;
    }
    static Map<String,Object> claims(Clock clock) {
        return object("role", "authenticated", "aud", "authenticated", "is_anonymous", false,
            "iss", "https://core.letscube.ru/auth/v1", "sub", USER, "session_id", SESSION,
            "exp", (clock.wall / 1000) + 300);
    }
    static Object row() { return Arrays.asList(object("binding_v", 1, "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE)); }
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static final class Fixture {
        final Clock clock = new Clock();
        final MessagePreviewVerificationState state = new MessagePreviewVerificationState(clock);
        final List<String> calls = new ArrayList<>();
        Map<String,Object> jwt = claims(clock), key = object("role", "anon");
        Object auth = object("id", USER, "is_anonymous", false), resolver = row();
        String sdk = "fictional-sdk-token", secondSdk = sdk;
        int tokenReads;
        String hash;
        Runnable afterAuth = () -> {}, afterResolver = () -> {};
        final MessagePreviewVerificationRuntime runtime = new MessagePreviewVerificationRuntime(state,
            deadline -> { calls.add("sdk"); return tokenReads++ == 0 ? sdk : secondSdk; },
            new MessagePreviewVerificationRuntime.Transport() {
                public Object request(boolean user, String access, String publicKey, String tokenHash, long deadline) {
                    calls.add(user ? "auth" : "resolver");
                    if (user) { afterAuth.run(); return auth; }
                    hash = tokenHash; afterResolver.run(); return resolver;
                }
                public void cancel() {}
            }, value -> "access".equals(value) ? jwt : key);
        String begin(long revision) { return runtime.beginBinding(revision, USER, SESSION, 1); }
        boolean verify(long revision, String epoch) {
            return runtime.verifyBinding(revision, epoch, USER, SESSION, 1, DEVICE, "access", "public-key");
        }
    }
    static void normal() {
        Fixture f = new Fixture(); String epoch = f.begin(1);
        check(epoch != null && epoch.matches("[0-9a-f-]{36}"), "BEGIN_TICKET");
        check(f.verify(1, epoch), "VERIFIED_POSITIVE");
        check(f.runtime.hasVerifiedBinding(USER), "VERIFIED_MEMORY");
        check(!f.runtime.hasVerifiedBinding(OTHER), "GETTER_EXPECTED_RECIPIENT");
        check(f.calls.equals(Arrays.asList("auth", "sdk", "resolver", "sdk")), "EXACT_READ_ORDER");
        check("eabd9e6d5f19df791c972947e1890d00ca63800d95ded29f4551bb8cd5d5ecc2".equals(f.hash), "OWN_TOKEN_HASH_LITERAL");
        check(!f.verify(1, epoch), "ONE_ATTEMPT");
        check(f.runtime.hasVerifiedBinding(USER), "DUPLICATE_KEEPS_RESULT");
        check(f.calls.size() == 4, "NO_DUPLICATE_IO");
    }
    static void revisions() {
        Fixture f = new Fixture(); String a = f.begin(1), b = f.begin(2);
        check(a != null && b != null && !a.equals(b), "FRESH_TICKET");
        check(f.begin(1) == null, "STALE_BEGIN");
        check(!f.runtime.clearBinding(1), "STALE_CLEAR");
        check(!f.verify(1, a) && f.verify(2, b), "NEWEST_TICKET");
        check(f.runtime.clearBinding(3) && !f.runtime.hasVerifiedBinding(USER), "NEWER_CLEAR");
        check(f.begin(2) == null && f.begin(3) == null, "CLEAR_HIGH_WATER");
        check(f.runtime.beginBinding(4, "bad", SESSION, 1) == null, "INVALID_BEGIN");
        check(f.begin(4) == null, "INVALID_BEGIN_RETIRES");
    }
    static void late(String boundary) {
        Fixture f = new Fixture(); String epoch = f.begin(1);
        Runnable retire = () -> {
            if ("destroy".equals(boundary)) f.runtime.close();
            else f.runtime.clearBinding(2);
        };
        if ("auth".equals(boundary)) f.afterAuth = retire; else f.afterResolver = retire;
        check(!f.verify(1, epoch), "LATE_RESULT_REFUSED");
        check(!f.runtime.hasVerifiedBinding(USER), "LATE_CANNOT_RESTORE");
        check(f.calls.size() == ("auth".equals(boundary) ? 1 : 3), "NO_RETIRED_EXTRA_IO");
    }
    static void expiry(String kind) {
        Fixture f = new Fixture(); String epoch = f.begin(1); check(f.verify(1, epoch), "EXPIRY_CONTROL");
        if ("jwt".equals(kind)) { f.jwt.put("exp", f.clock.wall / 1000 + 1); f.runtime.clearBinding(2); epoch = f.begin(3); check(f.verify(3, epoch), "SHORT_JWT_CONTROL"); f.clock.advance(1000); }
        else if ("rollback".equals(kind)) { f.clock.wall -= 60_000; f.clock.elapsed += 15_000; }
        else if ("monotonic-back".equals(kind)) f.clock.elapsed--;
        else if ("rollback-high-water".equals(kind)) {
            f.clock.wall += 10_000; check(f.runtime.hasVerifiedBinding(USER), "CLOCK_FORWARD_CONTROL");
            f.clock.wall -= 10_000; f.clock.elapsed += 5_000;
        }
        else f.clock.advance(15_000);
        check(!f.runtime.hasVerifiedBinding(USER), "EXPIRY_BOTH_CLOCKS");
    }
    static void pendingCancel() {
        Fixture f = new Fixture(); String epoch = f.begin(1);
        f.runtime.cancelBinding(1, epoch, USER, SESSION, 1, DEVICE);
        check(!f.verify(1, epoch) && f.calls.isEmpty(), "CANCEL_BEFORE_WORKER_START");
    }
    static void completionOrders() {
        for (boolean newerFirst : new boolean[] { false, true }) {
            Clock clock = new Clock(); MessagePreviewVerificationState state = new MessagePreviewVerificationState(clock);
            String a = state.begin(1, USER, SESSION, 1);
            MessagePreviewVerificationState.Ticket old = state.start(1, a, USER, SESSION, 1, DEVICE);
            String b = state.begin(2, USER, OTHER, 2);
            MessagePreviewVerificationState.Ticket latest = state.start(2, b, USER, OTHER, 2, DEVICE);
            if (newerFirst) check(state.finish(latest, clock.wall + 60_000), "NEWEST_FINISH");
            check(!state.finish(old, clock.wall + 60_000), "OLD_FINISH_REFUSED"); state.fail(old);
            if (!newerFirst) check(state.finish(latest, clock.wall + 60_000), "NEWEST_FINISH");
            check(state.matchesVerified(2, b, USER, OTHER, 2, DEVICE), "LATE_FAIL_CANNOT_CLOBBER_NEW");
        }
    }
    static void safeNumbers() {
        Fixture f = new Fixture(); String epoch = f.begin(1);
        check(f.begin(-1) == null && f.begin(Long.MAX_VALUE) == null, "REVISION_SAFE_INTEGER");
        check(f.verify(1, epoch), "INVALID_REVISION_KEEPS_CURRENT");
        check(f.runtime.beginBinding(2, USER, SESSION, Long.MAX_VALUE) == null && !f.runtime.hasVerifiedBinding(USER), "ACCOUNT_SAFE_INTEGER_RETIRES");
    }
    static void refusal(String kind) {
        Fixture f = new Fixture(); String epoch = f.begin(1);
        switch (kind) {
            case "role": f.jwt.put("role", "service_role"); break;
            case "anonymous": f.jwt.put("is_anonymous", true); break;
            case "claims-owner": f.jwt.put("sub", OTHER); break;
            case "claims-session": f.jwt.put("session_id", OTHER); break;
            case "expired": f.jwt.put("exp", f.clock.wall / 1000); break;
            case "issuer": f.jwt.put("iss", "https://foreign.invalid/auth/v1"); break;
            case "audience": f.jwt.put("aud", "service_role"); break;
            case "private-key": f.key.put("role", "service_role"); break;
            case "auth-owner": f.auth = object("id", OTHER, "is_anonymous", false); break;
            case "auth-anonymous": f.auth = object("id", USER, "is_anonymous", true); break;
            case "sdk-change": f.secondSdk = "fictional-rotated-token"; break;
            case "second-sdk-missing": f.secondSdk = null; break;
            case "sdk-empty": f.sdk = ""; break;
            case "sdk-edge": f.sdk = " fictional-token"; break;
            case "sdk-large": f.sdk = "x".repeat(4097); break;
            case "empty-row": f.resolver = new ArrayList<>(); break;
            case "multirow": f.resolver = Arrays.asList(((List<?>) row()).get(0), ((List<?>) row()).get(0)); break;
            case "wrong-owner": f.resolver = Arrays.asList(object("binding_v", 1, "recipient_id", OTHER, "session_id", SESSION, "device_id", DEVICE)); break;
            case "wrong-session": f.resolver = Arrays.asList(object("binding_v", 1, "recipient_id", USER, "session_id", OTHER, "device_id", DEVICE)); break;
            case "wrong-device": f.resolver = Arrays.asList(object("binding_v", 1, "recipient_id", USER, "session_id", SESSION, "device_id", OTHER)); break;
            case "version": f.resolver = Arrays.asList(object("binding_v", 2, "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE)); break;
            case "string-version": f.resolver = Arrays.asList(object("binding_v", "1", "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE)); break;
            case "extra-field": f.resolver = Arrays.asList(object("binding_v", 1, "recipient_id", USER, "session_id", SESSION, "device_id", DEVICE, "token", "must-not-accept")); break;
            case "deadline": f.afterResolver = () -> f.clock.advance(8000); break;
            case "expired-after-auth":
                f.jwt.put("exp", f.clock.wall / 1000 + 1); f.afterAuth = () -> f.clock.advance(1000);
                check(!f.verify(1, epoch) && f.calls.size() == 1, "EXPIRED_NO_EXTRA_IO"); return;
            case "auth-error": f.afterAuth = () -> { throw new IllegalStateException("fictional failure"); }; break;
            case "resolver-error": f.afterResolver = () -> { throw new IllegalStateException("fictional failure"); }; break;
            case "header": check(!f.runtime.verifyBinding(1, epoch, USER, SESSION, 1, DEVICE, "access\r\n", "public-key") && f.calls.isEmpty(), "HEADER_REFUSED_NO_IO"); return;
            case "tuple-epoch": check(!f.runtime.verifyBinding(1, epoch, USER, SESSION, 2, DEVICE, "access", "public-key"), "ACCOUNT_EPOCH_FENCE"); return;
            case "tuple-session": check(!f.runtime.verifyBinding(1, epoch, USER, OTHER, 1, DEVICE, "access", "public-key"), "TUPLE_FENCE"); return;
            case "ticket": check(!f.verify(1, OTHER), "TICKET_FENCE"); return;
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
        check(!f.verify(1, epoch), "REFUSAL_" + kind);
        check(!f.runtime.hasVerifiedBinding(USER), "REFUSED_MEMORY_CLOSED");
    }
    static void held() throws Exception {
        Fixture f = new Fixture(); String a = f.begin(1);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        f.afterAuth = () -> { entered.countDown(); try { check(release.await(2, TimeUnit.SECONDS), "HOLD_BOUNDED"); } catch (InterruptedException e) { throw new AssertionError(e); } };
        boolean[] result = { true };
        Thread thread = new Thread(() -> result[0] = f.verify(1, a)); thread.start();
        check(entered.await(2, TimeUnit.SECONDS), "ACTUAL_WORKER_ENTERED");
        String b = f.begin(2); check(!f.verify(2, b), "CONCURRENCY_BOUNDED");
        release.countDown(); thread.join(2500); check(!thread.isAlive() && !result[0], "OLD_HELD_COMPLETION_REFUSED");
        check(!f.runtime.hasVerifiedBinding(USER) && f.calls.size() == 1, "HELD_NO_EXTRA_IO");
        f.afterAuth = () -> {}; b = f.begin(3); check(f.verify(3, b), "REACQUIRE_AFTER_SETTLE");
    }
    public static void main(String[] args) throws Exception {
        String name = args[0];
        if ("normal".equals(name)) normal();
        else if ("revisions".equals(name)) revisions();
        else if (name.startsWith("late-")) late(name.substring(5));
        else if (name.startsWith("expiry-")) expiry(name.substring(7));
        else if ("held".equals(name)) held();
        else if ("pending-cancel".equals(name)) pendingCancel();
        else if ("completion-orders".equals(name)) completionOrders();
        else if ("safe-numbers".equals(name)) safeNumbers();
        else refusal(name);
        System.out.println("PASS " + name);
    }
}
