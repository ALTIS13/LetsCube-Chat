package com.kub.messenger;

import android.content.Context;
import android.os.SystemClock;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.SecretKey;

// Inactive synchronous program, exclusively driven by the retained initializer worker.
final class MessagePreviewVaultProvisioning {
    interface Authority {
        // Trusted memory-current check only; the fresh invocation below owns bounded verification I/O.
        void requireCurrent(Identity exactIdentity) throws Exception;
        Verification verify(Identity exactIdentity, String borrowedAccess, long deadlineElapsedMillis) throws Exception;
    }
    interface Current { void requireCurrent() throws Exception; }
    static final class Identity {
        final String operationId;
        final long vaultRevision, baseGeneration, generation;
        final MessagePreviewVaultFence.Context context;
        final MessagePreviewVaultFence.Owner owner;
        Identity(String operationId, long vaultRevision, long baseGeneration,
                MessagePreviewVaultFence.Context context, MessagePreviewVaultFence.Owner owner) {
            this.operationId=operationId; this.vaultRevision=vaultRevision; this.baseGeneration=baseGeneration;
            this.generation=baseGeneration+1; this.context=context; this.owner=owner;
        }
    }
    // A conditional trusted supplier binds this result to one exact invocation and input.
    // It is not a Task5 implementation or a public/native capability.
    static final class Verification {
        private final Identity identity;
        private final String input;
        private final long expiry;
        private boolean consumed;
        Verification(Identity identity, String input, long validatedExpiry) {
            this.identity=identity; this.input=input; expiry=validatedExpiry;
        }
        private synchronized long consume(Identity expected, String access) throws Exception {
            require(!consumed); consumed=true;
            require(identity == expected && access.equals(input) && safe(expiry) && expiry > 0);
            return expiry;
        }
    }
    static final class Unavailable extends Exception {
        private static final long serialVersionUID=1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    // These facts are minted only from the owner's retained state, never supplied through admission.
    static final class Work {
        final MessagePreviewVaultFence.Operation operation;
        final Identity identity;
        final MessagePreviewMetadataEnvelope.Record original;
        final long admitted, deadline;
        final String installation;
        final String candidate;
        final MessagePreviewMetadataEnvelope.Record[] attempted=new MessagePreviewMetadataEnvelope.Record[4];
        int attempts;
        MessagePreviewMetadataEnvelope.Record checked;
        boolean oldDeleted, candidateEntered, completed;
        long effectiveWall, wallElapsed, validatedExpiry;
        Work(MessagePreviewVaultFence.Operation operation, Identity identity,
                MessagePreviewMetadataEnvelope.Record original, long admitted, long deadline, String candidate) {
            this.operation=operation; this.identity=identity; this.original=original;
            this.admitted=admitted; this.deadline=deadline; installation=original.header.installation;
            this.candidate=candidate;
            effectiveWall=original.header.wallHighWaterMillis; wallElapsed=admitted;
        }
        long advanceWall(long elapsed, long observed) throws Exception {
            require(safe(observed) && elapsed>=wallElapsed && elapsed>=0);
            long delta=elapsed-wallElapsed;
            require(delta<=9007199254740991L-effectiveWall);
            effectiveWall=Math.max(observed, effectiveWall+delta); wallElapsed=elapsed;
            return effectiveWall;
        }
        boolean unexpiredAt(long expiry, long elapsed) {
            if (elapsed<wallElapsed || elapsed<0) return false;
            long delta=elapsed-wallElapsed;
            return delta<=9007199254740991L-effectiveWall && expiry>effectiveWall+delta;
        }
        boolean recognizes(MessagePreviewMetadataEnvelope.Record record) {
            if (equal(record, original) || (checked != null && equal(record, checked))) return true;
            for (int i=0; i<attempts; i++) if (equal(record, attempted[i])) return true;
            return false;
        }
    }
    private final Context application;
    private final int uid;
    private final Thread worker;
    private final MessagePreviewJournalIO journal;
    private final MessagePreviewVaultFence fence;
    private final Work work;
    private final Current current;
    private final Authority authority;
    private MessagePreviewCredentialKeyCustody.Request enteredRequest;

