package com.kub.messenger;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.UserManager;
import android.security.keystore.KeyInfo;
import android.system.Os;
import android.util.AtomicFile;
import java.io.*;
import java.lang.reflect.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.*;
import java.security.cert.Certificate;
import java.security.spec.KeySpec;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import javax.crypto.*;
import javax.crypto.spec.SecretKeySpec;

// Real JCA and files; Android CE/UID/mode/AtomicFile policy is explicitly doubled.
public final class MessagePreviewChoiceStoreProbe {
    static final String INSTALL="11111111111111111111111111111111", OP="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    static final String ALIAS="letscube.nmpv.credential.v1."+INSTALL+"."+OP;
    static final String PUBLIC="FICTIONAL-PUBLIC-ANON-KEY-NOT-A-CREDENTIAL";
    static final SecretKey KEY=new SecretKeySpec(new byte[32],"AES");
    static final Map<String,Key> keys=new HashMap<>();
    static String lastAlias;
    static int keyMutations;
    static File root, namespace, choice;
    static OwnedContext context;
    static Class<?> storeClass;
    static final class OwnedContext extends Context {
        final UserManager user=new UserManager(); final ApplicationInfo info=new ApplicationInfo(); boolean dp;
        public boolean isDeviceProtectedStorage(){return dp;}
        public Context getApplicationContext(){return this;}
        public File getNoBackupFilesDir(){return root;}
        public Object getSystemService(String name){return user;}
        public ApplicationInfo getApplicationInfo(){return info;}
    }
    public static final class FixtureProvider extends Provider {
        private static final long serialVersionUID=1L;
        FixtureProvider(){super("AndroidKeyStore","1.0","FICTIONAL POLICY ONLY");
            put("KeyStore.AndroidKeyStore",Store.class.getName());put("SecretKeyFactory.AES",Factory.class.getName());}
    }
    public static final class Store extends KeyStoreSpi {
        public Key engineGetKey(String a,char[] p){lastAlias=a;return keys.get(a);}
        public void engineLoad(InputStream s,char[] p){}
        public void engineSetKeyEntry(String a,Key k,char[] p,Certificate[] c){mutated();}
        public void engineSetKeyEntry(String a,byte[] b,Certificate[] c){mutated();}
        public void engineSetCertificateEntry(String a,Certificate c){mutated();}
        public void engineDeleteEntry(String a){mutated();}
        public void engineStore(OutputStream s,char[] p){mutated();}
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
        protected KeySpec engineGetKeySpec(SecretKey k,Class<?> c){KeyInfo info=new KeyInfo();info.alias=lastAlias;return info;}
        protected SecretKey engineGenerateSecret(KeySpec s){mutated();return null;}
        protected SecretKey engineTranslateKey(SecretKey k){mutated();return null;}
    }
    static void mutated(){keyMutations++;throw new AssertionError("NO_KEY_MUTATION");}
    interface Action {void run() throws Exception;}
    static void require(boolean ok,String oracle){if(!ok)throw new AssertionError(oracle);}
    static Object unwrap(ActionValue action)throws Exception {
        try{return action.get();}catch(InvocationTargetException e){Throwable t=e.getCause();if(t instanceof Exception)throw(Exception)t;if(t instanceof Error)throw(Error)t;throw new AssertionError("UNEXPECTED");}
    }
    interface ActionValue{Object get()throws Exception;}
    static Object construct()throws Exception{return unwrap(()->storeClass.getDeclaredConstructor(Context.class).newInstance(context));}
    static Object invoke(Object store,String name,Class<?>[] types,Object...args)throws Exception{
        return unwrap(()->storeClass.getDeclaredMethod(name,types).invoke(store,args));
    }
    static final Class<?> RECORD=MessagePreviewMetadataEnvelope.Record.class;
    static Object read(Object s,MessagePreviewMetadataEnvelope.Record h)throws Exception{return invoke(s,"read",new Class<?>[]{RECORD},h);}
    static boolean write(Object s,MessagePreviewMetadataEnvelope.Record h,String level,String key,long revision)throws Exception{
        return (Boolean)invoke(s,"write",new Class<?>[]{RECORD,String.class,String.class,long.class},h,level,key,revision);
    }
    static Object field(Object c,String name)throws Exception{return c.getClass().getDeclaredField(name).get(c);}
    static boolean current(Object s,MessagePreviewMetadataEnvelope.Record h,Object c)throws Exception{
        return (Boolean)invoke(s,"isCurrent",new Class<?>[]{RECORD,c.getClass()},h,c);
    }
    static void refuses(Action a,String oracle)throws Exception{
        try{a.run();}catch(Exception e){if(e.getClass().getName().equals("com.kub.messenger.MessagePreviewChoiceStore$Unavailable")){
            require("UNAVAILABLE".equals(e.getMessage())&&e.getCause()==null&&e.getStackTrace().length==0,"FIXED_REFUSAL");return;}throw e;}
        throw new AssertionError(oracle);
    }
    static MessagePreviewMetadataEnvelope.Record head(long generation,long revision)throws Exception{
        MessagePreviewMetadataEnvelope.Header h=new MessagePreviewMetadataEnvelope.Header(INSTALL,generation,
            MessagePreviewMetadataEnvelope.Kind.COMMITTED,ALIAS,5000,1000,OP,generation-1,revision);
        return MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(h,new byte[28],KEY),INSTALL,KEY);
    }
    static byte[] disk()throws Exception{return Files.readAllBytes(choice.toPath());}
    static void unchanged(byte[] b)throws Exception{require(Arrays.equals(b,disk()),"REFUSAL_NO_WRITE");}
    static byte[] envelope(byte[] plain)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,KEY);
        cipher.updateAAD("LETSCUBE-NMPV-CHOICE-v1".getBytes(StandardCharsets.US_ASCII));byte[] encrypted=cipher.doFinal(plain);
        byte[] blob=ByteBuffer.allocate(12+encrypted.length).put(cipher.getIV()).put(encrypted).array();
        return MessagePreviewMetadataEnvelope.seal(head(9,47).header,blob,KEY);
    }
    static void decodedPayload(byte[] plain)throws Exception{Files.write(choice.toPath(),envelope(plain));}
    static byte[] plain(String level,String key,long revision)throws Exception{
        byte[] magic="LETSCUBE-CHOICE-v1".getBytes(StandardCharsets.US_ASCII), pub=key.getBytes(StandardCharsets.US_ASCII);
        return ByteBuffer.allocate(magic.length+11+pub.length).put(magic).putLong(revision)
            .put((byte)(level.equals("none")?0:level.equals("sender")?1:2)).putShort((short)pub.length).put(pub).array();
    }
    static void await(CountDownLatch latch){try{require(latch.await(4,TimeUnit.SECONDS),"CONCURRENT_LATCH");}catch(InterruptedException e){throw new AssertionError("INTERRUPTED");}}
    static void concurrent(MessagePreviewMetadataEnvelope.Record head,String mode)throws Exception{
        boolean guarded=mode.equals("concurrent-guard"),secondWrite=!mode.equals("concurrent-read");
        MessagePreviewMetadataEnvelope.Record firstHead=guarded?head(10,48):head;
        CountDownLatch ready=new CountDownLatch(2),firstGo=new CountDownLatch(1),secondGo=new CountDownLatch(1),writing=new CountDownLatch(1),release=new CountDownLatch(1);
        AtomicReference<Throwable> error=new AtomicReference<>();AtomicInteger secondIO=new AtomicInteger(),guardCalls=new AtomicInteger();AtomicBoolean current=new AtomicBoolean(true);
        Thread first=new Thread(()->{try{Object own=construct();ready.countDown();await(firstGo);
            require(write(own,firstHead,"sender",PUBLIC,guarded?1:2),"FIRST_CONCURRENT_WRITE");}catch(Throwable e){error.compareAndSet(null,e);}},"choice-first");
        Thread second=new Thread(()->{try{Object own=construct();ready.countDown();await(secondGo);
            if(guarded){Runnable guard=()->{guardCalls.incrementAndGet();if(!current.get())throw new IllegalStateException("FICTIONAL_STALE_BINDING");};
                require(!(Boolean)invoke(own,"write",new Class<?>[]{RECORD,String.class,String.class,long.class,Runnable.class},head,"message",PUBLIC,3L,guard),"STALE_QUEUED_WRITE_REFUSED");}
            else if(secondWrite)require(write(own,head,"message",PUBLIC,3),"SECOND_CONCURRENT_WRITE");
            else require((Long)field(read(own,head),"revision")==2,"READ_AFTER_COMPLETE_WRITE");
        }catch(Throwable e){error.compareAndSet(null,e);}},"choice-second");
        AtomicFile.onFlush=()->{if(Thread.currentThread()==first){writing.countDown();await(release);}};
        AtomicFile.afterRead=()->{if(Thread.currentThread()==second)secondIO.incrementAndGet();};
        first.setDaemon(true);second.setDaemon(true);first.start();second.start();
        try{
            await(ready);firstGo.countDown();await(writing);secondGo.countDown();
            long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
            while(second.isAlive()&&second.getState()!=Thread.State.BLOCKED&&secondIO.get()==0&&guardCalls.get()==0&&System.nanoTime()<end)Thread.sleep(1);
            if(guarded)require(guardCalls.get()==0,"GUARD_AFTER_SHARED_SLOT");
            require(second.isAlive()&&second.getState()==Thread.State.BLOCKED&&secondIO.get()==0&&AtomicFile.starts==2,"SHARED_CHOICE_SERIALIZATION");
        }finally{current.set(false);release.countDown();firstGo.countDown();secondGo.countDown();first.join(4000);second.join(4000);AtomicFile.onFlush=AtomicFile.afterRead=null;}
        require(!first.isAlive()&&!second.isAlive()&&error.get()==null,"CONCURRENT_COMPLETION");
        require((Long)field(read(construct(),firstHead),"revision")== (guarded?1:secondWrite?3:2),"CONCURRENT_FINAL_REVISION");
    }
    static void scenario(String name)throws Exception {
        MessagePreviewMetadataEnvelope.Record head=head(9,47);
        if(name.equals("main")){refuses(()->construct(),"OFF_MAIN");return;}
        if(name.equals("context")){context.dp=true;refuses(()->construct(),"CE_ONLY");context.dp=false;
            context.user.unlocked=false;refuses(()->construct(),"UNLOCKED");context.user.unlocked=true;
            context.info.uid++;refuses(()->construct(),"OWN_UID");return;}
        if(name.equals("namespace")){Os.modes.put(namespace.getPath(),0755);refuses(()->construct(),"NAMESPACE_MODE");return;}
        Object store=construct();
        if(name.equals("missing")){refuses(()->read(store,head),"MISSING_REFUSED");require(!choice.exists(),"NO_INIT_ON_READ");return;}
        require(write(store,head,"none",PUBLIC,1),"FIRST_WRITE");Object first=read(store,head);
        if(name.equals("guard-refusal")){
            byte[] before=disk();AtomicInteger calls=new AtomicInteger();
            Runnable refused=()->{calls.incrementAndGet();throw new IllegalStateException("FICTIONAL_STALE_BINDING");};
            require(!(Boolean)invoke(store,"write",new Class<?>[]{RECORD,String.class,String.class,long.class,Runnable.class},head,"message",PUBLIC,2L,refused)
                &&calls.get()==1,"PREWRITE_GUARD_REFUSES_WITHOUT_EFFECTS");unchanged(before);
            require(!(Boolean)invoke(store,"write",new Class<?>[]{RECORD,String.class,String.class,long.class,Runnable.class},head,"message",PUBLIC,2L,null),"NULL_GUARD_REFUSED");unchanged(before);
        }else if(name.startsWith("concurrent-")){
            concurrent(head,name);
        }else if(name.equals("healthy")){
            require(field(first,"level").equals("none")&&field(first,"publicKey").equals(PUBLIC)&&(Long)field(first,"revision")==1,"EXACT_PAYLOAD");
            require(current(store,head,first),"CURRENT_TRUE");
            require(write(store,head,"sender",PUBLIC,2)&&write(store,head,"message",PUBLIC,3),"ALL_LEVELS");
            require(!current(store,head,first),"OLD_CHOICE_REFUSED");
            Object cold=construct(), c=read(cold,head);require((Long)field(c,"revision")==3&&field(c,"level").equals("message"),"COLD_DURABLE");
            require(!new String(disk(),StandardCharsets.ISO_8859_1).contains(PUBLIC),"ENCRYPTED_NOT_AUTH_ONLY");
            require(AtomicFile.finishes==3&&AtomicFile.starts==3,"ONE_WRITE_EACH");
        }else if(name.equals("revisions")){
            byte[] old=disk();require(write(store,head,"message",PUBLIC,7),"HIGHER_REVISION");byte[] high=disk();
            require(!write(construct(),head,"sender",PUBLIC,7)&&!write(store,head,"sender",PUBLIC,6),"DURABLE_MONOTONIC");unchanged(high);
            Files.write(choice.toPath(),old);refuses(()->read(store,head),"PROCESS_ROLLBACK_REFUSED");
            require(!write(store,head,"none",PUBLIC,7),"PROCESS_FLOOR");
        }else if(name.equals("new-head")){
            MessagePreviewMetadataEnvelope.Record next=head(10,48);byte[] before=disk();
            refuses(()->read(store,next),"OLD_HEAD_READ_REFUSED");require(!current(store,next,first),"OLD_HEAD_CURRENT_REFUSED");unchanged(before);
            require(write(store,next,"none",PUBLIC,1),"NEW_HEAD_REVISION_RESET");require(current(store,next,read(store,next)),"NEW_HEAD_CURRENT");
            refuses(()->read(store,head),"EXACT_HEADER");
        }else if(name.startsWith("header-")){
            MessagePreviewMetadataEnvelope.Header h=head.header;String mode=name.substring(7);
            MessagePreviewMetadataEnvelope.Header other=new MessagePreviewMetadataEnvelope.Header(
                mode.equals("installation")?"22222222222222222222222222222222":h.installation,
                mode.equals("generation")?10:h.generation, h.kind,
                mode.equals("installation")?"letscube.nmpv.credential.v1.22222222222222222222222222222222."+OP:
                    mode.equals("alias")?"letscube.nmpv.credential.v1."+INSTALL+".bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb":h.alias,
                mode.equals("expiry")?h.expiresWallMillis+1:h.expiresWallMillis,mode.equals("wall")?h.wallHighWaterMillis+1:h.wallHighWaterMillis,
                mode.equals("operation")?"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb":h.operationId,
                mode.equals("generation")?9:h.baseGeneration,mode.equals("revision")?h.vaultRevision+1:h.vaultRevision);
            MessagePreviewMetadataEnvelope.Record expected=MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(other,new byte[28],KEY),other.installation,KEY);
            refuses(()->read(store,expected),"FULL_HEADER_"+mode.toUpperCase(Locale.ROOT));
        }else if(name.equals("invalid")){
            byte[] before=disk();for(String level:new String[]{"MESSAGE","","unknown"})require(!write(store,head,level,PUBLIC,2),"LEVEL_BOUND");
            for(String key:new String[]{"","a b","a\nb","\u0080",String.join("",Collections.nCopies(4097,"x"))})require(!write(store,head,"sender",key,2),"PUBLIC_KEY_BOUND");
            require(!write(store,head,"sender",PUBLIC,-1)&&!write(store,head,"sender",PUBLIC,9007199254740992L),"REVISION_BOUND");unchanged(before);
            require(write(store,head,"message",String.join("",Collections.nCopies(4096,"x")),9007199254740991L),"LITERAL_MAXIMA");
        }else if(name.equals("corrupt")){
            byte[] bytes=disk();bytes[bytes.length-1]^=1;Files.write(choice.toPath(),bytes);
            refuses(()->read(store,head),"AUTH_REQUIRED");require(!write(store,head,"none",PUBLIC,2),"CORRUPT_NO_OVERWRITE");unchanged(bytes);
        }else if(name.equals("payload-valid")){
            decodedPayload(plain("message",PUBLIC,2));Object value;
            try{value=read(store,head);}catch(Exception refused){throw new AssertionError("CHOICE_AAD_INTEROP");}
            require(field(value,"level").equals("message")&&(Long)field(value,"revision")==2,"LITERAL_PAYLOAD_INTEROP");
        }else if(name.equals("purpose")){
            byte[] p=plain("message",PUBLIC,2);p[0]^=1;decodedPayload(p);byte[] before=disk();
            refuses(()->read(store,head),"CHOICE_PURPOSE");require(!write(store,head,"none",PUBLIC,3),"PURPOSE_NO_RESET");unchanged(before);
        }else if(name.equals("trailing")){
            byte[] p=plain("message",PUBLIC,2);decodedPayload(Arrays.copyOf(p,p.length+1));refuses(()->read(store,head),"EXACT_PAYLOAD_LENGTH");
        }else if(name.equals("keyloss")){
            byte[] before=disk();keys.clear();refuses(()->read(store,head),"KEYLOSS_REFUSE");
            require(!write(store,head,"none",PUBLIC,2)&&keys.isEmpty(),"KEYLOSS_NO_RESET");unchanged(before);
        }else if(name.equals("path")){
            byte[] before=disk();Os.replaceIdentity(namespace.getPath());refuses(()->read(store,head),"NAMESPACE_IDENTITY");
            require(!write(store,head,"none",PUBLIC,2),"NO_REPLACED_NAMESPACE_WRITE");unchanged(before);
        }else if(name.equals("symlink")){
            byte[] before=disk();Os.types.put(choice.getPath(),0120000);refuses(()->read(store,head),"NO_SYMLINK");
            require(!write(store,head,"none",PUBLIC,2),"NO_SYMLINK_WRITE");unchanged(before);
        }else if(name.equals("readback")){
            AtomicFile.readbackReplacement=envelope(plain("message",PUBLIC,2));
            require(!write(store,head,"message",PUBLIC,2),"CIPHERTEXT_READBACK");
        }else if(name.equals("noncommitted")){
            MessagePreviewMetadataEnvelope.Header h=new MessagePreviewMetadataEnvelope.Header(INSTALL,9,
                MessagePreviewMetadataEnvelope.Kind.PENDING,ALIAS,0,1000,OP,8,47);
            MessagePreviewMetadataEnvelope.Record pending=MessagePreviewMetadataEnvelope.open(MessagePreviewMetadataEnvelope.seal(h,new byte[0],KEY),INSTALL,KEY);
            byte[] before=disk();refuses(()->read(store,pending),"COMMITTED_ONLY");
            require(!write(store,pending,"none",PUBLIC,2)&&!current(store,pending,first),"NO_PENDING_WRITE");unchanged(before);
        }else if(name.equals("thread")){
            Throwable[] failure={null};Thread thread=new Thread(()->{try{refuses(()->read(store,head),"THREAD_BOUND");}catch(Throwable e){failure[0]=e;}});
            thread.start();thread.join();if(failure[0]!=null)throw new AssertionError("THREAD_BOUND");
        }else if(name.equals("post-read-lock")){
            AtomicFile.afterRead=()->context.user.unlocked=false;refuses(()->read(store,head),"POST_READ_CONTEXT");
        }else if(name.equals("failure")){
            byte[] before=disk();AtomicFile.failSync=true;require(!write(store,head,"sender",PUBLIC,2),"SYNC_FAILURE");unchanged(before);
        }else if(name.equals("post-write-lock")){
            AtomicFile.onFlush=()->context.user.unlocked=false;
            require(!write(store,head,"message",PUBLIC,2),"LOCKED_WRITE_REFUSED");
            require(AtomicFile.lastClosed,"FAILED_WRITE_STREAM_CLOSED");
        }else throw new AssertionError("UNKNOWN_CASE");
    }
    public static void main(String[] args)throws Exception {
        Looper.getMainLooper();root=new File(args[1]);namespace=new File(root,"native-message-previews-v1");require(namespace.mkdir(),"FIXTURE_NAMESPACE");
        choice=new File(namespace,"choice-v1.bin");context=new OwnedContext();keys.put("letscube.nmpv.metadata.v1."+INSTALL,KEY);Security.addProvider(new FixtureProvider());
        File sentinel=new File(namespace,"journal-v1.bin");byte[] original="FICTIONAL-VAULT-JOURNAL-NOT-CHOICE".getBytes(StandardCharsets.US_ASCII);Files.write(sentinel.toPath(),original);
        try{storeClass=Class.forName("com.kub.messenger.MessagePreviewChoiceStore");}
        catch(ClassNotFoundException missing){System.err.println("FAIL MISSING_CHOICE_STORE");System.exit(1);}
        Throwable[] error={null};Runnable action=()->{try{scenario(args[0]);}catch(Throwable e){error[0]=e;}};
        if(args[0].equals("main"))action.run();else{Thread worker=new Thread(action);worker.start();worker.join();}
        if(error[0]!=null){System.err.println("FAIL "+(error[0] instanceof AssertionError?error[0].getMessage():"UNEXPECTED"));System.exit(1);}
        require(Arrays.equals(original,Files.readAllBytes(sentinel.toPath())),"VAULT_UNTOUCHED");require(keyMutations==0,"NO_KEY_MUTATION");
        System.out.println("PASS "+args[0]);
    }
}
