// Only Android/Capacitor/Firebase I/O is fictional. The producer, plugin,
// payload parser and cleanup/lease contract are compiled unchanged.
export const nativeChatStubs = {
  "android/Manifest.java": `package android; public class Manifest { public static class permission { public static final String POST_NOTIFICATIONS="post"; } }`,
  "android/content/pm/PackageManager.java": `package android.content.pm; public class PackageManager { public static final int PERMISSION_GRANTED=0; }`,
  "android/os/Build.java": `package android.os; public class Build { public static class VERSION { public static int SDK_INT=34; } }`,
  "android/os/Bundle.java": `package android.os; import java.util.HashMap; public class Bundle extends HashMap<String,Object> {
    public void putInt(String k,int v){put(k,v);} public void putString(String k,String v){put(k,v);}
    public void putLong(String k,long v){put(k,v);} public long getLong(String k,long fallback){Object v=get(k);return v instanceof Long?(Long)v:fallback;}
    public int getInt(String k,int fallback){Object v=get(k);return v instanceof Integer?(Integer)v:fallback;}
    public String getString(String k){Object v=get(k);return v instanceof String?(String)v:null;} }`,
  "android/net/Uri.java": `package android.net; public class Uri { private final String value; private Uri(String s){value=s;} public static Uri parse(String s){return new Uri(s);} public String toString(){return value;} }`,
  "android/content/Context.java": `package android.content; import android.app.NotificationManager; public class Context {
    public static final int MODE_PRIVATE=0; public static FictionalPreferences preferences=new FictionalPreferences();
    public Context getApplicationContext(){return this;} public SharedPreferences getSharedPreferences(String name,int mode){return preferences;}
    public static NotificationManager manager=new NotificationManager();
    public <T> T getSystemService(Class<T> c){return c.cast(manager);} public String getPackageName(){return "com.kub.messenger";}
    public int checkSelfPermission(String s){return 0;} }`,
  "android/content/SharedPreferences.java": `package android.content; public interface SharedPreferences {
    String getString(String key,String fallback); long getLong(String key,long fallback); Editor edit();
    interface Editor { Editor putString(String key,String value); Editor putLong(String key,long value); boolean commit(); } }`,
  "android/content/FictionalPreferences.java": `package android.content; import java.util.*; public class FictionalPreferences implements SharedPreferences {
    private final Map<String,Object> disk=new HashMap<>(); private final Map<String,Object> memory=new HashMap<>(); public boolean failNextCommit,failReads;
    public String getString(String k,String fallback){if(failReads)throw new IllegalStateException("fictional read failure");Object v=memory.get(k);return v==null?fallback:(String)v;}
    public long getLong(String k,long fallback){if(failReads)throw new IllegalStateException("fictional read failure");Object v=memory.get(k);return v==null?fallback:(Long)v;}
    public void restore(){memory.clear();memory.putAll(disk);} public Editor edit(){return new Editor(){
      final Map<String,Object> changes=new HashMap<>(); public Editor putString(String k,String v){changes.put(k,v);return this;}
      public Editor putLong(String k,long v){changes.put(k,v);return this;}
      public boolean commit(){memory.putAll(changes);if(failNextCommit){failNextCommit=false;return false;}disk.putAll(changes);return true;}
    };} }`,
  "android/content/Intent.java": `package android.content; import android.net.Uri; public class Intent {
    public static final int FLAG_ACTIVITY_CLEAR_TOP=1,FLAG_ACTIVITY_SINGLE_TOP=2;
    public Uri data; public String action; public java.util.Map<String,String> extras=new java.util.HashMap<>();
    public Intent(Context c,Class<?> type){} public Intent setAction(String s){action=s;return this;} public Intent setData(Uri u){data=u;return this;}
    public Intent addFlags(int f){return this;} public Intent putExtra(String k,String v){extras.put(k,v);return this;} }`,
  "android/media/AudioAttributes.java": `package android.media; public class AudioAttributes {
    public static final int USAGE_NOTIFICATION=1,CONTENT_TYPE_SONIFICATION=1;
    public static class Builder { public Builder setUsage(int i){return this;} public Builder setContentType(int i){return this;}
    public AudioAttributes build(){return new AudioAttributes();} } }`,
  "android/app/PendingIntent.java": `package android.app; import android.content.*; public class PendingIntent {
    public static final int FLAG_IMMUTABLE=1,FLAG_UPDATE_CURRENT=2;
    private static final java.util.Map<String,PendingIntent> registry=new java.util.HashMap<>();
    public String target; public java.util.Map<String,String> data;
    public static synchronized PendingIntent getActivity(Context c,int n,Intent i,int f){
      String key=n+":"+i.action+":"+i.data; PendingIntent p=registry.get(key);
      if(p==null){p=new PendingIntent();p.target=i.data.toString();p.data=new java.util.HashMap<>(i.extras);registry.put(key,p);}
      else if((f&FLAG_UPDATE_CURRENT)!=0)p.data=new java.util.HashMap<>(i.extras);
      return p;
    } }`,
  "android/app/Notification.java": `package android.app; import android.content.Context; import android.os.Bundle;
    public class Notification { public static final int VISIBILITY_PRIVATE=0,FLAG_GROUP_SUMMARY=512; public static final String CATEGORY_MESSAGE="msg";
    public Bundle extras=new Bundle(); public int flags; public String title,body; public PendingIntent contentIntent;
    public static class BigTextStyle { public BigTextStyle bigText(String s){return this;} }
    public static class Builder { private final Notification n=new Notification();
    public Builder(Context c){} public Builder(Context c,String channel){}
    public Builder setSmallIcon(int i){return this;} public Builder setContentTitle(String s){n.title=s;return this;}
    public Builder setContentText(String s){n.body=s;return this;} public Builder setStyle(BigTextStyle s){return this;}
    public Builder setCategory(String s){return this;} public Builder setVisibility(int i){return this;}
    public Builder setContentIntent(PendingIntent p){n.contentIntent=p;return this;} public Builder setAutoCancel(boolean b){return this;}
    public Builder addExtras(Bundle b){n.extras.putAll(b);return this;} public Notification build(){return n;} } }`,
  "android/app/NotificationChannel.java": `package android.app; import android.net.Uri; import android.media.AudioAttributes;
    public class NotificationChannel { private final String id; public NotificationChannel(String i,String n,int importance){id=i;}
    public String getId(){return id;} public int getImportance(){return 3;} public void setLockscreenVisibility(int i){} public void setSound(Uri u,AudioAttributes a){} }`,
  "android/service/notification/StatusBarNotification.java": `package android.service.notification; import android.app.Notification;
    public class StatusBarNotification { private final String tag; private final int id; private final Notification n;
    public StatusBarNotification(String t,int i,Notification n){tag=t;id=i;this.n=n;} public String getTag(){return tag;}
    public int getId(){return id;} public Notification getNotification(){return n;} }`,
  "android/app/NotificationManager.java": `package android.app; import java.util.*; import android.service.notification.StatusBarNotification;
    public class NotificationManager { public static final int IMPORTANCE_DEFAULT=3,IMPORTANCE_NONE=0;
    public final Map<String,StatusBarNotification> cards=new HashMap<>(); public int cancels;
    public boolean areNotificationsEnabled(){return true;} public NotificationChannel getNotificationChannel(String s){return new NotificationChannel(s,s,3);}
    public void createNotificationChannel(NotificationChannel c){} public synchronized void notify(String t,int id,Notification n){cards.put(t+":"+id,new StatusBarNotification(t,id,n));}
    public synchronized void cancel(String t,int id){cards.remove(t+":"+id);cancels++;}
    public synchronized StatusBarNotification[] getActiveNotifications(){return cards.values().toArray(new StatusBarNotification[0]);} }`,
  "com/google/firebase/messaging/RemoteMessage.java": `package com.google.firebase.messaging; import java.util.Map; public class RemoteMessage {
    private final Map<String,String> data; public RemoteMessage(Map<String,String> d){data=d;}
    public Map<String,String> getData(){return data;} public String getMessageId(){return "fictional-fcm";} }`,
  "com/kub/messenger/MainActivity.java": `package com.kub.messenger; public class MainActivity {}`,
  "com/kub/messenger/R.java": `package com.kub.messenger; public class R { public static class drawable { public static final int ic_stat_message=1; } }`,
  "com/kub/messenger/VoiceCallRuntime.java": `package com.kub.messenger; public class VoiceCallRuntime { public static boolean isResumed(){return false;} }`,
  "org/json/JSONObject.java": `package org.json; import java.util.*; public class JSONObject {
    public static final Object NULL=new Object(); protected final Map<String,Object> values=new HashMap<>();
    public JSONObject put(String k,Object v){values.put(k,v);return this;} public Object opt(String k){return values.get(k);}
    public String getString(String k){Object v=values.get(k);if(!(v instanceof String))throw new IllegalArgumentException();return (String)v;} }`,
  "com/getcapacitor/JSObject.java": `package com.getcapacitor; public class JSObject extends org.json.JSONObject {
    @Override public JSObject put(String k,Object v){super.put(k,v);return this;} }`,
  "com/getcapacitor/JSArray.java": `package com.getcapacitor; import java.util.*; import org.json.JSONObject;
    public class JSArray extends ArrayList<JSONObject> { public int length(){return size();} public JSONObject getJSONObject(int i){return get(i);} }`,
  "com/getcapacitor/Plugin.java": `package com.getcapacitor; public class Plugin {
    public void load(){} protected void handleOnDestroy(){} public android.content.Context getContext(){return new android.content.Context();} }`,
  "com/getcapacitor/PluginCall.java": `package com.getcapacitor; public class PluginCall {
    private final JSObject data; public JSObject result; public String error;
    public PluginCall(JSObject d){data=d;} public JSObject getData(){return data;}
    public String getString(String k){Object v=data.opt(k);return v instanceof String?(String)v:null;}
    public JSArray getArray(String k){Object v=data.opt(k);return v instanceof JSArray?(JSArray)v:null;}
    public void resolve(JSObject r){result=r;} public void reject(String text,String code){error=code;} }`,
  "com/getcapacitor/PluginMethod.java": `package com.getcapacitor; public @interface PluginMethod {}`,
  "com/getcapacitor/annotation/CapacitorPlugin.java": `package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }`,
};
