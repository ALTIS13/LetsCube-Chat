package com.kub.messenger;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.util.AtomicFile;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** One app-process transaction boundary for service, activity, bridge and expiry. */
final class VoiceCallRuntime {
    static final String CHANNEL_ID = "calls";
    static final int NOTIFICATION_ID = 1;
    static final String ACTION_PREFIX = "com.kub.messenger.VOICE_CALL_OPEN.";
    private static final Object LOCK = new Object();
    private static VoiceCallRuntime instance;
    private static boolean resumed;
    private static String foregroundRing;
    private static boolean storageFailed;
    private final Context context;
    private final AtomicFile file;
    private final NotificationManager notifications;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final VoiceCallState.Clock clock;
    private Runnable actionListener;
    private final Runnable expiry = this::expire;

    static VoiceCallRuntime get(Context context) {
        synchronized (LOCK) {
            if (instance == null) instance = new VoiceCallRuntime(context);
            return instance;
        }
    }

    VoiceCallRuntime(Context context) {
        this.context = context.getApplicationContext();
        file = new AtomicFile(new File(this.context.getNoBackupFilesDir(), "voice-calls-v1.bin"));
        notifications = this.context.getSystemService(NotificationManager.class);
        clock = new VoiceCallState.Clock() {
            public long wallTime() { return System.currentTimeMillis(); }
            public long elapsedTime() { return SystemClock.elapsedRealtime(); }
            public long bootCount() {
                return Settings.Global.getInt(VoiceCallRuntime.this.context.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
            }
        };
        synchronized (LOCK) {
            if (supported()) ensureChannel();
            try { transaction(state -> null); } catch (IllegalStateException ignored) { /* Remain fail-closed. */ }
        }
    }

    static boolean supported() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O; }

    static boolean isResumed() {
        synchronized (LOCK) { return resumed; }
    }

    String beginBinding(String recipientId, String recipientSessionId) {
        synchronized (LOCK) {
            String epoch = transaction(state -> state.beginBinding(recipientId, recipientSessionId));
            foregroundRing = null;
            return epoch;
        }
    }

    boolean commitBinding(String epoch, String recipientId, String recipientSessionId) {
        synchronized (LOCK) {
            if (!VoiceCallNotificationContract.isUuid(epoch) || !VoiceCallNotificationContract.isUuid(recipientId)
                || !VoiceCallNotificationContract.isUuid(recipientSessionId)) throw new IllegalArgumentException("Invalid binding");
            if (!supported()) return false;
            if (!canNotify()) {
                transaction(state -> { state.clearBinding(); return null; });
                return false;
            }
            return transaction(state -> state.commitBinding(epoch, recipientId, recipientSessionId));
        }
    }

    void clearBinding() {
        synchronized (LOCK) {
            foregroundRing = null;
            transaction(state -> { state.clearBinding(); return null; });
        }
    }

    void setCallsAllowed(boolean allowed) {
        synchronized (LOCK) {
            transaction(state -> { state.setCallsAllowed(allowed); return null; });
        }
    }

    void setForegroundRing(String ringKey) {
        synchronized (LOCK) {
            transaction(state -> { state.setForegroundRing(ringKey); return null; });
            foregroundRing = resumed ? ringKey : null;
        }
    }

    void setResumed(boolean value) {
        synchronized (LOCK) {
            resumed = value;
            foregroundRing = null;
            try { transaction(state -> null); } catch (IllegalStateException ignored) { /* No activity crash on disk failure. */ }
        }
    }

    void receive(Map<String, String> data) {
        synchronized (LOCK) {
            if (!supported()) return;
            try {
                if (!canNotify()) { clearBinding(); return; }
                VoiceCallNotificationContract.Event show = transaction(state -> state.receive(data));
                if (show != null) {
                    // Re-read after the durable transition. Never re-alert a persisted generation.
                    VoiceCallState state = readState();
                    long remaining = show.expiresAt - state.now();
                    if (remaining > 0 && state.activeEvents().stream().anyMatch(event -> event.ringKey.equals(show.ringKey))) {
                        show(show, state.tapToken(show.ringKey), remaining);
                    }
                }
            } catch (IOException | IllegalStateException | SecurityException ignored) {
                cancelVoiceCards();
            }
        }
    }

    static boolean isVoiceIntent(Intent intent) {
        return intent != null && intent.getAction() != null && intent.getAction().startsWith(ACTION_PREFIX);
    }

    boolean captureIntent(Intent intent) {
        if (!isVoiceIntent(intent)) return false;
        synchronized (LOCK) {
            if (!supported()) return false;
            try {
                if (!canNotify()) { clearBinding(); return false; }
                boolean captured = transaction(state -> state.captureTap(intent.getAction().substring(ACTION_PREFIX.length())));
                if (captured && actionListener != null) handler.post(actionListener);
                return captured;
            } catch (IllegalStateException ignored) { return false; }
        }
    }

