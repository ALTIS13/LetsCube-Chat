package com.kub.messenger;

import java.lang.reflect.Proxy;
import java.util.List;
import java.util.function.Consumer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class MessagePreviewContentLookupProbe {
    static final class Fixture implements MessagePreviewContentLookup.Clock, MessagePreviewContentLookup.Owner {
        volatile long wall = MessagePreviewContentProbe.NOW, elapsed = 10_000;
        volatile long epoch = 7, generation = 11;
        volatile boolean current = true, failOwner, cancelInOwner;
        int reads, deliveries, cancellations, ownerChecks;
        String allowed = "message";
        MessagePreviewContentLookup lookup;
        Runnable network = () -> {};
        Object response = List.of(MessagePreviewContentProbe.row());
        Fixture() {
            lookup = new MessagePreviewContentLookup((access, key, device, notification, deadline) -> {
                reads++;
                MessagePreviewContentProbe.check(access.equals("fictional-access") && key.equals("fictional-public")
                    && device.equals(MessagePreviewContentProbe.DEVICE) && notification.equals(MessagePreviewContentProbe.NOTIFICATION)
                    && deadline == 12_000, "EXACT_LOOKUP_REQUEST_DEADLINE");
                network.run(); return response;
            }, () -> cancellations++, this, this);
        }
        public long wallTime() { return wall; }
        public long elapsedTime() { return elapsed; }
        public boolean isCurrent(MessagePreviewContentLookup.Request request) {
            ownerChecks++;
            if (failOwner) throw new IllegalStateException();
            if (cancelInOwner && reads > 0) lookup.cancel();
            return current && request.accountEpoch == epoch && request.cardGeneration == generation && request.maximumLevel.equals(allowed);
        }
        MessagePreviewContentLookup.Request request() {
            return new MessagePreviewContentLookup.Request(MessagePreviewContentProbe.USER, MessagePreviewContentProbe.SESSION,
                MessagePreviewContentProbe.DEVICE, MessagePreviewContentProbe.NOTIFICATION, MessagePreviewContentProbe.CHAT,
                MessagePreviewContentProbe.MESSAGE, 7, 11, "message");
        }
        MessagePreviewContentLookup.Outcome consume() {
            return lookup.consume(request(), "fictional-access", "fictional-public", value -> {
                deliveries++;
                MessagePreviewContentProbe.check(value.title.equals("Fictional Sender") && value.body.equals("Fictional message"),
                    "EXACT_CURRENT_CONTENT");
            });
        }
    }
    static Object runCurrent() throws Exception {
        Class<?> type;
        try { type = Class.forName("com.kub.messenger.MessagePreviewContentLookup"); }
        catch (ClassNotFoundException missing) { return null; }
        String prefix = type.getName() + "$";
        Class<?> readerType = Class.forName(prefix + "Reader"), clockType = Class.forName(prefix + "Clock");
        Class<?> ownerType = Class.forName(prefix + "Owner"), requestType = Class.forName(prefix + "Request");
        Object reader = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{readerType},
            (proxy, method, args) -> List.of(MessagePreviewContentProbe.row()));
        Object clock = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{clockType},
            (proxy, method, args) -> method.getName().equals("wallTime") ? MessagePreviewContentProbe.NOW : 10_000L);
        Object owner = Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{ownerType}, (proxy, method, args) -> true);
        var constructor = type.getDeclaredConstructor(readerType, Runnable.class, clockType, ownerType);
        constructor.setAccessible(true); Object lookup = constructor.newInstance(reader, (Runnable) () -> {}, clock, owner);
        var requestConstructor = requestType.getDeclaredConstructor(String.class, String.class, String.class,
            String.class, String.class, String.class, long.class, long.class, String.class);
        requestConstructor.setAccessible(true);
        Object request = requestConstructor.newInstance(MessagePreviewContentProbe.USER, MessagePreviewContentProbe.SESSION,
            MessagePreviewContentProbe.DEVICE, MessagePreviewContentProbe.NOTIFICATION, MessagePreviewContentProbe.CHAT,
            MessagePreviewContentProbe.MESSAGE, 7L, 11L, "message");
        int[] calls = {0}; Consumer<Object> sink = value -> calls[0]++;
        var consume = type.getDeclaredMethod("consume", requestType, String.class, String.class, Consumer.class);
        consume.setAccessible(true); Object result = consume.invoke(lookup, request, "fictional-access", "fictional-public", sink);
        MessagePreviewContentProbe.check(calls[0] == 1, "CURRENT_OWNER_RECEIVES_ONE_CONTENT");
        return result;
    }
    static void refusal(String scenario) {
        Fixture f = new Fixture();
        switch (scenario) {
            case "retired-before": f.current = false; break;
            case "retired-during": f.network = () -> f.current = false; break;
            case "epoch-during": f.network = () -> f.epoch++; break;
            case "card-during": f.network = () -> f.generation++; break;
            case "consent-during": f.network = () -> f.allowed = "sender"; break;
            case "cancel-during": f.network = () -> f.lookup.cancel(); break;
            case "close-during": f.network = () -> f.lookup.close(); break;
            case "closed-before": f.lookup.close(); break;
            case "exact-deadline": f.network = () -> f.elapsed += 2_000; break;
            case "clock-rollback": f.network = () -> f.wall--; break;
            case "elapsed-rollback": f.network = () -> f.elapsed--; break;
            case "forward-expiry": f.network = () -> f.wall += 15_000; break;
            case "elapsed-expiry": {
                var row = MessagePreviewContentProbe.row(); row.put("expires_at", "2026-10-16T00:00:01+00:00");
                f.response = List.of(row); f.network = () -> f.elapsed += 1_500; break;
            }
            case "empty": f.response = List.of(); break;
            case "reader-error": f.network = () -> { throw new IllegalStateException(); }; break;
            case "owner-error-before": f.failOwner = true; break;
            case "owner-error-after": f.network = () -> f.failOwner = true; break;
            case "cancel-in-final-owner": f.cancelInOwner = true; break;
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
        MessagePreviewContentProbe.check(f.consume() == MessagePreviewContentLookup.Outcome.REFUSED && f.deliveries == 0,
            "LOOKUP_REFUSED_" + scenario);
        if (scenario.equals("retired-before") || scenario.equals("closed-before") || scenario.equals("owner-error-before")) {
            MessagePreviewContentProbe.check(f.reads == 0, "REFUSAL_BEFORE_NETWORK");
        } else MessagePreviewContentProbe.check(f.reads == 1, "NO_AUTOMATIC_RETRY");
        if (scenario.equals("cancel-during") || scenario.equals("close-during") || scenario.equals("cancel-in-final-owner")) {
            MessagePreviewContentProbe.check(f.cancellations == 1, "ONE_TRANSPORT_CANCELLATION");
        }
    }
    static void held() throws Exception {
        Fixture f = new Fixture();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicReference<MessagePreviewContentLookup.Outcome> outcome = new AtomicReference<>();
        f.network = () -> {
            entered.countDown();
            try { MessagePreviewContentProbe.check(release.await(3, TimeUnit.SECONDS), "HELD_RELEASE"); }
            catch (InterruptedException interrupted) { throw new AssertionError("HELD_INTERRUPTED"); }
        };
        Thread thread = new Thread(() -> outcome.set(f.consume())); thread.start();
        try {
            MessagePreviewContentProbe.check(entered.await(3, TimeUnit.SECONDS), "HELD_NETWORK_ENTERED");
            MessagePreviewContentProbe.check(f.consume() == MessagePreviewContentLookup.Outcome.REFUSED && f.reads == 1,
                "BUSY_HAS_NO_SECOND_REQUEST");
            f.lookup.cancel();
            MessagePreviewContentProbe.check(f.consume() == MessagePreviewContentLookup.Outcome.REFUSED && f.reads == 1,
                "CANCELLED_WORKER_STAYS_SINGLE_FLIGHT");
        } finally { release.countDown(); thread.join(3_000); }
        MessagePreviewContentProbe.check(!thread.isAlive() && outcome.get() == MessagePreviewContentLookup.Outcome.REFUSED
            && f.deliveries == 0 && f.cancellations == 1, "HELD_CANCEL_CANNOT_DELIVER");
        f.network = () -> {};
        MessagePreviewContentProbe.check(f.consume() == MessagePreviewContentLookup.Outcome.CONSUMED && f.deliveries == 1 && f.reads == 2,
            "FRESH_SEPARATE_REQUEST_AFTER_CANCEL");
    }
    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        if (scenario.equals("current")) {
            Object result = runCurrent();
            MessagePreviewContentProbe.check(result != null && result.toString().equals("CONSUMED"), "CURRENT_OWNER_CONTENT_CONSUMED");
        } else if (scenario.equals("held")) held();
        else if (scenario.equals("before-deadline")) {
            Fixture f = new Fixture(); f.network = () -> f.elapsed += 1_999;
            MessagePreviewContentProbe.check(f.consume() == MessagePreviewContentLookup.Outcome.CONSUMED && f.deliveries == 1, "FINITE_DEADLINE_POSITIVE");
        } else if (scenario.equals("sink-error")) {
            Fixture f = new Fixture(); int[] entered = {0};
            var outcome = f.lookup.consume(f.request(), "fictional-access", "fictional-public", value -> { entered[0]++; throw new IllegalStateException(); });
            MessagePreviewContentProbe.check(outcome == MessagePreviewContentLookup.Outcome.UNKNOWN && entered[0] == 1 && f.reads == 1,
                "SINK_ERROR_IS_NOT_UNAPPLIED_CLAIM");
        } else if (scenario.equals("bad-request")) {
            Fixture f = new Fixture();
            var request = new MessagePreviewContentLookup.Request(MessagePreviewContentProbe.USER, MessagePreviewContentProbe.SESSION,
                MessagePreviewContentProbe.DEVICE, MessagePreviewContentProbe.NOTIFICATION, MessagePreviewContentProbe.CHAT,
                MessagePreviewContentProbe.MESSAGE, -1, 11, "message");
            var outcome = f.lookup.consume(request, "fictional-access", "fictional-public", value -> f.deliveries++);
            MessagePreviewContentProbe.check(outcome == MessagePreviewContentLookup.Outcome.REFUSED && f.reads == 0 && f.deliveries == 0, "INVALID_REQUEST_NO_NETWORK");
        } else refusal(scenario);
        System.out.println("PASS " + args[0]);
    }
}