    MessagePreviewVaultProvisioning(Context application, int uid, Thread worker, MessagePreviewJournalIO journal,
            MessagePreviewVaultFence fence, Work work, Current current, Authority authority) {
        this.application=application; this.uid=uid; this.worker=worker; this.journal=journal;
        this.fence=fence; this.work=work; this.current=current; this.authority=authority;
    }
    private static boolean safe(long value) { return MessagePreviewVerificationState.safe(value); }
    private static void require(boolean value) throws Unavailable { if (!value) throw new Unavailable(); }
    static String opaque() {
        byte[] bytes=new byte[16]; new SecureRandom().nextBytes(bytes);
        char[] chars=new char[32]; char[] digits="0123456789abcdef".toCharArray();
        for (int i=0; i<bytes.length; i++) { chars[i*2]=digits[(bytes[i]>>>4)&15]; chars[i*2+1]=digits[bytes[i]&15]; }
        Arrays.fill(bytes, (byte)0); return new String(chars);
    }
    static boolean equal(MessagePreviewMetadataEnvelope.Record a, MessagePreviewMetadataEnvelope.Record b) {
        if (a == null || b == null) return false;
        MessagePreviewMetadataEnvelope.Header h=a.header, p=b.header;
        return h.installation.equals(p.installation) && h.generation==p.generation && h.kind==p.kind
            && h.alias.equals(p.alias) && h.expiresWallMillis==p.expiresWallMillis
            && h.wallHighWaterMillis==p.wallHighWaterMillis && h.operationId.equals(p.operationId)
            && h.baseGeneration==p.baseGeneration && h.vaultRevision==p.vaultRevision
            && Arrays.equals(a.credentialBytes(), b.credentialBytes());
    }
    private SecretKey metadata() throws Exception {
        current.requireCurrent();
        SecretKey key=new MessagePreviewKeystoreReader(application, work.installation).loadMetadata();
        current.requireCurrent(); return key;
    }
    private MessagePreviewMetadataEnvelope.Record read() throws Exception {
        MessagePreviewMetadataEnvelope.Record record=journal.read(work.installation, metadata());
        current.requireCurrent(); return record;
    }
    private long wall() throws Exception {
        current.requireCurrent(); long observed=System.currentTimeMillis(); long elapsed=SystemClock.elapsedRealtime();
        work.advanceWall(elapsed, observed);
        current.requireCurrent(); return work.effectiveWall;
    }
    private MessagePreviewMetadataEnvelope.Header header(MessagePreviewMetadataEnvelope.Kind kind, String alias, long expiry) throws Exception {
        MessagePreviewVaultFence.Operation op=work.operation;
        return new MessagePreviewMetadataEnvelope.Header(work.installation, op.generation, kind, alias, expiry,
            wall(), op.operationId, op.baseGeneration, op.vaultRevision);
    }
    private MessagePreviewMetadataEnvelope.Record write(MessagePreviewMetadataEnvelope.Header header, byte[] credential) throws Exception {
        SecretKey key=metadata(); byte[] bytes=MessagePreviewMetadataEnvelope.seal(header, credential, key);
        MessagePreviewMetadataEnvelope.Record expected=MessagePreviewMetadataEnvelope.open(bytes, work.installation, key);
        current.requireCurrent(); require(work.attempts < work.attempted.length);
        work.attempted[work.attempts++]=expected; // Exact intent retained even if finish/readback ACK is lost.
        require(journal.write(bytes, work.installation, key) == MessagePreviewJournalIO.Result.CHECKED);
        current.requireCurrent();
        MessagePreviewMetadataEnvelope.Record actual=read(); require(equal(actual, expected));
        work.checked=actual; return actual;
    }
    private MessagePreviewCredentialKeyCustody custody() throws Exception {
        return new MessagePreviewCredentialKeyCustody(application, uid, worker, work.installation, journal,
            new MessagePreviewCredentialKeyCustody.Gate() {
                @Override public void requireCurrent(MessagePreviewCredentialKeyCustody.Request request) throws Exception {
                    require(request == enteredRequest); current.requireCurrent();
                }
            });
    }
    private MessagePreviewCredentialKeyCustody.Request request(MessagePreviewCredentialKeyCustody custody,
            MessagePreviewMetadataEnvelope.Record predecessor, MessagePreviewMetadataEnvelope.Record head) throws Exception {
        current.requireCurrent(); long now=SystemClock.elapsedRealtime(); current.requireCurrent();
        long deadline=Math.min(work.deadline, now+10_000);
        enteredRequest=new MessagePreviewCredentialKeyCustody.Request(custody, fence, work.operation, predecessor, head, now, deadline);
        return enteredRequest;
    }
    MessagePreviewMetadataEnvelope.Record begin() throws Exception {
        require(authority != null || work.operation.kind == MessagePreviewVaultFence.Kind.REFUSED);
        require(equal(read(), work.original) && work.original.header.generation==work.operation.baseGeneration);
        MessagePreviewMetadataEnvelope.Record tombstone=write(header(MessagePreviewMetadataEnvelope.Kind.RETIRING,
            work.original.header.alias, 0), new byte[0]);
        MessagePreviewCredentialKeyCustody custody=custody();
        custody.deleteRetiringKey(request(custody, work.original, tombstone));
        current.requireCurrent(); work.oldDeleted=true;
        return write(header(work.operation.kind == MessagePreviewVaultFence.Kind.BEGIN
            ? MessagePreviewMetadataEnvelope.Kind.PENDING : MessagePreviewMetadataEnvelope.Kind.EMPTY,
            work.operation.kind == MessagePreviewVaultFence.Kind.BEGIN ? work.candidate : "", 0), new byte[0]);
    }
    MessagePreviewMetadataEnvelope.Record provision(String access) throws Exception {
        require(authority != null && work.operation.kind == MessagePreviewVaultFence.Kind.BEGIN && work.oldDeleted
            && work.checked != null && work.checked.header.kind == MessagePreviewMetadataEnvelope.Kind.PENDING);
        require(access != null && access.length() >= 1 && access.length() <= 8192);
        for (int i=0; i<access.length(); i++) require(access.charAt(i)>=33 && access.charAt(i)<=126);
        require(equal(read(), work.checked));
        current.requireCurrent(); long now=SystemClock.elapsedRealtime(); current.requireCurrent();
        long verifyDeadline=Math.min(work.deadline, now+8_000);
        Verification verification=authority.verify(work.identity, access, verifyDeadline);
        current.requireCurrent(); now=SystemClock.elapsedRealtime(); current.requireCurrent();
        require(now < verifyDeadline && verification != null);
        long expiry=verification.consume(work.identity, access);
        work.validatedExpiry=expiry;
        current.requireCurrent(); require(expiry > wall());
        MessagePreviewCredentialKeyCustody custody=custody();
        MessagePreviewCredentialKeyCustody.Request request=request(custody, work.original, work.checked);
        work.candidateEntered=true;
        SecretKey credential=custody.createPendingKey(request);
        current.requireCurrent(); require(expiry > wall());
        MessagePreviewMetadataEnvelope.Header committed=header(MessagePreviewMetadataEnvelope.Kind.COMMITTED, work.candidate, expiry);
        byte[] ciphertext=MessagePreviewCredentialEnvelope.seal(committed, work.operation.owner, access, expiry, credential);
        current.requireCurrent();
        MessagePreviewMetadataEnvelope.Record result=write(committed, ciphertext);
        credential=new MessagePreviewKeystoreReader(application, work.installation).loadCredential(work.candidate);
        current.requireCurrent();
        require(MessagePreviewCredentialEnvelope.verifyMatch(result, committed, work.operation.owner, access, expiry, credential));
        current.requireCurrent(); require(expiry > wall());
        return result;
    }
    MessagePreviewMetadataEnvelope.Record retire(Work predecessorWork) throws Exception {
        MessagePreviewMetadataEnvelope.Record actual=read();
        MessagePreviewMetadataEnvelope.Record predecessor=work.original;
        if (predecessorWork != null) {
            require(predecessorWork.recognizes(actual));
            // Only an exact materialized phase can be D2's allocation predecessor.
            // A reserved/unmaterialized generation stays INCOMPLETE, never synthesized.
            require(actual.header.generation==work.operation.baseGeneration);
            predecessor=actual;
            if (predecessorWork.candidateEntered) require(predecessor.header.alias.equals(predecessorWork.candidate));
            else if (!predecessorWork.oldDeleted) require(predecessor.header.alias.equals(predecessorWork.original.header.alias));
        } else require(equal(actual, predecessor));
        require(predecessor.header.generation==work.operation.baseGeneration);
        work.effectiveWall=Math.max(work.effectiveWall, predecessor.header.wallHighWaterMillis);
        MessagePreviewMetadataEnvelope.Record tombstone=write(header(MessagePreviewMetadataEnvelope.Kind.RETIRING,
            predecessor.header.alias, 0), new byte[0]);
        MessagePreviewCredentialKeyCustody custody=custody();
        custody.deleteRetiringKey(request(custody, predecessor, tombstone));
        current.requireCurrent();
        return write(header(MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0), new byte[0]);
    }
    MessagePreviewMetadataEnvelope.Record observe() throws Exception {
        MessagePreviewMetadataEnvelope.Record record=read(); require(work.recognizes(record)); return record;
    }
}
