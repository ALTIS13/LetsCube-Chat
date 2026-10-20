package com.kub.messenger;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

@CapacitorPlugin(name = "AndroidUpdates")
public class AndroidUpdatesPlugin extends Plugin {
    private final AtomicLong documentRevision = new AtomicLong();
    private Bridge documentBridge;
    private WebViewListener documentListener;

    private void unavailable(PluginCall call) {
        call.reject("Android update unavailable", "ANDROID_UPDATE_UNAVAILABLE");
    }
    private boolean current(Activity activity, Bridge bridge) {
        return getBridge() == bridge && getActivity() == activity && !activity.isFinishing() && !activity.isDestroyed();
    }
    private void document(PluginCall call, Consumer<Activity> action) {
        document(call, action, () -> unavailable(call));
    }
    private void document(PluginCall call, Consumer<Activity> action, Runnable refused) {
        Bridge bridge = getBridge();
        Activity activity = bridge == null ? null : getActivity();
        if (activity == null) { refused.run(); return; }
        activity.runOnUiThread(() -> {
            try {
                if (!current(activity, bridge)) throw new IllegalStateException();
                Uri page = Uri.parse(bridge.getWebView().getUrl());
                boolean local = ("https".equals(page.getScheme()) || "http".equals(page.getScheme())) && "localhost".equals(page.getHost());
                boolean web = "https".equals(page.getScheme()) && "app.letscube.ru".equals(page.getHost());
                if ((!local && !web) || page.getPort() != -1) throw new IllegalArgumentException();
                if (documentBridge != bridge) {
                    if (documentBridge != null) documentBridge.removeWebViewListener(documentListener);
                    documentRevision.incrementAndGet();
                    documentBridge = bridge;
                    documentListener = new WebViewListener() {
                        @Override public void onPageStarted(android.webkit.WebView view) { documentRevision.incrementAndGet(); }
                    };
                    bridge.addWebViewListener(documentListener);
                }
                action.accept(activity);
            } catch (Exception failure) { refused.run(); }
        });
    }
    private void runtime(PluginCall call, Consumer<AndroidUpdateRuntime> action) {
        // Capacitor dispatches plugin methods on its worker, but WebView belongs to UI.
        document(call, activity -> {
            Bridge bridge = getBridge();
            long revision = documentRevision.get();
            bridge.execute(() -> {
                if (!current(activity, bridge) || documentRevision.get() != revision) { unavailable(call); return; }
                try { action.accept(AndroidUpdateRuntime.get(getContext())); }
                catch (Exception failure) { unavailable(call); }
            });
        });
    }
    @Override protected void handleOnDestroy() {
        documentRevision.incrementAndGet();
        Bridge bridge = documentBridge;
        WebViewListener listener = documentListener;
        documentBridge = null; documentListener = null;
        if (bridge != null) new Handler(Looper.getMainLooper()).post(() -> bridge.removeWebViewListener(listener));
    }
    @PluginMethod public void status(PluginCall call) {
        runtime(call, value -> call.resolve(value.status()));
    }
    @PluginMethod public void check(PluginCall call) {
        runtime(call, value -> { value.begin(false, ignored -> {}); call.resolve(value.status()); });
    }
    @PluginMethod public void start(PluginCall call) {
        runtime(call, value -> { value.begin(true, ignored -> {}); call.resolve(value.status()); });
    }
    @PluginMethod public void cancel(PluginCall call) {
        runtime(call, value -> call.resolve(value.cancel()));
    }
    @PluginMethod public void permission(PluginCall call) {
        runtime(call, value -> {
            Bridge bridge = getBridge();
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                document(call, activity -> {
                    try {
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + getContext().getPackageName())));
                    } catch (Exception unavailable) { call.reject("Open Android installation settings", "ANDROID_UPDATE_PERMISSION"); return; }
                    bridge.execute(() -> call.resolve(value.status()));
                });
            } else call.resolve(value.status());
        });
    }
    @PluginMethod public void install(PluginCall call) {
        runtime(call, value -> {
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                call.resolve(value.status()); return;
            }
            value.prepareInstall((file, owner) -> document(call, activity -> {
                try {
                    Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updates", file);
                    Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT, true);
                    intent.setClipData(ClipData.newRawUri("LETSCUBE update", uri));
                    ResolveInfo installer = null;
                    for (ResolveInfo candidate : getContext().getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
                        int flags = candidate.activityInfo.applicationInfo.flags;
                        if ((flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0) { installer = candidate; break; }
                    }
                    if (installer == null) throw new IllegalStateException();
                    intent.setComponent(new ComponentName(installer.activityInfo.packageName, installer.activityInfo.name));
                    call.getData().put("__androidUpdateOwner", owner);
                    if (!value.handoff(owner, () -> startActivityForResult(call, intent, "installerReturned"))) {
                        value.finishInstaller(owner, "INSTALLER", call::resolve);
                    }
                } catch (Exception unavailable) {
                    value.finishInstaller(owner, "INSTALLER", call::resolve);
                }
            }, () -> value.finishInstaller(owner, "INSTALLER", ignored -> unavailable(call))), call::resolve);
        });
    }
    @ActivityCallback private void installerReturned(PluginCall call, ActivityResult result) {
        if (call == null) return;
        runtime(call, value -> {
            value.finishInstaller(call.getData().optLong("__androidUpdateOwner", -1),
                result.getResultCode() == Activity.RESULT_OK ? null : "INSTALL_CANCELLED", call::resolve);
        });
    }
}
