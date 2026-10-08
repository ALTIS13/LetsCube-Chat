// Only platform JSON decoding, SDK and Capacitor I/O are fictional. Production
// state, DTO validation, transport bounds and plugin methods compile unchanged.
export const messagePreviewStubs = {
  "android/os/SystemClock.java": `package android.os; public class SystemClock { public static long elapsedRealtime(){return System.nanoTime()/1000000;} }`,
  "android/util/Base64.java": `package android.util; public class Base64 {
    public static final int URL_SAFE=8,NO_WRAP=2,NO_PADDING=1;
    public static byte[] decode(String s,int flags){return java.util.Base64.getUrlDecoder().decode(s);}
    public static String encodeToString(byte[] b,int flags){return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b);} }`,
  "org/json/JSONObject.java": `package org.json; import java.util.*; public class JSONObject {
    public static final Object NULL=new Object(); private final Map<String,Object> values=new HashMap<>();
    public JSONObject(){} public JSONObject(Map<String,Object> v){values.putAll(v);}
    public JSONObject put(String k,Object v){values.put(k,v);return this;} public Object opt(String k){return values.get(k);}
    public Object remove(String k){return values.remove(k);} public boolean has(String k){return values.containsKey(k);}
    public int length(){return values.size();} public Iterator<String> keys(){return values.keySet().iterator();} }`,
  "org/json/JSONArray.java": `package org.json; public class JSONArray {
    private final Object[] values; public JSONArray(Object... values){this.values=values;}
    public int length(){return values.length;} public Object opt(int index){return values[index];} }`,
  "org/json/JSONTokener.java": `package org.json; import java.util.*; public class JSONTokener {
    private static final Map<String,Object> fixtures=new HashMap<>(); private final String text;
    public static void fixture(String text,Object value){fixtures.put(text,value);} public JSONTokener(String text){this.text=text;}
    public Object nextValue(){if(!fixtures.containsKey(text))throw new IllegalArgumentException("fictional decoder refusal");return fixtures.get(text);}
    public char nextClean(){return 0;} }`,
  "com/getcapacitor/JSObject.java": `package com.getcapacitor; public class JSObject extends org.json.JSONObject {
    @Override public JSObject put(String k,Object v){super.put(k,v);return this;} }`,
  "com/getcapacitor/CapConfig.java": `package com.getcapacitor; public class CapConfig { public boolean enabled; public boolean isLoggingEnabled(){return enabled;} }`,
  "com/getcapacitor/Bridge.java": `package com.getcapacitor; public class Bridge { private final CapConfig config=new CapConfig(); public CapConfig getConfig(){return config;} }`,
  "com/getcapacitor/Plugin.java": `package com.getcapacitor; public class Plugin { private final Bridge bridge=new Bridge(); public Bridge getBridge(){return bridge;} public void load(){} protected void handleOnDestroy(){} }`,
  "com/getcapacitor/PluginCall.java": `package com.getcapacitor; public class PluginCall {
    private final JSObject data; public volatile JSObject result; public final java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);
    public PluginCall(JSObject data){this.data=data;} public JSObject getData(){return data;}
    public String getString(String k){Object v=data.opt(k);return v instanceof String?(String)v:null;}
    public void resolve(JSObject value){result=value;done.countDown();} }`,
  "com/getcapacitor/PluginMethod.java": `package com.getcapacitor; public @interface PluginMethod {}`,
  "com/getcapacitor/annotation/CapacitorPlugin.java": `package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }`,
  "com/google/android/gms/tasks/Task.java": `package com.google.android.gms.tasks; public class Task<T> { public T value; public Task(T v){value=v;} }`,
  "com/google/android/gms/tasks/Tasks.java": `package com.google.android.gms.tasks; public class Tasks { public static <T>T await(Task<T> task,long timeout,java.util.concurrent.TimeUnit unit){return task.value;} }`,
  "com/google/firebase/messaging/FirebaseMessaging.java": `package com.google.firebase.messaging; import com.google.android.gms.tasks.Task;
    public class FirebaseMessaging { public static FirebaseMessaging getInstance(){return new FirebaseMessaging();} public Task<String> getToken(){return new Task<>("fictional-own-sdk-token");} }`,
};
