package com.kub.messenger;

import android.app.Activity;
import android.app.Application;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.Looper;
import android.os.Process;

// Inactive passive main-Activity authority. No initializer/plugin consumer is wired here.
final class MessagePreviewForegroundAuthority implements MessagePreviewInitializationGate.ForegroundAuthority,
        Application.ActivityLifecycleCallbacks {
    static final class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;
        private Unavailable() { super("UNAVAILABLE", null, false, false); }
    }
    private static MessagePreviewForegroundAuthority registered;
    private final Application application;
    private final int uid;
    private Activity active;
    private long epoch;
    private boolean listening, needsDetach, closed;

    private static final class Snapshot {
        final MessagePreviewForegroundAuthority issuer;
        final Activity activity;
        final long epoch;
        Snapshot(MessagePreviewForegroundAuthority issuer, Activity activity, long epoch) {
            this.issuer=issuer; this.activity=activity; this.epoch=epoch;
        }
    }
    private MessagePreviewForegroundAuthority(Application application, int uid) {
        this.application=application; this.uid=uid;
    }
    private static void requireMain() throws Unavailable {
        if (Looper.getMainLooper() == null || Looper.myLooper() != Looper.getMainLooper()) throw new Unavailable();
    }
    private static void requireApplication(Application application, int uid) throws Unavailable {
        if (application == null || uid < 10000 || uid % 100000 < 10000 || Process.myUid() != uid
            || application.getApplicationContext() != application) throw new Unavailable();
        ApplicationInfo info=application.getApplicationInfo();
        if (info == null || info.uid != uid) throw new Unavailable();
    }
    static MessagePreviewForegroundAuthority getOrCreate(Application application) throws Unavailable {
        try {
            requireMain();
            int uid=Process.myUid();
            requireApplication(application, uid); requireMain();
            MessagePreviewForegroundAuthority owner;
            synchronized (MessagePreviewForegroundAuthority.class) {
                if (registered != null) {
                    registered.requireAttached(application, uid);
                    return registered;
                }
                owner=new MessagePreviewForegroundAuthority(application, uid);
                registered=owner;
            }
            try { owner.attach(); }
            catch (Exception failed) {
                try { owner.close(); } catch (Unavailable detachFailed) { /* Retained terminal owner, no recreation. */ }
                throw new Unavailable();
            }
            return owner;
        } catch (Exception refused) { throw new Unavailable(); }
    }
    private synchronized void requireAttached(Application supplied, int suppliedUid) throws Unavailable {
        if (application != supplied || uid != suppliedUid || !listening || closed) throw new Unavailable();
    }
    private void attach() throws Unavailable {
        synchronized (this) { needsDetach=true; }
        application.registerActivityLifecycleCallbacks(this);
        requireApplication(application, uid); requireMain();
        synchronized (this) {
            if (closed) throw new Unavailable();
            listening=true;
        }
    }

    @Override public Object capture() throws Unavailable {
        requireMain();
        synchronized (this) {
            if (closed || !listening || active == null) throw new Unavailable();
            return new Snapshot(this, active, epoch);
        }
    }
    // The Gate's worker must be able to check its immutable snapshot without platform reads.
    @Override public synchronized boolean isCurrent(Object captured) {
        if (!(captured instanceof Snapshot)) return false;
        Snapshot snapshot=(Snapshot) captured;
        return !closed && listening && active != null && snapshot.issuer == this
            && snapshot.activity == active && snapshot.epoch == epoch;
    }
    private boolean advance() {
        if (epoch == Long.MAX_VALUE) { closed=true; listening=false; active=null; return false; }
        epoch++;
        return true;
    }
    private synchronized void retireMemory(boolean terminal) {
        active=null;
        if (!closed) advance();
        if (terminal) closed=true;
        if (closed) listening=false;
    }
    void close() throws Unavailable {
        retireMemory(true);
        try {
            requireMain();
            synchronized (this) { if (!needsDetach) return; }
            application.unregisterActivityLifecycleCallbacks(this);
            synchronized (this) { needsDetach=false; }
        } catch (Exception refused) { throw new Unavailable(); }
    }

    private boolean checkedCallback(Activity activity) {
        try {
            requireMain(); requireApplication(application, uid);
            if (activity == null || activity.getApplication() != application) throw new Unavailable();
            requireMain();
            return true;
        } catch (Exception refused) { retireMemory(true); return false; }
    }
    @Override public void onActivityResumed(Activity activity) {
        if (!checkedCallback(activity)) return;
        if (activity.getClass() != MainActivity.class) { retireMemory(false); return; }
        synchronized (this) {
            if (closed || !listening || !advance()) return;
            active=activity;
        }
    }
    private void retire(Activity activity) {
        synchronized (this) {
            if (active == activity && active != null) { active=null; if (!closed) advance(); }
        }
        checkedCallback(activity);
    }
    // API29+ receives these earlier; ordinary callbacks remain the API24-28 fallback.
    @Override public void onActivityPrePaused(Activity activity) { retire(activity); }
    @Override public void onActivityPreStopped(Activity activity) { retire(activity); }
    @Override public void onActivityPreDestroyed(Activity activity) { retire(activity); }
    @Override public void onActivityPaused(Activity activity) { retire(activity); }
    @Override public void onActivityStopped(Activity activity) { retire(activity); }
    @Override public void onActivityDestroyed(Activity activity) { retire(activity); }
    @Override public void onActivityCreated(Activity activity, Bundle state) { checkedCallback(activity); }
    @Override public void onActivityStarted(Activity activity) { checkedCallback(activity); }
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { checkedCallback(activity); }
}
