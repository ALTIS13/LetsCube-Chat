// Labeled JVM Android lifecycle doubles; not the shipped Capacitor MainActivity or SDK proof.
export const androidStubs = {
  "android/os/Bundle.java": "package android.os; public final class Bundle {}",
  "android/os/Looper.java": `package android.os;
public final class Looper {
  private static final Looper MAIN=new Looper();
  private static final Thread OWNER=Thread.currentThread();
  public static Looper getMainLooper(){return MAIN;}
  public static Looper myLooper(){return Thread.currentThread()==OWNER?MAIN:null;}
}`,
  "android/os/Process.java": `package android.os;
public final class Process {public static int uid=10123; public static int myUid(){return uid;}}`,
  "android/content/pm/ApplicationInfo.java": `package android.content.pm;
public final class ApplicationInfo {public int uid=10123;}`,
  "android/content/Context.java": `package android.content;
public abstract class Context {
  public abstract Context getApplicationContext();
  public abstract android.content.pm.ApplicationInfo getApplicationInfo();
}`,
  "android/app/Activity.java": `package android.app;
public class Activity {
  public final Application application;
  public Activity(Application app){application=app;}
  public Application getApplication(){application.checkRead();return application;}
}`,
  "android/app/Application.java": `package android.app;
import android.content.*; import android.content.pm.*; import android.os.*; import java.util.*;
public class Application extends Context {
  public final ApplicationInfo info=new ApplicationInfo(); public Context context=this;
  public final List<ActivityLifecycleCallbacks> callbacks=new ArrayList<>();
  public boolean failRegister,failDetach,forbidReads; public int registers,detaches,reads;
  public ActivityLifecycleCallbacks last;
  public Runnable duringRegister;
  public Runnable duringRead;
  public void checkRead(){
    if(forbidReads)throw new AssertionError("SNAPSHOT_MUST_BE_MEMORY_ONLY");
    if(last!=null&&Thread.holdsLock(last))throw new AssertionError("CONTEXT_READ_OUTSIDE_AUTHORITY_LOCK");
    reads++;if(duringRead!=null)duringRead.run();
  }
  public Context getApplicationContext(){checkRead();return context;}
  public ApplicationInfo getApplicationInfo(){checkRead();return info;}
  private void main(){if(Looper.myLooper()!=Looper.getMainLooper())throw new AssertionError("FIXTURE_MAIN_CALLBACKS");}
  public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback){
    main();registers++;last=callback;callbacks.add(callback);
    if(duringRegister!=null)duringRegister.run();
    if(failRegister)throw new IllegalStateException("FICTIONAL_REGISTER_FAILURE");
  }
  public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback){
    main();detaches++;
    if(callback!=last)throw new AssertionError("EXACT_OWNED_CALLBACK");
    if(failDetach)throw new IllegalStateException("FICTIONAL_DETACH_FAILURE");
    callbacks.remove(callback);
  }
  public void resume(Activity activity){main();for(ActivityLifecycleCallbacks c:new ArrayList<>(callbacks))c.onActivityResumed(activity);}
  public void pause(Activity activity){main();for(ActivityLifecycleCallbacks c:new ArrayList<>(callbacks))c.onActivityPaused(activity);}
  public void stop(Activity activity){main();for(ActivityLifecycleCallbacks c:new ArrayList<>(callbacks))c.onActivityStopped(activity);}
  public void destroy(Activity activity){main();for(ActivityLifecycleCallbacks c:new ArrayList<>(callbacks))c.onActivityDestroyed(activity);}
  public interface ActivityLifecycleCallbacks {
    default void onActivityPrePaused(Activity a){}default void onActivityPreStopped(Activity a){}default void onActivityPreDestroyed(Activity a){}
    void onActivityCreated(Activity a,Bundle b);void onActivityStarted(Activity a);void onActivityResumed(Activity a);
    void onActivityPaused(Activity a);void onActivityStopped(Activity a);void onActivityDestroyed(Activity a);
    void onActivitySaveInstanceState(Activity a,Bundle b);
  }
}`,
  "com/kub/messenger/MainActivity.java": `package com.kub.messenger;
// Type-only fixture. Does NOT run shipped BridgeActivity, UI, plugins or Android lifecycle.
public class MainActivity extends android.app.Activity {public MainActivity(android.app.Application app){super(app);}}`,
};
