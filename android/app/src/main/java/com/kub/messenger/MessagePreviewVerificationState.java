package com.kub.messenger;

import java.util.UUID;

final class MessagePreviewVerificationState {
    interface Clock { long wallTime(); long elapsedTime(); }
    static final long MAX_SAFE_INTEGER = 9007199254740991L;
    static final long VERIFY_MS = 8_000;
    static final long MAX_VERIFIED_MS = 15_000;
    private final Clock clock;
    private long revision = -1, lastWall, lastElapsed;
    private Ticket current;

    static final class Ticket {
        final long revision, accountEpoch, begunAt;
        final String epoch, user, session;
        String device;
        long deadline, expiresWall, expiresElapsed, jwtExpiry = Long.MAX_VALUE;
        boolean attempted, verified;
        Ticket(long revision, String user, String session, long accountEpoch, long elapsed) {
            this.revision = revision; this.user = user; this.session = session; this.accountEpoch = accountEpoch;
            begunAt = elapsed; epoch = UUID.randomUUID().toString();
        }
    }

    MessagePreviewVerificationState(Clock clock) {
        this.clock = clock; lastWall = clock.wallTime(); lastElapsed = clock.elapsedTime();
    }
    static boolean safe(long value) { return value >= 0 && value <= MAX_SAFE_INTEGER; }
    static boolean uuid(String value) {
        return value != null && value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }
    synchronized long elapsed() { now(); return lastElapsed; }
    synchronized long now() {
        long elapsed = clock.elapsedTime();
        if (elapsed < lastElapsed) current = null;
        long advance = Math.max(0, elapsed - lastElapsed);
        lastWall = Math.max(clock.wallTime(), lastWall + advance);
        lastElapsed = elapsed;
        return lastWall;
    }
    synchronized String begin(long next, String user, String session, long accountEpoch) {
        if (!safe(next) || next <= revision) return null;
        revision = next; current = null;
        if (!uuid(user) || !uuid(session) || !safe(accountEpoch)) return null;
        current = new Ticket(next, user, session, accountEpoch, elapsed());
        return current.epoch;
    }
    synchronized boolean clear(long next) {
        if (!safe(next) || next <= revision) return false;
        revision = next; current = null; return true;
    }
    synchronized void reset() { current = null; }
    synchronized Ticket start(long expected, String epoch, String user, String session, long accountEpoch, String device) {
        long elapsed = elapsed();
        Ticket ticket = current;
        if (ticket == null || ticket.attempted || elapsed >= ticket.begunAt + MAX_VERIFIED_MS
            || expected != ticket.revision || !ticket.epoch.equals(epoch)
            || !ticket.user.equals(user) || !ticket.session.equals(session) || ticket.accountEpoch != accountEpoch || !uuid(device)) return null;
        ticket.attempted = true; ticket.device = device;
        ticket.deadline = Math.min(elapsed + VERIFY_MS, ticket.begunAt + MAX_VERIFIED_MS);
        return ticket;
    }
    synchronized boolean active(Ticket ticket) {
        long wall = now();
        return current == ticket && ticket != null && revision == ticket.revision && lastElapsed < ticket.deadline && wall < ticket.jwtExpiry
            && (!ticket.verified || (wall < ticket.expiresWall && lastElapsed < ticket.expiresElapsed));
    }
    synchronized boolean authorizeTime(Ticket ticket, long expiry) {
        if (!active(ticket) || expiry <= now()) return false;
        ticket.jwtExpiry = expiry; return true;
    }
    synchronized boolean finish(Ticket ticket, long jwtExpiry) {
        if (!active(ticket) || jwtExpiry <= now()) return false;
        ticket.expiresWall = Math.min(jwtExpiry, lastWall + MAX_VERIFIED_MS);
        ticket.expiresElapsed = lastElapsed + Math.min(MAX_VERIFIED_MS, ticket.expiresWall - lastWall);
        ticket.verified = true; return true;
    }
    synchronized void fail(Ticket ticket) { if (current == ticket) current = null; }
    synchronized boolean hasVerifiedBinding() {
        long wall = now();
        if (current == null || !current.verified || current.revision != revision) return false;
        if (wall >= current.expiresWall || lastElapsed >= current.expiresElapsed) { current = null; return false; }
        return true;
    }
    synchronized boolean hasVerifiedBinding(String expectedRecipientId) {
        return uuid(expectedRecipientId) && hasVerifiedBinding() && current.user.equals(expectedRecipientId);
    }
    synchronized boolean matchesVerified(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        return hasVerifiedBinding() && current.revision == revision && current.accountEpoch == accountEpoch
            && current.epoch.equals(epoch) && current.user.equals(user) && current.session.equals(session) && current.device.equals(device);
    }
    synchronized boolean invalidate(long revision, String epoch, String user, String session, long accountEpoch, String device) {
        if (current == null || current.revision != revision || current.accountEpoch != accountEpoch || !current.epoch.equals(epoch)
            || !current.user.equals(user) || !current.session.equals(session) || !uuid(device)
            || (current.device != null && !current.device.equals(device))) return false;
        current = null; return true;
    }
}