    VoiceCallNotificationContract.Event consumePendingAction() {
        synchronized (LOCK) {
            if (!supported()) return null;
            if (!canNotify()) { clearBinding(); return null; }
            return transaction(VoiceCallState::consumePendingAction);
        }
    }

    void setActionListener(Runnable listener) {
        synchronized (LOCK) {
            actionListener = listener;
            try {
                if (transaction(VoiceCallState::hasPendingAction)) handler.post(listener);
            } catch (IllegalStateException ignored) { /* No action is eligible on storage failure. */ }
        }
    }

    VoiceCallNotificationContract.Event revalidateConsumedAction(String ringKey) {
        synchronized (LOCK) {
            if (!supported()) return null;
            if (!canNotify()) { clearBinding(); return null; }
            return transaction(state -> state.revalidateConsumedAction(ringKey));
        }
    }

    void removeActionListener(Runnable listener) {
        synchronized (LOCK) {
            handler.removeCallbacks(listener);
            if (actionListener == listener) actionListener = null;
        }
    }

    private interface Transition<T> { T apply(VoiceCallState state); }

    private <T> T transaction(Transition<T> transition) {
        try {
            // Disk is the shared authority, including if another runtime was reconstructed.
            VoiceCallState state = readState();
            state.setResumed(resumed);
            state.setForegroundRing(foregroundRing);
            if (!supported()) state.clearBinding();
            T result = transition.apply(state);
            state.prune();
            writeState(state);
            reconcileCards(state);
            schedule(state);
            return result;
        } catch (IOException e) {
            storageFailed = true;
            file.delete();
            handler.removeCallbacks(expiry);
            cancelVoiceCards();
            throw new IllegalStateException("Voice state unavailable");
        }
    }

    private VoiceCallState readState() throws IOException {
        if (storageFailed) return new VoiceCallState(clock);
        try (FileInputStream in = file.openRead(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int length;
            while ((length = in.read(buffer)) != -1) {
                if (out.size() + length > VoiceCallState.MAX_BYTES) throw new IOException("Voice state too large");
                out.write(buffer, 0, length);
            }
            return VoiceCallState.decode(out.toByteArray(), clock);
        } catch (java.io.FileNotFoundException e) {
            if (file.getBaseFile().exists()) throw new IOException("Voice state unavailable");
            return new VoiceCallState(clock);
        }
    }

    private void writeState(VoiceCallState state) throws IOException {
        byte[] bytes = state.encode();
        FileOutputStream out = null;
        try {
            out = file.startWrite();
            out.write(bytes);
            out.getFD().sync();
            file.finishWrite(out);
            storageFailed = false;
        } catch (IOException e) {
            if (out != null) file.failWrite(out);
            throw e;
        }
    }

    private boolean canNotify() {
        if (notifications == null || !notifications.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationChannel channel = notifications.getNotificationChannel(CHANNEL_ID);
        return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private void ensureChannel() {
        if (notifications == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, context.getString(R.string.voice_calls_channel), NotificationManager.IMPORTANCE_HIGH);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        notifications.createNotificationChannel(channel);
    }

    private void show(VoiceCallNotificationContract.Event event, String token, long remaining) {
        if (!canNotify() || token == null) return;
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_PREFIX + token)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_voice_call)
            .setContentTitle(context.getString(R.string.voice_calls_title))
            .setContentText(context.getString(R.string.voice_calls_body))
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(Math.min(45_000, remaining))
            .build();
        notifications.notify(VoiceCallNotificationContract.notificationTag(event.ringKey), NOTIFICATION_ID, notification);
    }

    private void reconcileCards(VoiceCallState state) {
        if (notifications == null) return;
        Set<String> active = new HashSet<>();
        if (supported() && canNotify()) {
            for (VoiceCallNotificationContract.Event event : state.activeEvents()) active.add(VoiceCallNotificationContract.notificationTag(event.ringKey));
        }
        for (StatusBarNotification card : notifications.getActiveNotifications()) {
            if (isVoiceCard(card) && !active.contains(card.getTag())) notifications.cancel(card.getTag(), card.getId());
        }
    }

    private static boolean isVoiceCard(StatusBarNotification card) {
        return card.getId() == NOTIFICATION_ID && card.getTag() != null && card.getTag().startsWith(VoiceCallNotificationContract.TAG_PREFIX);
    }

    private void cancelVoiceCards() {
        if (notifications == null) return;
        for (StatusBarNotification card : notifications.getActiveNotifications()) {
            if (isVoiceCard(card)) notifications.cancel(card.getTag(), card.getId());
        }
    }

    private void schedule(VoiceCallState state) {
        handler.removeCallbacks(expiry);
        long next = state.nextExpiry();
        if (next != Long.MAX_VALUE) handler.postDelayed(expiry, Math.max(1, Math.min(1_000, next - state.now())));
    }

    private void expire() {
        synchronized (LOCK) {
            try { transaction(state -> null); } catch (IllegalStateException ignored) { /* Already cancelled. */ }
        }
    }
}
