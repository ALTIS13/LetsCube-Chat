package com.kub.messenger;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

final class MessagePreviewVerificationRuntime {
    interface TokenSource { String token(long deadline) throws Exception; }
    interface Transport { Object request(boolean user, String access, String key, String hash, long deadline) throws Exception; void cancel(); }
    interface JwtDecoder { Map<String,Object> decode(String value) throws Exception; }
    interface Producer<T> {
        void current() throws Exception;
        T complete(long validatedExpiry, MessagePreviewVerificationState.ProducerPermit permit) throws Exception;
    }
    private final MessagePreviewVerificationState state;
    private final TokenSource tokens;
    private final Transport transport;
    private final JwtDecoder decoder;
    private final AtomicBoolean busy = new AtomicBoolean();
    private boolean closed;

    MessagePreviewVerificationRuntime(MessagePreviewVerificationState state, TokenSource tokens, Transport transport, JwtDecoder decoder) {
        this.state = state; this.tokens = tokens; this.transport = transport; this.decoder = decoder;
    }
    synchronized String beginBinding(long revision, String user, String session, long accountEpoch) {
        if (closed) return null;
        String epoch = state.begin(revision, user, session, accountEpoch);
        // Cancel only a newer transition, never a stale begin against a live worker.
        if (epoch != null) transport.cancel();
        return epoch;
    }
    synchronized boolean clearBinding(long revision) {
        if (closed || !state.clear(revision)) return false;
        transport.cancel(); return true;
    }
    boolean verifyBinding(long revision, String epoch, String user, String session, long accountEpoch, String device, String access, String key) {
        return verify(revision, epoch, user, session, accountEpoch, device, access, key, null, null, 0) != null;
    }
    private static final class Completed<T> {
        final T result;
        Completed(T result) { this.result = result; }
    }
    synchronized boolean admitProducer(Object producer, long revision, String epoch, String user,
            String session, long accountEpoch, String device) {
        return !closed && state.admitProducer(producer, revision, epoch, user, session, accountEpoch, device);
    }
    synchronized boolean producerCurrent(Object producer, long revision, String epoch, String user,
            String session, long accountEpoch, String device) {
        return !closed && state.producerCurrent(producer, revision, epoch, user, session, accountEpoch, device);
    }
    synchronized boolean deadlineFuture(long deadline) {
        if (closed || !MessagePreviewVerificationState.safe(deadline)) return false;
        long now = state.elapsed();
        return MessagePreviewVerificationState.safe(now) && now < deadline;
    }
    synchronized void retireProducer(Object producer) {
        if (state.invalidateProducer(producer)) transport.cancel();
    }
    <T> T verifyProducer(Object producer, long revision, String epoch, String user, String session, long accountEpoch,
            String device, String access, String key, long deadline, Producer<T> current) {
        Completed<T> result = verify(revision, epoch, user, session, accountEpoch, device, access, key, producer, current, deadline);
        return result == null ? null : result.result;
    }
    private void producerBoundary(MessagePreviewVerificationState.Ticket ticket,
            Producer<?> current) throws Exception {
        if (current != null) {
            current.current();
            if (!state.active(ticket)) throw new IllegalStateException("UNAVAILABLE");
        }
    }
    private <T> Completed<T> verify(long revision, String epoch, String user, String session, long accountEpoch,
            String device, String access, String key, Object producer, Producer<T> current, long deadline) {
        MessagePreviewVerificationState.Ticket ticket;
        synchronized (this) {
            if (closed || (producer != null && current == null)) return null;
            ticket = producer == null ? state.start(revision, epoch, user, session, accountEpoch, device)
                : state.startProducer(producer, revision, epoch, user, session, accountEpoch, device, deadline);
            if (ticket == null) return null;
            if (!busy.compareAndSet(false, true)) { state.fail(ticket); return null; }
        }
        boolean verified = false;
        try {
            if (!header(access, 8192) || !header(key, 4096)) return null;
            producerBoundary(ticket, current);
            long expires = MessagePreviewResponseParser.accessExpiry(decoder.decode(access), user, session, state.now());
            producerBoundary(ticket, current);
            Map<String,Object> keyClaims = key.startsWith("sb_publishable_") ? null : decoder.decode(key);
            producerBoundary(ticket, current);
            if (expires == 0 || (producer != null && !MessagePreviewVerificationState.safe(expires))
                || !MessagePreviewResponseParser.publicKey(key, keyClaims) || !state.authorizeTime(ticket, expires)) return null;
            producerBoundary(ticket, current);
            Object auth = transport.request(true, access, key, null, ticket.deadline);
            producerBoundary(ticket, current);
            if (!state.active(ticket) || !MessagePreviewResponseParser.authUser(auth, user)) return null;
            String first = tokens.token(ticket.deadline);
            producerBoundary(ticket, current);
            if (!state.active(ticket) || !sdkToken(first)) return null;
            String hash = hash(first);
            producerBoundary(ticket, current);
            Object response = transport.request(false, access, key, hash, ticket.deadline);
            producerBoundary(ticket, current);
            if (!state.active(ticket) || !MessagePreviewResponseParser.binding(response, user, session, device)) return null;
            String second = tokens.token(ticket.deadline);
            producerBoundary(ticket, current);
            if (!state.active(ticket) || !first.equals(second) || !state.finish(ticket, expires)) return null;
            producerBoundary(ticket, current);
            T produced = current == null ? null : current.complete(expires, ticket.producerPermit);
            producerBoundary(ticket, current);
            if (producer != null && produced == null) return null;
            verified = true;
            return new Completed<>(produced);
        } catch (Exception refused) { return null; }
        finally {
            if (!verified) state.fail(ticket);
            busy.set(false);
        }
    }
    static boolean header(String value, int cap) {
        if (value == null || value.isEmpty() || value.length() > cap) return false;
        for (int i = 0; i < value.length(); i++) if (value.charAt(i) < 33 || value.charAt(i) > 126) return false;
        return true;
    }
    static boolean sdkToken(String value) { return header(value, 4096); }
    private static String hash(String token) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(64);
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    synchronized boolean hasVerifiedBinding(String expectedRecipientId) { return !closed && state.hasVerifiedBinding(expectedRecipientId); }
    synchronized boolean matchesVerified(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        return !closed && state.matchesVerified(revision, epoch, user, session, accountEpoch, device);
    }
    synchronized void rejectBinding(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        MessagePreviewVerificationState.Ticket ticket = state.start(revision, epoch, user, session, accountEpoch, device);
        if (ticket != null) state.fail(ticket);
    }
    synchronized void cancelBinding(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        if (state.invalidate(revision, epoch, user, session, accountEpoch, device)) transport.cancel();
    }
    synchronized void retire() { state.reset(); transport.cancel(); }
    synchronized void close() { closed = true; state.reset(); transport.cancel(); }
}
