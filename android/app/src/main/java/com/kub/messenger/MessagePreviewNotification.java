package com.kub.messenger;

import android.content.Context;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Initial delivery only. No async upgrade, provider display text or token retention. */
final class MessagePreviewNotification {
    enum Result { PUBLISHED, SKIPPED, UNKNOWN, UNTRACKED }
    // Preparation must not notify. Only the returned synchronous callback may publish.
    interface Posting { Runnable prepare(long generation, MessagePreviewContent content); }
    interface Lease {
        String level(); String publicKey();
        long expiresAt();
        boolean current(long wall) throws Exception;
        void consume(MessagePreviewCredentialEnvelope.Consumer consumer) throws Exception;
    }
    interface Ports extends MessagePreviewContentLookup.Clock {
        Object capture();
        boolean contentCurrent(Object permit);
        boolean publishContent(Object permit, Runnable posting);
        Lease open() throws Exception;
        Map<String,Object> decode(String token) throws Exception;
        Object preview(String access, String key, String device, String notification, long deadline) throws Exception;
        void cancel();
    }
    static Result receive(Context context, ChatNotificationCleanup.IntentStore intents, String tag,
            String notification, String chat, String message, Posting posting) {
        return deliver(new Native(context), intents, tag, notification, chat, message, posting);
    }
    static Result deliver(Ports ports, ChatNotificationCleanup.IntentStore intents, String tag,
            String notification, String chat, String message, Posting posting) {
        if (ports == null || posting == null || !ChatNotificationCleanup.isUuid(chat)
            || !("message:chat:" + chat).equals(tag) || !ChatNotificationCleanup.isUuid(notification)
            || !ChatNotificationCleanup.isUuid(message)) return Result.SKIPPED;
        long wall = ports.wallTime(), elapsed = ports.elapsedTime();
        ChatNotificationCleanup.Reservation reservation;
        try { reservation = ChatNotificationCleanup.reserve(intents, tag, notification, message); }
        catch (RuntimeException unavailable) { return Result.UNTRACKED; }
        if (reservation == null) return Result.UNTRACKED;
        try {
            MessagePreviewContent content = null; Attempt attempt = null;
            try {
                Object permit = ports.capture();
                if (permit != null && safe(wall) && safe(elapsed) && elapsed <= 9007199254738991L) {
                    attempt = new Attempt(ports, reservation, permit, wall, elapsed);
                    attempt.lease = ports.open();
                    if (attempt.lease != null) attempt.leaseExpiry = attempt.lease.expiresAt();
                    if (attempt.lease != null && ("sender".equals(attempt.lease.level()) || "message".equals(attempt.lease.level()))
                        && publicKey(ports, attempt.lease.publicKey()) && attempt.current()) {
                        content = lookup(attempt, notification, chat, message);
                    }
                }
            } catch (Exception refused) { content = null; }
            if (content != null && attempt != null) {
                Result result = rich(attempt, content, posting);
                if (result != null) return result;
            }
            try {
                Runnable prepared = posting.prepare(reservation.generation(), null);
                if (prepared == null) return Result.SKIPPED;
                return ChatNotificationCleanup.publishInitial(reservation, generation -> prepared.run())
                    ? Result.PUBLISHED : Result.SKIPPED;
            } catch (RuntimeException unknown) { return Result.UNKNOWN; }
        } finally {
            ChatNotificationCleanup.cancelInitial(reservation);
            try { ports.cancel(); } catch (RuntimeException unavailable) { /* Never replay. */ }
        }
    }
    private static boolean safe(long value) { return value >= 0 && value <= 9007199254740991L; }
    private static boolean publicKey(Ports ports, String key) throws Exception {
        if (MessagePreviewResponseParser.publicKey(key, null)) return true;
        return MessagePreviewResponseParser.publicKey(key, ports.decode(key));
    }
    private static final class Attempt {
        final Ports ports;
        final ChatNotificationCleanup.Reservation reservation;
        final Object permit;
        final long deadline;
        long wall, elapsed, effectiveWall, leaseExpiry;
        Lease lease;
        Attempt(Ports ports, ChatNotificationCleanup.Reservation reservation, Object permit, long wall, long elapsed) {
            this.ports = ports; this.reservation = reservation; this.permit = permit;
            this.wall = effectiveWall = wall; this.elapsed = elapsed; deadline = elapsed + 2_000;
        }
        boolean current() {
            try {
                long w = ports.wallTime(), e = ports.elapsedTime();
                if (!memoryFresh(w, e, Long.MAX_VALUE) || lease == null
                    || !ports.contentCurrent(permit) || !ChatNotificationCleanup.isCurrent(reservation)) return false;
                if (!lease.current(effectiveWall)) return false;
                return memoryFresh(ports.wallTime(), ports.elapsedTime(), Long.MAX_VALUE);
            } catch (Exception refused) { return false; }
        }
        // Only primitive snapshots here: no lease, storage, permit or other port calls under publication locks.
        boolean memoryFresh(long w, long e, long contentExpiry) {
            if (!safe(w) || !safe(e) || w < wall || e < elapsed || e >= deadline) return false;
            long effective = Math.max(w, effectiveWall + (e - elapsed));
            if (!safe(effective) || leaseExpiry <= effective || contentExpiry <= effective) return false;
            effectiveWall = effective; wall = w; elapsed = e; return true;
        }
    }
    private static MessagePreviewContent lookup(Attempt attempt, String notification, String chat, String message) throws Exception {
        MessagePreviewContent[] found = {null};
        MessagePreviewContentLookup lookup = new MessagePreviewContentLookup(
            (access, key, device, notice, deadline) -> attempt.ports.preview(access, key, device, notice, Math.min(deadline, attempt.deadline)),
            attempt.ports::cancel, attempt.ports, request -> attempt.current());
        try {
            attempt.lease.consume((owner, borrowed, expiry) -> {
                try {
                    if (!attempt.current()) return;
                    String access = new String(borrowed, StandardCharsets.US_ASCII);
                    if (MessagePreviewResponseParser.accessExpiry(attempt.ports.decode(access), owner.recipient, owner.session,
                            attempt.ports.wallTime()) != expiry) return;
                    MessagePreviewContentLookup.Request request = new MessagePreviewContentLookup.Request(owner.recipient, owner.session,
                        owner.device, notification, chat, message, owner.accountEpoch, attempt.reservation.generation(), attempt.lease.level());
                    if (lookup.consume(request, access, attempt.lease.publicKey(), content -> found[0] = content)
                            != MessagePreviewContentLookup.Outcome.CONSUMED) found[0] = null;
                } catch (Exception refused) { found[0] = null; }
            });
            return found[0];
        } finally { lookup.close(); }
    }
    private static Result rich(Attempt attempt, MessagePreviewContent content, Posting posting) {
        boolean[] invoked = {false};
        try {
            Runnable prepared = posting.prepare(attempt.reservation.generation(), content);
            Runnable generic = posting.prepare(attempt.reservation.generation(), null);
            boolean ready = prepared != null && attempt.current(); // Storage validation stays outside both locks.
            boolean claimed = ChatNotificationCleanup.publishInitial(attempt.reservation, generation -> {
                // CARDS -> CONTENT. Writers invalidate this epoch before any vault/choice effects.
                if (ready) attempt.ports.publishContent(attempt.permit, () -> {
                    Runnable selected = attempt.memoryFresh(attempt.ports.wallTime(), attempt.ports.elapsedTime(), content.expiresAt)
                        ? prepared : generic;
                    if (selected != null) { invoked[0] = true; selected.run(); }
                });
                if (!invoked[0] && generic != null) { invoked[0] = true; generic.run(); }
            });
            return claimed && invoked[0] ? Result.PUBLISHED : Result.SKIPPED;
        } catch (RuntimeException unknown) { return invoked[0] ? Result.UNKNOWN : null; }
    }
    private static final class Native implements Ports {
        private final Context context;
        private final MessagePreviewHttpTransport http = new MessagePreviewHttpTransport(SystemClock::elapsedRealtime);
        Native(Context context) { this.context = context; }
        public long wallTime() { return System.currentTimeMillis(); }
        public long elapsedTime() { return SystemClock.elapsedRealtime(); }
        public Object capture() { return MessagePreviewSession.captureContent(); }
        public boolean contentCurrent(Object permit) {
            return permit instanceof MessagePreviewSession.ContentPermit && MessagePreviewSession.contentCurrent((MessagePreviewSession.ContentPermit) permit);
        }
        public boolean publishContent(Object permit, Runnable posting) {
            return permit instanceof MessagePreviewSession.ContentPermit && MessagePreviewSession.publishContent((MessagePreviewSession.ContentPermit) permit, posting);
        }
        public Lease open() throws Exception {
            MessagePreviewExistingVault vault = MessagePreviewExistingVault.open(context);
            MessagePreviewMetadataEnvelope.Record head = vault.readCommitted(wallTime());
            MessagePreviewChoiceStore store = new MessagePreviewChoiceStore(context);
            MessagePreviewChoiceStore.Choice choice = store.read(head);
            return new Lease() {
                public String level() { return choice.level; }
                public String publicKey() { return choice.publicKey; }
                public long expiresAt() { return head.header.expiresWallMillis; }
                public boolean current(long wall) { return vault.isCurrent(head, wall) && store.isCurrent(head, choice); }
                public void consume(MessagePreviewCredentialEnvelope.Consumer consumer) throws Exception {
                    javax.crypto.SecretKey key = new MessagePreviewKeystoreReader(context, head.header.installation).loadCredential(head.header.alias);
                    MessagePreviewCredentialEnvelope.consume(head, head.header, key, consumer);
                }
            };
        }
        public Map<String,Object> decode(String token) throws Exception { return http.decode(token); }
        public Object preview(String access, String key, String device, String notification, long deadline) throws Exception {
            return http.preview(access, key, device, notification, deadline);
        }
        public void cancel() { http.cancel(); }
    }
    private MessagePreviewNotification() { }
}
