package com.kub.messenger;

import android.content.Context;
import android.content.pm.*;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;
import sun.misc.Unsafe;

public final class AndroidUpdateCatalogRecoveryProbe {
    private static void check(boolean ok, String reason) { if (!ok) throw new AssertionError(reason); }
    private static Field field(String name) throws Exception { Field f=AndroidUpdateRuntime.class.getDeclaredField(name);f.setAccessible(true);return f; }
    public static void main(String[] args) throws Exception {
        String scenario=args[0];
        byte[] data={1,2,3},cert=Base64.getDecoder().decode(Files.readString(Path.of(args[1])).trim());
        String hash=AndroidUpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(data));
        int freshBuild=scenario.equals("unchanged")?45:scenario.equals("withdrawn")?44:46;
        String freshVersion=freshBuild==45?"0.1.44":freshBuild==44?"0.1.43":"0.1.45";
        JSONObject fresh=new JSONObject().put("schemaVersion",1).put("platform","android").put("channel","stable").put("available",true)
            .put("version",freshVersion).put("build",freshBuild).put("artifact",new JSONObject().put("size",3).put("sha256",hash)
            .put("url",scenario.equals("invalid-source")?"https://foreign.invalid/update.apk":"https://api.letscube.ru/releases/files/android/"+freshVersion+"/letscube-"+freshVersion+".apk"));
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        URL.setURLStreamHandlerFactory(protocol->protocol.equals("https")?new URLStreamHandler(){
            @Override protected URLConnection openConnection(URL url){return new HttpsURLConnection(url){
                @Override public int getResponseCode(){return scenario.equals("network")?503:200;}
                @Override public InputStream getInputStream() throws IOException {
                    entered.countDown();
                    if(scenario.equals("superseded")||scenario.equals("cancelled"))try{check(release.await(2,TimeUnit.SECONDS),"CATALOG_CONTROL_TIMEOUT");}catch(InterruptedException e){throw new IOException(e);}
                    return new ByteArrayInputStream(fresh.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
                @Override public void disconnect(){} @Override public boolean usingProxy(){return false;} @Override public void connect(){}
                @Override public String getCipherSuite(){return "fixture";} @Override public Certificate[] getLocalCertificates(){return null;}
                @Override public Certificate[] getServerCertificates(){return null;}
            };}
        }:null);
        Signature signature=new Signature(cert);
        PackageManager pm=new PackageManager(){
            private PackageInfo info(int build){PackageInfo p=new PackageInfo();p.packageName="com.kub.messenger";p.versionName=build==44?"0.1.43":"0.1.44";p.versionCode=build;p.signingInfo=new SigningInfo(new Signature[]{signature});p.signatures=new Signature[]{signature};return p;}
            @Override public PackageInfo getPackageInfo(String name,int flags){return info(44);}
            @Override public PackageInfo getPackageArchiveInfo(String path,int flags){return info(45);}
        };
        Context context=new Context(){@Override public PackageManager getPackageManager(){return pm;}};
        Path directory=Files.createTempDirectory("android-catalog-recovery-");
        Path ready=directory.resolve("update.apk"),partial=directory.resolve("download.part"),record=directory.resolve("state.json");
        ExecutorService worker=Executors.newSingleThreadExecutor(r->new Thread(r,"runtime-owned-worker"));
        try{
            if(scenario.equals("delete-refused")){Files.createDirectory(ready);Files.write(ready.resolve("child"),data);}else Files.write(ready,data);
            Files.write(partial,new byte[]{9});
            Field unsafe=Unsafe.class.getDeclaredField("theUnsafe");unsafe.setAccessible(true);
            AndroidUpdateRuntime runtime=(AndroidUpdateRuntime)((Unsafe)unsafe.get(null)).allocateInstance(AndroidUpdateRuntime.class);
            field("context").set(runtime,context);field("worker").set(runtime,worker);field("ready").set(runtime,ready.toFile());field("partial").set(runtime,partial.toFile());field("record").set(runtime,new AtomicFile(record.toFile()));
            field("release").set(runtime,new AndroidUpdatePolicy.Release("0.1.44",45,3,hash,"https://api.letscube.ru/releases/files/android/0.1.44/letscube-0.1.44.apk"));
            field("phase").set(runtime,"ready");field("bytes").setLong(runtime,3);field("generation").setLong(runtime,7);
            CompletableFuture<JSObject> completed=new CompletableFuture<>();boolean[] accepted={false};
            runtime.prepareInstall((file,owner)->{accepted[0]=true;completed.complete(runtime.status());},completed::complete);
            if(scenario.equals("superseded")||scenario.equals("cancelled")){
                check(entered.await(2,TimeUnit.SECONDS),"CATALOG_NOT_REACHED");
                if(scenario.equals("cancelled"))runtime.cancel();
                else synchronized(runtime){field("generation").setLong(runtime,8);field("phase").set(runtime,"checking");Files.write(ready,new byte[]{8,8});}
                release.countDown();
            }
            JSObject result=completed.get(3,TimeUnit.SECONDS);String phase=(String)result.get("phase");Object error=result.get("error");
            if(scenario.equals("stale")){
                check(!accepted[0]&&phase.equals("available")&&"STALE_RELEASE".equals(error),"STALE_READY_TRAPS_OLD_INSTALL");
                check("0.1.45".equals(result.get("version"))&&((Number)result.get("bytes")).longValue()==0,"FRESH_CATALOG_NOT_ADOPTED");
                check(!Files.exists(ready)&&!Files.exists(partial),"OBSOLETE_ARTIFACT_RETAINED");
                JSONObject persisted=new JSONObject(Files.readString(record));check(persisted.getString("phase").equals("available")&&persisted.getJSONObject("release").getInt("build")==46,"FRESH_STATE_NOT_DURABLE");
            }else if(scenario.equals("withdrawn")){
                check(!accepted[0]&&phase.equals("current")&&result.get("version")==JSONObject.NULL,"WITHDRAWN_RELEASE_STILL_OFFERED");
                check(!Files.exists(ready)&&!Files.exists(partial)&&!Files.exists(record),"WITHDRAWN_ARTIFACT_RETAINED");
            }else if(scenario.equals("unchanged")){
                check(accepted[0]&&phase.equals("installing")&&Files.isRegularFile(ready),"CURRENT_VALID_INSTALL_REFUSED");
            }else if(scenario.equals("superseded")){
                check(!accepted[0]&&phase.equals("checking")&&Files.isRegularFile(ready)&&Files.size(ready)==2&&!Files.exists(record),"OLD_CATALOG_CHANGED_NEW_OWNER");
            }else if(scenario.equals("cancelled")){
                check(!accepted[0]&&phase.equals("idle")&&!Files.exists(ready)&&!Files.exists(record),"CANCELLED_CATALOG_REVIVED_UPDATE");
            }else if(scenario.equals("delete-refused")){
                check(!accepted[0]&&phase.equals("failed")&&"FILE".equals(error)&&Files.isDirectory(ready),"FAILED_DELETE_REPORTED_AVAILABLE");
            }else{
                check(!accepted[0]&&phase.equals("ready")&&Files.size(ready)==3&&"0.1.44".equals(result.get("version")),"UNTRUSTED_CATALOG_DESTROYED_VALID_FILE");
                check((scenario.equals("network")?"NETWORK":"SOURCE").equals(error),"WRONG_REFUSAL");
            }
            System.out.println("PASS_CATALOG_RECOVERY "+scenario);
        }finally{
            release.countDown();worker.shutdownNow();check(worker.awaitTermination(2,TimeUnit.SECONDS),"WORKER_NOT_STOPPED");
            if(Files.isDirectory(ready))Files.deleteIfExists(ready.resolve("child"));Files.deleteIfExists(ready);Files.deleteIfExists(partial);Files.deleteIfExists(record);Files.delete(directory);
        }
    }
}
