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
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidUpdates")
public class AndroidUpdatesPlugin extends Plugin {
    private AndroidUpdateRuntime runtime(PluginCall call) {
        try {
            Uri page = Uri.parse(getBridge().getWebView().getUrl());
            boolean local = ("https".equals(page.getScheme()) || "http".equals(page.getScheme())) && "localhost".equals(page.getHost());
            boolean web = "https".equals(page.getScheme()) && "app.letscube.ru".equals(page.getHost());
            if ((!local && !web) || page.getPort() != -1) throw new IllegalArgumentException();
            return AndroidUpdateRuntime.get(getContext());
        } catch (Exception failure) { call.reject("Android update unavailable", "ANDROID_UPDATE_UNAVAILABLE"); return null; }
    }
    @PluginMethod public void status(PluginCall call) {
        AndroidUpdateRuntime value = runtime(call); if (value != null) call.resolve(value.status());
    }
    @PluginMethod public void check(PluginCall call) {
        AndroidUpdateRuntime value = runtime(call);
        if (value != null) { value.begin(false, ignored -> {}); call.resolve(value.status()); }
    }
    @PluginMethod public void start(PluginCall call) {
        AndroidUpdateRuntime value = runtime(call);
        if (value != null) { value.begin(true, ignored -> {}); call.resolve(value.status()); }
    }
    @PluginMethod public void cancel(PluginCall call) {
        AndroidUpdateRuntime value = runtime(call); if (value != null) call.resolve(value.cancel());
    }
    @PluginMethod public void permission(PluginCall call) {
        AndroidUpdateRuntime value = runtime(call); if (value == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())));
            } catch (Exception unavailable) { call.reject("Open Android installation settings", "ANDROID_UPDATE_PERMISSION"); return; }
        }
        call.resolve(value.status());
    }
    @PluginMethod public void install(PluginCall call) {
        AndroidUpdateRuntime value = runtime(call); if (value == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.resolve(value.status()); return;
        }
        value.prepareInstall((file, owner) -> getActivity().runOnUiThread(() -> {
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
                if (!value.handoff(owner, () -> startActivityForResult(call, intent, "installerReturned"))) call.resolve(value.status());
            } catch (Exception unavailable) {
                value.installerReturned(owner, "INSTALLER"); call.resolve(value.status());
            }
        }), call::resolve);
    }
    @ActivityCallback private void installerReturned(PluginCall call, ActivityResult result) {
        try {
            AndroidUpdateRuntime value = AndroidUpdateRuntime.get(getContext());
            if (call != null) value.installerReturned(call.getData().optLong("__androidUpdateOwner", -1),
                result.getResultCode() == Activity.RESULT_OK ? null : "INSTALL_CANCELLED");
            if (call != null) call.resolve(value.status());
        } catch (Exception unavailable) { if (call != null) call.reject("Android update unavailable", "ANDROID_UPDATE_UNAVAILABLE"); }
    }
}
