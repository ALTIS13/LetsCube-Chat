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

    // Exact one-use invocation, not a ticket/tuple/credential getter or a renewable TTL.
    static final class ProducerPermit {
        final long deadline;
        volatile boolean revoked;
        private ProducerPermit(long deadline) { this.deadline = deadline; }
    }
    static final class Ticket {
        final long revision, accountEpoch, begunAt;
        final String epoch, user, session;
        String device;
        long deadline, expiresWall, expiresElapsed, jwtExpiry = Long.MAX_VALUE;
        boolean attempted, verified;
        Object producer, startedBy;
        ProducerPermit producerPermit;
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
        if (elapsed < lastElapsed) { retireTicket(current); current = null; }
        long advance = Math.max(0, elapsed - lastElapsed);
        lastWall = Math.max(clock.wallTime(), lastWall + advance);
        lastElapsed = elapsed;
        if (current != null && current.producerPermit != null
            && (!safe(lastWall) || !safe(lastElapsed) || lastElapsed >= current.deadline || lastWall >= current.jwtExpiry
                || (current.verified && (lastWall >= current.expiresWall || lastElapsed >= current.expiresElapsed))))
            retireTicket(current);
        return lastWall;
    }
    private static void retireTicket(Ticket ticket) {
        if (ticket != null && ticket.producerPermit != null) ticket.producerPermit.revoked = true;
    }
    synchronized String begin(long next, String user, String session, long accountEpoch) {
        if (!safe(next) || next <= revision) return null;
        retireTicket(current);
        revision = next; current = null;
        if (!uuid(user) || !uuid(session) || !safe(accountEpoch)) return null;
        current = new Ticket(next, user, session, accountEpoch, elapsed());
        return current.epoch;
    }
    synchronized boolean clear(long next) {
        if (!safe(next) || next <= revision) return false;
        retireTicket(current);
        revision = next; current = null; return true;
    }
    synchronized void reset() { retireTicket(current); current = null; }
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
    private boolean producerMatches(long expected, String epoch, String user, String session, long accountEpoch, String device) {
        Ticket ticket = current;
        return ticket != null && expected == ticket.revision && ticket.epoch.equals(epoch)
            && ticket.user.equals(user) && ticket.session.equals(session) && ticket.accountEpoch == accountEpoch
            && uuid(device) && (ticket.device == null || ticket.device.equals(device));
    }
    synchronized boolean admitProducer(Object producer, long expected, String epoch, String user,
            String session, long accountEpoch, String device) {
        long elapsed = elapsed();
        if (producer == null || !producerMatches(expected, epoch, user, session, accountEpoch, device)
            || current.attempted || current.producer != null || !safe(elapsed)
            || current.begunAt > MAX_SAFE_INTEGER - MAX_VERIFIED_MS
            || elapsed >= current.begunAt + MAX_VERIFIED_MS) return false;
        current.producer = producer; current.device = device;
        return true;
    }
    synchronized boolean producerCurrent(Object producer, long expected, String epoch, String user,
            String session, long accountEpoch, String device) {
        long elapsed = elapsed();
        if (!producerMatches(expected, epoch, user, session, accountEpoch, device)
            || current.producer != producer || producer == null || !safe(elapsed)
            || current.begunAt > MAX_SAFE_INTEGER - MAX_VERIFIED_MS
            || elapsed >= current.begunAt + MAX_VERIFIED_MS) return false;
        return !current.attempted || (current.startedBy == producer && active(current));
    }
    synchronized Ticket startProducer(Object producer, long expected, String epoch, String user,
            String session, long accountEpoch, String device, long deadline) {
        if (!safe(deadline) || !producerCurrent(producer, expected, epoch, user, session, accountEpoch, device)
            || current.attempted || deadline <= lastElapsed || lastElapsed > MAX_SAFE_INTEGER - VERIFY_MS) return null;
        Ticket ticket = start(expected, epoch, user, session, accountEpoch, device);
        if (ticket != null) {
            ticket.startedBy = producer;
            ticket.deadline = Math.min(ticket.deadline, deadline);
            ticket.producerPermit = new ProducerPermit(ticket.deadline);
        }
        return ticket;
    }
    synchronized boolean invalidateProducer(Object producer) {
        if (producer == null || current == null || current.producer != producer) return false;
        retireTicket(current);
        current = null; return true;
    }
    synchronized boolean active(Ticket ticket) {
        long wall = now();
        return current == ticket && ticket != null && revision == ticket.revision && lastElapsed < ticket.deadline && wall < ticket.jwtExpiry
            && (!ticket.verified || (wall < ticket.expiresWall && lastElapsed < ticket.expiresElapsed))
            && (ticket.producerPermit == null || !ticket.producerPermit.revoked);
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
    synchronized void fail(Ticket ticket) { if (current == ticket) { retireTicket(ticket); current = null; } }
    synchronized boolean hasVerifiedBinding() {
        long wall = now();
        if (current == null || !current.verified || current.revision != revision) return false;
        if (wall >= current.expiresWall || lastElapsed >= current.expiresElapsed) { retireTicket(current); current = null; return false; }
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
        retireTicket(current);
        current = null; return true;
    }
}
