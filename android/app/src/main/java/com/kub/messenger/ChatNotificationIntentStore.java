package com.kub.messenger;

import android.content.Context;
import android.content.SharedPreferences;

/** Only opaque card identity; no provider text, credentials or account profile. */
final class ChatNotificationIntentStore implements ChatNotificationCleanup.IntentStore {
    private final SharedPreferences preferences;
    ChatNotificationIntentStore(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences("letscube.chat_cleanup.v1", Context.MODE_PRIVATE);
    }
    @Override public ChatNotificationCleanup.Posted read(String tag) {
        try {
            long generation = preferences.getLong(tag + ":generation", 0);
            if (generation <= 0) return null;
            return new ChatNotificationCleanup.Posted(preferences.getString(tag + ":notification", null),
                preferences.getString(tag + ":message", null), generation);
        } catch (RuntimeException unavailable) { return null; }
    }
    @Override public boolean write(String tag, ChatNotificationCleanup.Posted intent) {
        try {
            return preferences.edit().putString(tag + ":notification", intent.notificationId)
                .putString(tag + ":message", intent.messageId).putLong(tag + ":generation", intent.generation).commit();
        } catch (RuntimeException unavailable) { return false; }
    }
}
