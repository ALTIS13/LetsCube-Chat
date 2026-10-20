// Android/Capacitor leaves only. The production plugin is compiled unchanged.
export const ports = {
  'android/os/Looper.java': `package android.os;
public final class Looper {
  public static final Looper MAIN = new Looper(), PLUGINS = new Looper(), IO = new Looper();
  public static final ThreadLocal<Looper> CURRENT = new ThreadLocal<>();
  public static Looper getMainLooper() { return MAIN; }
  public static Looper myLooper() { return CURRENT.get(); }
}`,
  'android/os/Handler.java': `package android.os;
public class Handler {
  private final Looper looper;
  public Handler(Looper looper) { this.looper = looper; }
  public boolean post(Runnable work) { fixture.Queues.post(looper, work); return true; }
}`,
  'android/os/Build.java': `package android.os;
public final class Build { public static final class VERSION { public static final int SDK_INT = 36; } }`,
  'android/webkit/WebView.java': `package android.webkit;
import android.os.Looper;
public class WebView {
  public String page = "https://localhost/";
  public int reads, wrongThreadReads;
  public String getUrl() {
    if (Looper.myLooper() != Looper.getMainLooper()) { wrongThreadReads++; throw new RuntimeException("WEBVIEW_WRONG_THREAD"); }
    reads++; return page;
  }
}`,
  'android/net/Uri.java': `package android.net;
public final class Uri {
  private final java.net.URI value;
  private Uri(String input) { value = java.net.URI.create(input); }
  public static Uri parse(String input) { return new Uri(input); }
  public String getScheme() { return value.getScheme(); }
  public String getHost() { return value.getHost(); }
  public int getPort() { return value.getPort(); }
  public String toString() { return value.toString(); }
}`,
  'android/content/Context.java': `package android.content;
public class Context {
  public final android.content.pm.PackageManager manager = new android.content.pm.PackageManager();
  public Context getApplicationContext() { return this; }
  public java.io.File getFilesDir() { throw new AssertionError("UNEXPECTED_RUNTIME_CONSTRUCTOR"); }
  public android.content.pm.PackageManager getPackageManager() { return manager; }
  public String getPackageName() { return "com.kub.messenger"; }
}`,
  'android/app/Activity.java': `package android.app;
public class Activity extends android.content.Context {
  public static final int RESULT_OK = -1;
  public boolean finishing, destroyed;
  public final java.util.List<android.content.Intent> launches = new java.util.ArrayList<>();
  public boolean isFinishing() { return finishing; }
  public boolean isDestroyed() { return destroyed; }
  public void runOnUiThread(Runnable work) {
    if (android.os.Looper.myLooper() == android.os.Looper.MAIN) work.run();
    else fixture.Queues.post(android.os.Looper.MAIN, work);
  }
  public void startActivity(android.content.Intent intent) {
    fixture.Queues.require(android.os.Looper.MAIN, "SYSTEM_ACTIVITY_NOT_ON_UI"); launches.add(intent);
  }
}`,
  'android/content/ComponentName.java': `package android.content;
public class ComponentName {
  public final String packageName, className;
  public ComponentName(String packageName, String className) { this.packageName = packageName; this.className = className; }
}`,
  'android/content/ClipData.java': `package android.content;
public class ClipData { public static ClipData newRawUri(String label, android.net.Uri uri) { return new ClipData(); } }`,
  'android/content/Intent.java': `package android.content;
public class Intent {
  public static final String ACTION_INSTALL_PACKAGE = "android.intent.action.INSTALL_PACKAGE", EXTRA_RETURN_RESULT = "android.intent.extra.RETURN_RESULT";
  public static final int FLAG_GRANT_READ_URI_PERMISSION = 1;
  public String action, mime; public android.net.Uri data; public ComponentName component; public int flags; public boolean returnResult; public ClipData clip;
  public Intent(String action) { this.action = action; }
  public Intent(String action, android.net.Uri data) { this.action = action; this.data = data; }
  public Intent setDataAndType(android.net.Uri data, String mime) { this.data = data; this.mime = mime; return this; }
  public Intent addFlags(int flags) { this.flags |= flags; return this; }
  public Intent putExtra(String key, boolean value) { returnResult = value; return this; }
  public void setClipData(ClipData clip) { this.clip = clip; }
  public Intent setComponent(ComponentName component) { this.component = component; return this; }
}`,
  'android/content/pm/ApplicationInfo.java': `package android.content.pm;
public class ApplicationInfo { public static final int FLAG_SYSTEM = 1, FLAG_UPDATED_SYSTEM_APP = 128; public int flags; }`,
  'android/content/pm/ActivityInfo.java': `package android.content.pm;
public class ActivityInfo { public ApplicationInfo applicationInfo = new ApplicationInfo(); public String packageName, name; }`,
  'android/content/pm/ResolveInfo.java': `package android.content.pm;
public class ResolveInfo { public ActivityInfo activityInfo = new ActivityInfo(); }`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
public class PackageManager {
  public static final int MATCH_DEFAULT_ONLY = 65536, GET_SIGNING_CERTIFICATES = 0x08000000, GET_SIGNATURES = 0x40;
  public boolean canInstall = true;
  public final java.util.List<ResolveInfo> installers = new java.util.ArrayList<>();
  public boolean canRequestPackageInstalls() { return canInstall; }
  public PackageInfo getPackageInfo(String name, int flags) { throw new AssertionError("UNEXPECTED_PACKAGE_IO"); }
  public PackageInfo getPackageArchiveInfo(String path, int flags) { throw new AssertionError("UNEXPECTED_PACKAGE_IO"); }
  public java.util.List<ResolveInfo> queryIntentActivities(android.content.Intent intent, int flags) { return installers; }
}`,
  'android/provider/Settings.java': `package android.provider;
public final class Settings { public static final String ACTION_MANAGE_UNKNOWN_APP_SOURCES = "android.settings.MANAGE_UNKNOWN_APP_SOURCES"; }`,
  'androidx/activity/result/ActivityResult.java': `package androidx.activity.result;
public class ActivityResult { private final int code; public ActivityResult(int code) { this.code = code; } public int getResultCode() { return code; } }`,
  'androidx/core/content/FileProvider.java': `package androidx.core.content;
public class FileProvider { public static android.net.Uri getUriForFile(android.content.Context context, String authority, java.io.File file) {
  return android.net.Uri.parse("content://" + authority + "/owned/update.apk");
} }`,
  'com/getcapacitor/PluginMethod.java': `package com.getcapacitor; public @interface PluginMethod {}`,
  'com/getcapacitor/annotation/ActivityCallback.java': `package com.getcapacitor.annotation; public @interface ActivityCallback {}`,
  'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor;
public class JSObject extends java.util.HashMap<String,Object> {
  public JSObject put(String key, Object value) { super.put(key, value); return this; }
  public long optLong(String key, long fallback) { Object value = get(key); return value instanceof Number ? ((Number)value).longValue() : fallback; }
}`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public class PluginCall {
  public JSObject result; public String rejection; public int answers;
  private final JSObject data = new JSObject();
  public void resolve(JSObject value) { result = value; answers++; }
  public void reject(String message, String code) { rejection = code; answers++; }
  public JSObject getData() { return data; }
}`,
  'com/getcapacitor/WebViewListener.java': `package com.getcapacitor;
public class WebViewListener { public void onPageStarted(android.webkit.WebView view) {} }`,
  'com/getcapacitor/Bridge.java': `package com.getcapacitor;
public class Bridge {
  public boolean closed;
  public android.app.Activity activity = new android.app.Activity();
  public android.webkit.WebView view = new android.webkit.WebView();
  public final java.util.List<WebViewListener> listeners = new java.util.ArrayList<>();
  public android.app.Activity getActivity() { return activity; }
  public android.content.Context getContext() { return activity; }
  public android.webkit.WebView getWebView() { return view; }
  public void execute(Runnable work) { if (!closed) fixture.Queues.post(android.os.Looper.PLUGINS, work); }
  public void addWebViewListener(WebViewListener listener) { listeners.add(listener); }
  public void removeWebViewListener(WebViewListener listener) { listeners.remove(listener); }
  public void navigate(String page) {
    fixture.Queues.require(android.os.Looper.MAIN, "NAVIGATION_NOT_ON_UI"); view.page = page;
    for (WebViewListener listener : new java.util.ArrayList<>(listeners)) listener.onPageStarted(view);
  }
}`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public class Plugin {
  private Bridge bridge;
  public void setBridge(Bridge bridge) { this.bridge = bridge; }
  public Bridge getBridge() { return bridge; }
  public android.app.Activity getActivity() { return bridge == null ? null : bridge.getActivity(); }
  public android.content.Context getContext() { return bridge.getContext(); }
  public void load() {} protected void handleOnDestroy() {}
  public void startActivityForResult(PluginCall call, android.content.Intent intent, String callback) { getActivity().startActivity(intent); }
}`,
  'com/kub/messenger/AndroidUpdateRuntime.java': `package com.kub.messenger;
import java.util.function.*;
import com.getcapacitor.*;
public class AndroidUpdateRuntime {
  public static final AndroidUpdateRuntime INSTANCE = new AndroidUpdateRuntime();
  public String phase = "idle";
  public int gets, statuses, checks, starts, cancels, preparations, handoffs, returned;
  public Consumer<Runnable> preparation = Runnable::run;
  public static AndroidUpdateRuntime get(android.content.Context context) {
    fixture.Queues.require(android.os.Looper.PLUGINS, "RUNTIME_GET_MOVED_ON_UI"); INSTANCE.gets++; return INSTANCE;
  }
  public JSObject status() { if(android.os.Looper.myLooper() == android.os.Looper.MAIN) throw new AssertionError("RUNTIME_STATUS_MOVED_ON_UI"); statuses++; return new JSObject().put("phase", phase); }
  public void begin(boolean download, Consumer<JSObject> ignored) { fixture.Queues.require(android.os.Looper.PLUGINS, "RUNTIME_BEGIN_MOVED_ON_UI"); if(download) starts++; else checks++; }
  public JSObject cancel() { fixture.Queues.require(android.os.Looper.PLUGINS, "RUNTIME_CANCEL_MOVED_ON_UI"); cancels++; return new JSObject().put("phase", "idle"); }
  public void prepareInstall(BiConsumer<java.io.File, Long> accepted, Consumer<JSObject> refused) {
    fixture.Queues.require(android.os.Looper.PLUGINS, "RUNTIME_PREPARE_MOVED_ON_UI"); preparations++;
    preparation.accept(() -> fixture.Queues.post(android.os.Looper.IO, () -> { phase = "installing"; accepted.accept(new java.io.File("owned-update.apk"), 7L); }));
  }
  public boolean handoff(long owner, Runnable launch) { fixture.Queues.require(android.os.Looper.MAIN, "INSTALL_HANDOFF_NOT_ON_UI"); if(owner != 7) throw new AssertionError("INSTALL_OWNER_CHANGED"); handoffs++; launch.run(); return true; }
  public void installerReturned(long owner, String failure) {
    if(android.os.Looper.myLooper() == android.os.Looper.MAIN) throw new AssertionError("INSTALL_RETURN_NOT_ON_WORKER");
    returned++; if(owner == 7 && phase.equals("installing")) phase = "ready";
  }
  public void finishInstaller(long owner, String failure, Consumer<JSObject> completed) {
    fixture.Queues.post(android.os.Looper.IO, () -> { installerReturned(owner, failure); completed.accept(status()); });
  }
}`,
};
