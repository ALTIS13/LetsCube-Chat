package com.kub.messenger;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.UserManager;
import android.security.keystore.KeyInfo;
import android.system.Os;
import android.util.AtomicFile;
import java.io.*;
import java.nio.file.Files;
import java.security.*;
import java.security.cert.Certificate;
import java.security.spec.KeySpec;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.SecretKeySpec;

// Real JVM files and AES/GCM; Android custody/CE/Keystore policy are labeled doubles.
public final class MessagePreviewExistingVaultProbe {
    static final String INSTALL="11111111111111111111111111111111", OP="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    static final String ALIAS="letscube.nmpv.credential.v1."+INSTALL+"."+OP;
    static final SecretKey KEY=new SecretKeySpec(new byte[32],"AES");
    static final Map<String,Key> keys=new HashMap<>();
    static String keyAlias;
    static File root, namespace, marker, journal;
    static OwnedContext context;
    static boolean returned;
    static int mutations;
    static final class OwnedContext extends Context {
        final UserManager user=new UserManager(); final ApplicationInfo info=new ApplicationInfo();
        boolean dp;
        public boolean isDeviceProtectedStorage(){return dp;}
        public Context getApplicationContext(){return this;}
        public File getNoBackupFilesDir(){return root;}
        public Object getSystemService(String name){return user;}
        public ApplicationInfo getApplicationInfo(){return info;}
    }
    public static final class ProviderFixture extends Provider {
        private static final long serialVersionUID=1L;
        ProviderFixture(){super("AndroidKeyStore","1.0","FICTIONAL TEST PROVIDER");
            put("KeyStore.AndroidKeyStore",Store.class.getName()); put("SecretKeyFactory.AES",Factory.class.getName());}
    }
    public static final class Store extends KeyStoreSpi {
        public Key engineGetKey(String alias,char[] password){keyAlias=alias; return keys.get(alias);}
        public void engineLoad(InputStream stream,char[] password){}
        public void engineSetKeyEntry(String a,Key k,char[] p,Certificate[] c){changed();}
        public void engineSetKeyEntry(String a,byte[] b,Certificate[] c){changed();}
        public void engineSetCertificateEntry(String a,Certificate c){changed();}
        public void engineDeleteEntry(String a){changed();}
        public void engineStore(OutputStream s,char[] p){changed();}
        public Certificate[] engineGetCertificateChain(String a){throw new AssertionError("UNUSED");}
        public Certificate engineGetCertificate(String a){throw new AssertionError("UNUSED");}
        public Date engineGetCreationDate(String a){throw new AssertionError("UNUSED");}
        public Enumeration<String> engineAliases(){throw new AssertionError("NO_INVENTORY");}
        public boolean engineContainsAlias(String a){throw new AssertionError("UNUSED");}
        public int engineSize(){throw new AssertionError("UNUSED");}
        public boolean engineIsKeyEntry(String a){throw new AssertionError("UNUSED");}
        public boolean engineIsCertificateEntry(String a){throw new AssertionError("UNUSED");}
        public String engineGetCertificateAlias(Certificate c){throw new AssertionError("UNUSED");}
    }
    public static final class Factory extends SecretKeyFactorySpi {
        protected KeySpec engineGetKeySpec(SecretKey supplied,Class<?> type){KeyInfo info=new KeyInfo();info.alias=keyAlias;return info;}
        protected SecretKey engineGenerateSecret(KeySpec spec){changed();return null;}
        protected SecretKey engineTranslateKey(SecretKey key){changed();return null;}
    }
    static void changed(){mutations++;throw new AssertionError("NO_KEY_MUTATION");}
    interface Action {void run() throws Exception;}
    static void require(boolean ok,String oracle){if(!ok)throw new AssertionError(oracle);}
    static void refuses(Action action,String oracle)throws Exception {
        try{action.run();}catch(MessagePreviewExistingVault.Unavailable expected){
            require("UNAVAILABLE".equals(expected.getMessage())&&expected.getCause()==null&&expected.getStackTrace().length==0,"FIXED_REFUSAL");return;}
        throw new AssertionError(oracle);
    }
    static void write(MessagePreviewMetadataEnvelope.Kind kind,long generation,long revision,byte value)throws Exception {
        String alias=kind==MessagePreviewMetadataEnvelope.Kind.EMPTY?"":ALIAS;
        byte[] blob=kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED?new byte[28]:new byte[0];Arrays.fill(blob,value);
        MessagePreviewMetadataEnvelope.Header h=new MessagePreviewMetadataEnvelope.Header(INSTALL,generation,kind,alias,
            kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED?5000:0,1000,generation==0?"":OP,generation==0?0:generation-1,revision);
        Files.write(journal.toPath(),MessagePreviewMetadataEnvelope.seal(h,blob,KEY));
    }
    static void setup(String path)throws Exception {
        root=new File(path); namespace=new File(root,"native-message-previews-v1");require(namespace.mkdir(),"FIXTURE_NAMESPACE");
        marker=new File(namespace,"installation-v1.bin");journal=new File(namespace,"journal-v1.bin");
        byte[] nonce=new byte[16];Arrays.fill(nonce,(byte)0x11);Files.write(marker.toPath(),MessagePreviewInstallationMarker.encode(nonce));
        Os.modes.put(marker.getPath(),0600);context=new OwnedContext();
        keys.put("letscube.nmpv.metadata.v1."+INSTALL,KEY);Security.addProvider(new ProviderFixture());
        write(MessagePreviewMetadataEnvelope.Kind.COMMITTED,9,47,(byte)1);
    }
    static void scenario(String name)throws Exception {
        if(name.equals("main-thread")){refuses(()->MessagePreviewExistingVault.open(context),"WORKER_ONLY");return;}
        if(name.equals("context")){context.dp=true;refuses(()->MessagePreviewExistingVault.open(context),"CE_ONLY");context.dp=false;
            context.user.unlocked=false;refuses(()->MessagePreviewExistingVault.open(context),"UNLOCKED_ONLY");context.user.unlocked=true;
            context.info.uid=10124;refuses(()->MessagePreviewExistingVault.open(context),"APP_UID");return;}
        if(name.equals("missing")){Files.delete(marker.toPath());refuses(()->MessagePreviewExistingVault.open(context),"NO_MARKER_CREATION");return;}
        if(name.equals("marker-bounds")){for(int size:new int[]{0,27,29,200}){Files.write(marker.toPath(),new byte[size]);
            refuses(()->MessagePreviewExistingVault.open(context),"EXACT_MARKER_BOUNDS");}return;}
        if(name.equals("marker-mode")){Os.modes.put(marker.getPath(),0644);refuses(()->MessagePreviewExistingVault.open(context),"MARKER_MODE");return;}
        if(name.equals("marker-owner")){Os.owners.put(marker.getPath(),10124);refuses(()->MessagePreviewExistingVault.open(context),"MARKER_UID");return;}
        if(name.equals("namespace-mode")){Os.modes.put(namespace.getPath(),0755);refuses(()->MessagePreviewExistingVault.open(context),"NAMESPACE_MODE");return;}
        if(name.equals("namespace-owner")){Os.owners.put(namespace.getPath(),10124);refuses(()->MessagePreviewExistingVault.open(context),"NAMESPACE_UID");return;}
        if(name.equals("root-owner")){Os.owners.put(root.getPath(),10124);refuses(()->MessagePreviewExistingVault.open(context),"ROOT_UID");return;}
        if(name.equals("marker-type")){Os.types.put(marker.getPath(),0120000);refuses(()->MessagePreviewExistingVault.open(context),"NO_MARKER_SYMLINK");return;}
        if(name.equals("namespace-type")){Os.types.put(namespace.getPath(),0120000);refuses(()->MessagePreviewExistingVault.open(context),"NO_NAMESPACE_SYMLINK");return;}
        if(name.equals("descriptor")){Os.wrongDescriptor=true;refuses(()->MessagePreviewExistingVault.open(context),"MARKER_DESCRIPTOR");return;}
        if(name.equals("read-failure")||name.equals("close-failure")){
            Os.fail=(name.equals("read-failure")?"read:":"close:")+"installation-v1.bin";
            refuses(()->MessagePreviewExistingVault.open(context),"IO_FAILURE_REFUSED");return;
        }
        MessagePreviewExistingVault vault=MessagePreviewExistingVault.open(context);
        MessagePreviewMetadataEnvelope.Record record=vault.readCommitted(2000);
        if(name.equals("healthy")){require(record.header.generation==9&&record.header.vaultRevision==47&&vault.isCurrent(record,2000),"DURABLE_GENERATION_REVISION");
            require(Os.events.contains("open:installation-v1.bin:131072:0"),"READ_ONLY_NOFOLLOW");}
        else if(name.equals("explicit-fd-close")){
            long opened=Os.events.stream().filter(s->s.startsWith("open:installation-v1.bin:")).count();
            long closed=Os.events.stream().filter(s->s.equals("close:installation-v1.bin")).count();
            require(opened>0&&opened==closed,"EXPLICIT_FD_CLOSE");
        }
        else if(name.equals("states")){for(MessagePreviewMetadataEnvelope.Kind kind:MessagePreviewMetadataEnvelope.Kind.values()){
            if(kind==MessagePreviewMetadataEnvelope.Kind.COMMITTED)continue;write(kind,9,47,(byte)1);
            require(vault.readAuthenticated().header.kind==kind,"PRESERVE_STATE");refuses(()->vault.readCommitted(2000),"COMMITTED_ONLY");}}
        else if(name.equals("clock")){refuses(()->vault.readCommitted(999),"ROLLBACK_REFUSED");refuses(()->vault.readCommitted(5000),"EXPIRY_REFUSED");
            refuses(()->vault.readCommitted(-1),"SAFE_CLOCK");refuses(()->vault.readCommitted(9007199254740992L),"SAFE_CLOCK");}
        else if(name.equals("metadata-key")){keys.clear();refuses(()->vault.readCommitted(2000),"NO_KEY_REPAIR");
            keys.put("letscube.nmpv.metadata.v1."+INSTALL,new SecretKeySpec(new byte[16],"AES"));refuses(()->vault.readCommitted(2000),"WRONG_KEY");}
        else if(name.equals("corrupt")){byte[] bytes=Files.readAllBytes(journal.toPath());bytes[bytes.length-1]^=1;Files.write(journal.toPath(),bytes);
            refuses(()->vault.readAuthenticated(),"AUTHENTICATION_REQUIRED");}
        else if(name.equals("different-thread")){final Throwable[] error={null};Thread t=new Thread(()->{try{refuses(()->vault.readCommitted(2000),"THREAD_BOUND");}catch(Throwable e){error[0]=e;}});t.start();t.join();if(error[0]!=null)throw new AssertionError("THREAD_BOUND");}
        else if(name.endsWith("-replaced")){File changed=name.startsWith("marker")?marker:name.startsWith("namespace")?namespace:root;
            Os.replaceIdentity(changed.getPath());refuses(()->vault.readCommitted(2000),"PATH_CUSTODY");}
        else if(name.equals("marker-changed")){byte[] nonce=new byte[16];Files.write(marker.toPath(),MessagePreviewInstallationMarker.encode(nonce));refuses(()->vault.readCommitted(2000),"INSTALLATION_CHANGED");}
        else if(name.equals("head-changed")){write(MessagePreviewMetadataEnvelope.Kind.COMMITTED,10,48,(byte)1);require(!vault.isCurrent(record,2000),"HEAD_CURRENT");}
        else if(name.equals("ciphertext-changed")){write(MessagePreviewMetadataEnvelope.Kind.COMMITTED,9,47,(byte)2);require(!vault.isCurrent(record,2000),"CIPHERTEXT_CURRENT");}
        else if(name.equals("locked-during-read")){Os.onEvent=event->{if(event.equals("lstat:journal-v1.bin"))context.user.unlocked=false;};
            refuses(()->vault.readCommitted(2000),"LOCKED_POST_READ");}
        else throw new AssertionError("UNKNOWN_CASE");
    }
    public static void main(String[] args)throws Exception {
        Looper.getMainLooper();setup(args[1]);final Throwable[] error={null};
        Runnable test=()->{try{scenario(args[0]);}catch(Throwable e){error[0]=e;}};
        if(args[0].equals("main-thread"))test.run();else{Thread worker=new Thread(test);worker.start();worker.join();}
        Os.onEvent=null;
        if(error[0]!=null){System.err.println("FAIL "+(error[0] instanceof AssertionError?error[0].getMessage():"UNEXPECTED"));System.exit(1);}
        require(mutations==0&&AtomicFile.starts==0&&AtomicFile.finishes==0&&AtomicFile.fails==0,"NO_WRITE_OR_KEY_MUTATION");
        require(Os.events.stream().noneMatch(s->s.startsWith("mkdir:")||s.startsWith("fsync:")),"NO_CREATE_OR_SYNC");Os.assertClosed();
        System.out.println("PASS "+args[0]);
    }
}
