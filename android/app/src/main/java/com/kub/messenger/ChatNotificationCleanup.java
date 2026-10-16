package com.kub.messenger;

import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.function.LongConsumer;
import java.util.regex.Pattern;

/** Presentation-only lease and process-local ordering, not native authentication. */
final class ChatNotificationCleanup {
    static final String EXTRA_VERSION = "letscube.cleanup.v";
    static final String EXTRA_CHAT = "letscube.cleanup.chat";
    static final String EXTRA_NOTIFICATION = "letscube.cleanup.notification";
    static final String EXTRA_MESSAGE = "letscube.cleanup.message";
    static final String EXTRA_GENERATION = "letscube.cleanup.generation";
    private static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Object CARDS = new Object();
    // NotificationManager.notify enqueues work; an active OS card can lag this intent.
    // Survives document/owner rotation; cold starts load only our durable intent.
    private static final Map<String, Posted> latestPosts = new HashMap<>();
    private static long postGeneration;
    private static volatile Owner owner;
    private static String instanceId;
    private static long revision;

    static boolean isUuid(String value) { return value != null && UUID.matcher(value).matches(); }

    static synchronized void activate(String instance) {
        instanceId = instance;
        revision = 0;
        owner = null;
    }

    static synchronized void deactivate(String instance) {
        if (instance.equals(instanceId)) { instanceId = null; owner = null; }
    }

    static synchronized boolean bind(String instance, long nextRevision, String ownerId, long accountEpoch) {
        if (!isUuid(instance) || !instance.equals(instanceId) || nextRevision < 1 || nextRevision < revision
            || accountEpoch < 0 || (ownerId != null && !isUuid(ownerId))) return false;
        if (nextRevision == revision) return matches(instance, nextRevision, ownerId, accountEpoch) != null;
        revision = nextRevision;
        owner = ownerId == null ? null : new Owner(instance, nextRevision, ownerId, accountEpoch);
        return true;
    }

    static Owner matches(String instance, long expectedRevision, String ownerId, long accountEpoch) {
        Owner current = owner;
        return current != null && current.instanceId.equals(instance) && current.revision == expectedRevision
            && current.ownerId.equals(ownerId) && current.accountEpoch == accountEpoch ? current : null;
    }

    static boolean post(IntentStore intents, String tag, String notificationId, String messageId, LongConsumer posting) {
        synchronized (CARDS) {
            Posted previous = latest(tag, intents);
            postGeneration = Math.max(postGeneration, previous == null ? 0 : previous.generation);
            if (postGeneration == Long.MAX_VALUE) return false;
            long generation = ++postGeneration;
            Posted intent = new Posted(notificationId, messageId, generation);
            latestPosts.put(tag, new Posted(null, null, generation));
            if (!intents.write(tag, intent)) return false;
            latestPosts.put(tag, intent);
            posting.accept(generation);
            return true;
        }
    }

    private static Posted latest(String tag, IntentStore intents) {
        Posted posted = latestPosts.get(tag);
        if (posted == null) {
            posted = intents.read(tag);
            if (posted != null) latestPosts.put(tag, posted);
        }
        return posted;
    }

    private static boolean matchesLatest(Card card, IntentStore intents) {
        Posted posted = latest(card.tag, intents);
        return posted != null && card.generation == posted.generation
            && card.notificationId.equals(posted.notificationId) && card.messageId.equals(posted.messageId);
    }

    // Presentation ordering only. The synchronous publisher must also hold its
    // native credential/choice authority; this does not authenticate a preview.
    static boolean updateCurrent(Owner expected, Card expectedCard, Cards cards, Runnable posting) {
        if (expected == null || cards == null || posting == null || !tracked(expectedCard)) return false;
        synchronized (CARDS) {
            if (owner != expected || !matchesLatest(expectedCard, cards.intents())) return false;
            List<Card> active = cards.active();
            if (active == null) return false;
            int matches = 0;
            for (Card card : active) {
                if (card == null || card.id != expectedCard.id || !expectedCard.tag.equals(card.tag)) continue;
                if (!tracked(card) || card.generation != expectedCard.generation
                    || !card.chatId.equals(expectedCard.chatId) || !card.notificationId.equals(expectedCard.notificationId)
                    || !card.messageId.equals(expectedCard.messageId)) return false;
                matches++;
            }
            synchronized (ChatNotificationCleanup.class) {
                Posted current = latest(expectedCard.tag, cards.intents());
                Posted durable = cards.intents().read(expectedCard.tag);
                if (matches != 1 || owner != expected || !matchesLatest(expectedCard, cards.intents())
                    || current == null || current.previewRetired || !matchesPosted(expectedCard, durable)) return false;
                // Do not allocate another generation or hide an ambiguous posting failure.
                posting.run();
                return true;
            }
        }
    }

