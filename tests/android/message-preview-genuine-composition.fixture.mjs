import { producerStubs, producerPlatform } from './message-preview-verification-producer.fixture.mjs';

// Reuse the accepted fictional Android/SDK/JSON ports for the initial reflection
// RED. No holder, issuer, verifier or authority is substituted here.
export const compositionStubs = { ...producerStubs };
export const compositionPlatform = producerPlatform;

export const compositionSourceNames = [
  'MessagePreviewVerificationState', 'MessagePreviewVaultFence', 'MessagePreviewMetadataEnvelope',
  'MessagePreviewJournalIO', 'MessagePreviewInstallationMarker', 'MessagePreviewInitializationGate',
  'MessagePreviewOwnedKeyInventory', 'MessagePreviewKeystoreReader', 'MessagePreviewAtomicBackend',
  'MessagePreviewCredentialEnvelope', 'MessagePreviewCredentialKeyCustody', 'MessagePreviewPristineInitializer',
  'MessagePreviewVaultProvisioning', 'MessagePreviewVerificationRuntime', 'MessagePreviewResponseParser',
  'MessagePreviewHttpTransport', 'MessagePreviewsPlugin', 'MessagePreviewVerificationProducer',
];

export const foregroundCompositionSourceNames = [
  ...compositionSourceNames, 'MessagePreviewForegroundAuthority',
  'MessagePreviewForegroundComposition', 'MainActivity',
];

