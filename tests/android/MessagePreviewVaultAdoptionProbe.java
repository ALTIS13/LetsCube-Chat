package com.kub.messenger;

import android.os.Looper;
import android.os.SystemClock;
import android.system.Os;
import android.util.AtomicFile;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.Date;
import java.util.Enumeration;
import java.util.Collections;
import java.security.*;
import java.security.cert.Certificate;
import java.io.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Real owner/crypto/files, reused fictional Android provider and policy edges. */
public final class MessagePreviewVaultAdoptionProbe {
    static int deleted;
    public static final class RetireProvider extends Provider {
        private static final long serialVersionUID=1L;
        RetireProvider(){super("AndroidKeyStore","1.0","FICTIONAL TEST PROVIDER");put("KeyStore.AndroidKeyStore",RetireStore.class.getName());
            put("SecretKeyFactory.AES",MessagePreviewExistingVaultProbe.Factory.class.getName());}
    }
    public static final class RetireStore extends KeyStoreSpi {
        public Key engineGetKey(String alias,char[] p){MessagePreviewExistingVaultProbe.keyAlias=alias;return MessagePreviewExistingVaultProbe.keys.get(alias);}
        public void engineLoad(InputStream s,char[] p){}
        public Enumeration<String> engineAliases(){return Collections.enumeration(new ArrayList<>(MessagePreviewExistingVaultProbe.keys.keySet()));}
        public boolean engineContainsAlias(String a){return MessagePreviewExistingVaultProbe.keys.containsKey(a);}
        public void engineDeleteEntry(String a){need(a.equals(MessagePreviewExistingVaultProbe.ALIAS),"EXACT_RETIRING_KEY");deleted++;MessagePreviewExistingVaultProbe.keys.remove(a);}
        public void engineSetKeyEntry(String a,Key k,char[] p,Certificate[] c){throw new AssertionError("NO_MINT");}
        public void engineSetKeyEntry(String a,byte[] b,Certificate[] c){throw new AssertionError("NO_MINT");}
        public void engineSetCertificateEntry(String a,Certificate c){throw new AssertionError("NO_MINT");}
        public void engineStore(OutputStream s,char[] p){throw new AssertionError("NO_MINT");}
        public Certificate[] engineGetCertificateChain(String a){return null;}
        public Certificate engineGetCertificate(String a){return null;}
        public Date engineGetCreationDate(String a){return null;}
        public int engineSize(){return MessagePreviewExistingVaultProbe.keys.size();}
        public boolean engineIsKeyEntry(String a){return engineContainsAlias(a);}
        public boolean engineIsCertificateEntry(String a){return false;}
        public String engineGetCertificateAlias(Certificate c){return null;}
    }
    static class Authority implements MessagePreviewInitializationGate.ForegroundAuthority {
        volatile Object epoch=new Object();
        public Object capture(){return epoch;}
        public boolean isCurrent(Object expected){return epoch==expected;}
    }
    static void need(boolean yes,String code){if(!yes)throw new AssertionError(code);}
    static MessagePreviewPristineInitializer.InitResult load(MessagePreviewPristineInitializer owner)throws Exception {
        CompletableFuture<MessagePreviewPristineInitializer.InitResult> result=new CompletableFuture<>();
        owner.loadExisting(result::complete);return result.get(4,TimeUnit.SECONDS);
    }
    static void run(String name,String path)throws Exception {
        Looper.getMainLooper();MessagePreviewExistingVaultProbe.setup(path);
        if(name.equals("retire")||name.equals("replayed-id")){
            Security.removeProvider("AndroidKeyStore");Security.addProvider(new RetireProvider());
            MessagePreviewExistingVaultProbe.keys.put(MessagePreviewExistingVaultProbe.ALIAS,MessagePreviewExistingVaultProbe.KEY);
        }
        var context=MessagePreviewExistingVaultProbe.context;var authority=new Authority();
        if(name.equals("empty"))MessagePreviewExistingVaultProbe.write(MessagePreviewMetadataEnvelope.Kind.EMPTY,8,46,(byte)0);
        if(name.equals("pending"))MessagePreviewExistingVaultProbe.write(MessagePreviewMetadataEnvelope.Kind.PENDING,9,47,(byte)0);
        if(name.equals("retiring"))MessagePreviewExistingVaultProbe.write(MessagePreviewMetadataEnvelope.Kind.RETIRING,9,47,(byte)0);
        if(name.equals("key-loss"))MessagePreviewExistingVaultProbe.keys.clear();
        if(name.equals("corrupt")){byte[] b=Files.readAllBytes(MessagePreviewExistingVaultProbe.journal.toPath());b[b.length-1]^=1;Files.write(MessagePreviewExistingVaultProbe.journal.toPath(),b);}
        if(name.equals("missing"))Files.delete(MessagePreviewExistingVaultProbe.marker.toPath());
        byte[] before=Files.readAllBytes(MessagePreviewExistingVaultProbe.journal.toPath());
        boolean[] changed={false};
        if(name.equals("marker-changed-load"))Os.onEvent=event->{
            if(!changed[0]&&AtomicFile.reads==1&&event.equals("lstat:journal-v1.bin")){
                changed[0]=true;
                try{Files.write(MessagePreviewExistingVaultProbe.marker.toPath(),MessagePreviewInstallationMarker.encode(new byte[16]));}
                catch(Exception e){throw new AssertionError("FIXTURE_MARKER_CHANGE");}
            }
        };
        android.app.Application application=new android.app.Application(){
            public android.content.Context getApplicationContext(){return this;}
            public boolean isDeviceProtectedStorage(){return context.isDeviceProtectedStorage();}
            public File getNoBackupFilesDir(){return context.getNoBackupFilesDir();}
            public Object getSystemService(String name){return context.getSystemService(name);}
            public android.content.pm.ApplicationInfo getApplicationInfo(){return context.getApplicationInfo();}
        };
        MessagePreviewPristineInitializer owner=MessagePreviewPristineInitializer.getOrCreate(application,authority);
        try {
            var loaded=load(owner);
            if(name.equals("marker-changed-load"))need(changed[0],"MARKER_CHANGED_AFTER_FIRST_AUTHENTICATED_READ");
            boolean refused=Arrays.asList("pending","retiring","key-loss","corrupt","missing","marker-changed-load").contains(name);
            if(refused){need(loaded.status==MessagePreviewPristineInitializer.Status.UNAVAILABLE&&loaded.generation==null,"NO_INVENTED_LOADED_STATE");}
            else {
                need(loaded.status==MessagePreviewPristineInitializer.Status.LOADED_EXISTING
                    &&loaded.generation==(name.equals("empty")?8L:9L)&&loaded.vaultRevision==(name.equals("empty")?46L:47L),"EXACT_DURABLE_HEAD");
                if(name.equals("replayed-id")){
                    CompletableFuture<MessagePreviewPristineInitializer.TransitionResult> retired=new CompletableFuture<>();
                    owner.retireExact(MessagePreviewExistingVaultProbe.OP,48,9,null,retired::complete);
                    need(retired.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.TransitionStatus.INVALID_REQUEST,"DURABLE_OPERATION_NOT_REPLAYABLE");
                }else if(name.equals("stale-revision")){
                    CompletableFuture<MessagePreviewPristineInitializer.TransitionResult> retired=new CompletableFuture<>();
                    owner.retireExact("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",47,9,null,retired::complete);
                    need(retired.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.TransitionStatus.STALE_OWNER,"DURABLE_REVISION_NOT_RESET");
                }else if(name.equals("retire")){
                    CompletableFuture<MessagePreviewPristineInitializer.TransitionResult> retired=new CompletableFuture<>();
                    owner.retireExact("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",48,9,null,retired::complete);
                    var result=retired.get(4,TimeUnit.SECONDS);
                    need(result.status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED&&result.generation==10L&&deleted==1,"LOADED_EXACT_RETIREMENT");
                }else if(name.equals("repeat"))need(load(owner).status==MessagePreviewPristineInitializer.Status.UNAVAILABLE,"NO_RELOAD_RESET");
            }
            if(!name.equals("retire"))need(Arrays.equals(before,Files.readAllBytes(MessagePreviewExistingVaultProbe.journal.toPath()))
                &&AtomicFile.starts==0&&AtomicFile.finishes==0,"LOAD_WITHOUT_REWRITE");
            need(MessagePreviewExistingVaultProbe.mutations==0,"NO_KEY_MUTATION_ON_LOAD");
        }finally{owner.close();}
    }
    public static void main(String[] args){try{run(args[0],args[1]);System.out.println("PASS "+args[0]);}
        catch(Throwable e){System.err.println("FAIL "+(e instanceof AssertionError?e.getMessage():"UNEXPECTED"));System.exit(1);}}
}