    private static boolean matchesPosted(Card card, Posted posted) {
        return posted != null && card.generation == posted.generation
            && card.notificationId.equals(posted.notificationId) && card.messageId.equals(posted.messageId);
    }

    private static boolean tracked(Card card) {
        return card != null && card.id == 0 && card.protocol == 1 && !card.summary && card.generation > 0
            && isUuid(card.chatId) && ("message:chat:" + card.chatId).equals(card.tag)
            && isUuid(card.notificationId) && isUuid(card.messageId);
    }

    private static void retirePreview(Owner expected, String tag, List<Read> reads, IntentStore intents) {
        synchronized (ChatNotificationCleanup.class) {
            if (owner != expected) return;
            Posted current = latest(tag, intents);
            if (current == null) return;
            for (Read read : reads) {
                if (read.notificationId.equals(current.notificationId) && read.messageId.equals(current.messageId)) {
                    // OS cancellation/observation may lag or fail. In-flight content
                    // must already be retired without changing cleanup's pending intent.
                    current.previewRetired = true;
                    return;
                }
            }
        }
    }

    static int removeRead(Owner expected, String chatId, List<Read> confirmed, Cards cards) {
        return reconcileRead(expected, chatId, confirmed, cards).removed;
    }

    static Result reconcileRead(Owner expected, String chatId, List<Read> confirmed, Cards cards) {
        if (!isUuid(chatId) || confirmed == null || confirmed.isEmpty() || confirmed.size() > 30) return Result.SETTLED;
        for (Read read : confirmed) {
            if (read == null || !isUuid(read.notificationId) || !isUuid(read.messageId)) return Result.SETTLED;
        }
        synchronized (CARDS) {
            if (expected == null || owner != expected) return Result.SETTLED;
            String tag = "message:chat:" + chatId;
            retirePreview(expected, tag, confirmed, cards.intents());
            for (Card card : cards.active()) {
                if (card == null || card.id != 0 || !tag.equals(card.tag)) continue;
                if (card.protocol != 1 || card.summary || !chatId.equals(card.chatId) || !isUuid(card.notificationId) || !isUuid(card.messageId)) {
                    continue;
                }
                if (!matchesLatest(card, cards.intents())) continue;
                boolean read = false;
                for (Read receipt : confirmed) {
                    if (card.notificationId.equals(receipt.notificationId) && card.messageId.equals(receipt.messageId)) {
                        read = true;
                        break;
                    }
                }
                synchronized (ChatNotificationCleanup.class) {
                    if (read && owner == expected) {
                        cards.cancel(card.tag, card.id);
                        return new Result(1, false);
                    }
                }
            }
            // Only an exact confirmed latest intent can warrant a bounded OS recheck.
            Posted posted = latest(tag, cards.intents());
            if (owner == expected && posted != null && posted.generation > 0
                && isUuid(posted.notificationId) && isUuid(posted.messageId)) {
                for (Read receipt : confirmed) {
                    if (posted.notificationId.equals(receipt.notificationId) && posted.messageId.equals(receipt.messageId)) return new Result(0, true);
                }
            }
            return Result.SETTLED;
        }
    }

    interface Cards { List<Card> active(); void cancel(String tag, int id); IntentStore intents(); }
    interface IntentStore { Posted read(String tag); boolean write(String tag, Posted intent); }
    static final class Result {
        static final Result SETTLED = new Result(0, false);
        final int removed;
        final boolean pending;
        Result(int removed, boolean pending) { this.removed = removed; this.pending = pending; }
    }
    static final class Posted {
        final String notificationId, messageId;
        final long generation;
        boolean previewRetired;
        Posted(String notificationId, String messageId, long generation) {
            this.notificationId = notificationId; this.messageId = messageId; this.generation = generation;
        }
    }
    static final class Owner {
        final String instanceId, ownerId;
        final long revision, accountEpoch;
        Owner(String instanceId, long revision, String ownerId, long accountEpoch) {
            this.instanceId = instanceId; this.revision = revision; this.ownerId = ownerId; this.accountEpoch = accountEpoch;
        }
    }
    static final class Read {
        final String notificationId, messageId;
        Read(String notificationId, String messageId) { this.notificationId = notificationId; this.messageId = messageId; }
    }
    static final class Card {
        final String tag, chatId, notificationId, messageId;
        final int id, protocol;
        final boolean summary;
        final long generation;
        Card(String tag, int id, boolean summary, int protocol, String chatId, String notificationId, String messageId, long generation) {
            this.tag = tag; this.id = id; this.summary = summary; this.protocol = protocol;
            this.chatId = chatId; this.notificationId = notificationId; this.messageId = messageId;
            this.generation = generation;
        }
    }
}