// Fictional framework queues are deliberately separate: bridge task execution
// never grants main authority. The holder must post each main-only admission.
export const foregroundCompositionStubs = {
  ...compositionStubs,
  'android/os/Bundle.java': 'package android.os; public final class Bundle {}',
  'android/os/Handler.java': `package android.os;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
public final class Handler {
  public static final LinkedBlockingQueue<Runnable> mainQueue=new LinkedBlockingQueue<Runnable>();
  private static final java.util.List<Delayed> delayed=new java.util.ArrayList<Delayed>();
  private static final class Delayed {
    final Runnable work; final long due;
    Delayed(Runnable work,long due) { this.work=work; this.due=due; }
  }
  private final Looper looper;
  public Handler(Looper looper) { this.looper=looper; }
  public boolean post(Runnable work) {
    if(looper!=Looper.getMainLooper()) throw new AssertionError("ONLY_FICTIONAL_MAIN_HANDLER");
    return mainQueue.offer(work);
  }
  public boolean postDelayed(Runnable work,long delay) {
    synchronized(delayed) { delayed.add(new Delayed(work,SystemClock.elapsedRealtime()+delay)); }
    return true;
  }
  public void removeCallbacks(Runnable work) {
    mainQueue.remove(work); synchronized(delayed) { delayed.removeIf(entry -> entry.work==work); }
  }
  public static void runDue() {
    synchronized(delayed) {
      java.util.Iterator<Delayed> entries=delayed.iterator();
      while(entries.hasNext()) { Delayed entry=entries.next(); if(entry.due<=SystemClock.elapsedRealtime()) { mainQueue.offer(entry.work); entries.remove(); } }
    }
  }
  public static Runnable take(long millis) throws InterruptedException { return mainQueue.poll(millis,TimeUnit.MILLISECONDS); }
}`,
  'android/app/Application.java': `package android.app;
import android.content.Context;
import android.os.Bundle;
import android.os.Looper;
import java.util.ArrayList;
import java.util.List;
public abstract class Application extends Context {
  public final List<ActivityLifecycleCallbacks> callbacks=new ArrayList<ActivityLifecycleCallbacks>();
  public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {
    main(); callbacks.add(callback);
  }
  public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) {
    main(); callbacks.remove(callback);
  }
  private void main() { if(Looper.myLooper()!=Looper.getMainLooper()) throw new AssertionError("FICTIONAL_CALLBACK_MAIN"); }
  public void resume(Activity activity) { main(); for(ActivityLifecycleCallbacks c:new ArrayList<ActivityLifecycleCallbacks>(callbacks)) c.onActivityResumed(activity); }
  public void pause(Activity activity) { main(); for(ActivityLifecycleCallbacks c:new ArrayList<ActivityLifecycleCallbacks>(callbacks)) { c.onActivityPrePaused(activity); c.onActivityPaused(activity); } }
  public void destroy(Activity activity) { main(); for(ActivityLifecycleCallbacks c:new ArrayList<ActivityLifecycleCallbacks>(callbacks)) { c.onActivityPreDestroyed(activity); c.onActivityDestroyed(activity); } }
  public interface ActivityLifecycleCallbacks {
    default void onActivityPrePaused(Activity a) {} default void onActivityPreStopped(Activity a) {} default void onActivityPreDestroyed(Activity a) {}
    void onActivityCreated(Activity a,Bundle state); void onActivityStarted(Activity a); void onActivityResumed(Activity a);
    void onActivityPaused(Activity a); void onActivityStopped(Activity a); void onActivityDestroyed(Activity a);
    void onActivitySaveInstanceState(Activity a,Bundle state);
  }
}`,
  'android/app/Activity.java': `package android.app;
public class Activity extends android.content.Context {
  public Application application;
  private android.content.Intent intent=new android.content.Intent();
  public Application getApplication() { return application; }
  public android.content.Context getApplicationContext() { return application.getApplicationContext(); }
  public android.content.pm.ApplicationInfo getApplicationInfo() { return application.getApplicationInfo(); }
  public boolean isDeviceProtectedStorage() { return application.isDeviceProtectedStorage(); }
  public java.io.File getNoBackupFilesDir() { return application.getNoBackupFilesDir(); }
  public Object getSystemService(String name) { return application.getSystemService(name); }
  public <T> T getSystemService(Class<T> type) { return application.getSystemService(type); }
  public android.content.Intent getIntent() { return intent; }
  public void setIntent(android.content.Intent value) { intent=value; }
  public android.content.res.Resources getResources() { return new android.content.res.Resources(); }
  public void onCreate(android.os.Bundle state) {}
  public void onResume() { application.resume(this); }
  public void onPause() { application.pause(this); }
  public void onDestroy() { application.destroy(this); }
  protected void onNewIntent(android.content.Intent value) { intent=value; }
  public void onConfigurationChanged(android.content.res.Configuration config) {}
}`,
  'android/content/Intent.java': `package android.content; public class Intent {
  public static final String ACTION_MAIN="android.intent.action.MAIN";
  public Intent() {} public Intent(Object context,Class<?> type) {} public Intent setAction(String action) { return this; }
}`,
  'android/content/res/Configuration.java': `package android.content.res; public class Configuration {
  public static final int UI_MODE_NIGHT_MASK=48, UI_MODE_NIGHT_YES=32; public int uiMode=16;
}`,
  'android/content/res/Resources.java': `package android.content.res; public class Resources {
  public Configuration getConfiguration() { return new Configuration(); }
}`,
  'android/webkit/WebSettings.java': `package android.webkit; public class WebSettings {
  private String agent="fictional-ui-port"; public String getUserAgentString() { return agent; }
  public void setUserAgentString(String value) { agent=value; }
}`,
  'android/webkit/WebView.java': `package android.webkit; public class WebView {
  public WebSettings getSettings() { return new WebSettings(); }
  public boolean postDelayed(Runnable work,long delay) { return true; }
  public void evaluateJavascript(String script,Object callback) {}
}`,
  'androidx/webkit/WebViewFeature.java': `package androidx.webkit; public final class WebViewFeature {
  public static final String ALGORITHMIC_DARKENING="fictional-ui-port";
  public static boolean isFeatureSupported(String feature) { return false; }
}`,
  'androidx/webkit/WebSettingsCompat.java': `package androidx.webkit; public final class WebSettingsCompat {
  public static void setAlgorithmicDarkeningAllowed(android.webkit.WebSettings settings,boolean value) {}
}`,
  'com/getcapacitor/Bridge.java': `package com.getcapacitor;
public class Bridge {
  private final CapConfig config=new CapConfig();
  public final java.util.List<WebViewListener> listeners=new java.util.ArrayList<WebViewListener>();
  private boolean iteratingListeners;
  public android.app.Activity activity;
  public Bridge() {} public Bridge(android.app.Activity activity) { this.activity=activity; }
  public CapConfig getConfig() { return config; }
  public android.app.Activity getActivity() { return activity; }
  public android.content.Context getContext() { return activity; }
  public android.webkit.WebView getWebView() { return null; }
  public void addWebViewListener(WebViewListener listener) { listeners.add(listener); }
  public void removeWebViewListener(WebViewListener listener) {
    if(iteratingListeners) throw new AssertionError("LISTENER_REMOVE_AFTER_ITERATION");
    listeners.remove(listener);
  }
  public void reset() { /* Real SDK reset has no Plugin destruction/reset callback. */ }
  public void reload() {
    if(android.os.Looper.myLooper()!=android.os.Looper.getMainLooper()) throw new AssertionError("RELOAD_CALLBACK_MAIN");
    reset(); iteratingListeners=true;
    try { for(WebViewListener listener:listeners) listener.onPageStarted(new android.webkit.WebView()); }
    finally { iteratingListeners=false; }
  }
  public void executeOnMainThread(Runnable work) { new android.os.Handler(android.os.Looper.getMainLooper()).post(work); }
  public void execute(Runnable work) { task(work); }
  public static void task(Runnable work) {
    final Throwable[] failure=new Throwable[1];
    Thread thread=new Thread(() -> { try { work.run(); } catch(Throwable error) { failure[0]=error; } },"fictional-capacitor-task");
    thread.start(); try { thread.join(3000); } catch(InterruptedException error) { throw new AssertionError("FINITE_TASK_JOIN"); }
    if(thread.isAlive()) throw new AssertionError("FINITE_TASK_JOIN");
    if(failure[0]!=null) throw new AssertionError("FICTIONAL_TASK_FAILURE",failure[0]);
  }
}`,
  'com/getcapacitor/WebViewListener.java': `package com.getcapacitor; public abstract class WebViewListener {
  public void onPageStarted(android.webkit.WebView view) {}
}`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor; public class Plugin {
  private Bridge bridge=new Bridge(); public Bridge getBridge() { return bridge; }
  public void setBridge(Bridge value) { bridge=value; }
  public android.app.Activity getActivity() { return bridge.getActivity(); }
  public android.content.Context getContext() { return bridge.getContext(); }
  public void load() {} protected void handleOnDestroy() {}
}`,
  'com/getcapacitor/BridgeActivity.java': `package com.getcapacitor; public class BridgeActivity extends android.app.Activity {
  public Bridge bridge; public Bridge getBridge() { return bridge; }
  public void registerPlugin(Class<?> plugin) {}
}`,
  'com/kub/messenger/BuildConfig.java': `package com.kub.messenger; public final class BuildConfig {
  // Mutable only in this child-JVM fictional build configuration.
  public static boolean LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION=false;
}`,
  'com/kub/messenger/VoiceCallRuntime.java': `package com.kub.messenger; final class VoiceCallRuntime {
  static VoiceCallRuntime get(Object activity) { return new VoiceCallRuntime(); }
  static boolean isVoiceIntent(android.content.Intent intent) { return false; }
  void captureIntent(android.content.Intent intent) {} void setResumed(boolean value) {}
}`,
  ...Object.fromEntries(['VoiceCallsPlugin', 'MediaExportPlugin', 'ChatNotificationsPlugin'].map(name =>
    [`com/kub/messenger/${name}.java`, `package com.kub.messenger; public final class ${name} extends com.getcapacitor.Plugin {}`])),
};
