package com.kub.messenger;

import android.app.Application;
import android.os.Looper;
import android.util.AtomicFile;
import java.io.File;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.security.Security;
import java.util.*;
import java.util.concurrent.*;

// Actual Fence and owner/JCA/files; only Android policy/Keystore use existing fictional ports.
public final class MessagePreviewNativeLedgerProbe {
    static final String PREFIX="0123456789abcdef", INSTALL="11111111111111111111111111111111";
    static final String EPOCH="11111111-1111-4111-8111-111111111111", USER="22222222-2222-4222-8222-222222222222";
    static final String SESSION="33333333-3333-4333-8333-333333333333", DEVICE="44444444-4444-4444-8444-444444444444";
    static final long MAX=9007199254740991L;
    static final MessagePreviewVaultFence.Context CONTEXT=new MessagePreviewVaultFence.Context(1,EPOCH,USER,SESSION,4);
    static final MessagePreviewVaultFence.Owner OWNER=new MessagePreviewVaultFence.Owner(USER,SESSION,DEVICE,4);
    static void need(boolean value,String code){if(!value)throw new AssertionError(code);}
    static String id(long revision){return PREFIX+String.format(Locale.ROOT,"%016x",revision);}
    static Object field(Object target,String name)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}
    static int size(Object target,String name)throws Exception{return ((Set<?>)field(target,name)).size();}
    static MessagePreviewVaultFence nativeFence(long gen,long rev,String durable,String prefix)throws Exception {
        Constructor<MessagePreviewVaultFence> c;
        try{c=MessagePreviewVaultFence.class.getDeclaredConstructor(long.class,long.class,String.class,String.class);}
        catch(NoSuchMethodException absent){throw new AssertionError("NATIVE_LEDGER_REQUIRED");}
        c.setAccessible(true);
        try{return c.newInstance(gen,rev,durable,prefix);}catch(InvocationTargetException e){throw (Exception)e.getCause();}
    }
    static MessagePreviewVaultFence fence()throws Exception{
        MessagePreviewVaultFence f=nativeFence(9,47,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",PREFIX);
        need(f.bindContext(CONTEXT),"NATIVE_CONTEXT");return f;
    }
    static void invalid(MessagePreviewVaultFence f,String operation,long revision,long generation,boolean begin)throws Exception{
        long g=(Long)field(f,"generation"),r=(Long)field(f,"vaultRevision");int n=size(f,"seenIds");Object old=field(f,"current");
        MessagePreviewVaultFence.Admission a=begin?f.begin(operation,revision,generation,CONTEXT,OWNER):f.retire(operation,revision,generation,null);
        need(a.operation==null&&a.decision!=MessagePreviewVaultFence.Decision.RESERVED,"NATIVE_INVALID_ID_REFUSED");
        need((Long)field(f,"generation")==g&&(Long)field(f,"vaultRevision")==r&&size(f,"seenIds")==n&&field(f,"current")==old,"NO_REJECTED_RESERVATION");
    }
    static void pure(String scenario)throws Exception{
        if(scenario.equals("legacy")){
            MessagePreviewVaultFence f=new MessagePreviewVaultFence(0);need(f.bindContext(CONTEXT),"LEGACY_CONTEXT");
            for(int i=1;i<=255;i++)need(f.begin(String.format(Locale.ROOT,"%032x",i),i,i-1,CONTEXT,OWNER).operation!=null,"LEGACY_255_BEGIN");
            need(f.begin(String.format(Locale.ROOT,"%032x",256),256,255,CONTEXT,OWNER).decision==MessagePreviewVaultFence.Decision.EXHAUSTED,"LEGACY_ERASURE_SLOT");
            need(f.retire(String.format(Locale.ROOT,"%032x",256),256,255,null).operation!=null,"LEGACY_256_RETIRE");
            need(f.retire(String.format(Locale.ROOT,"%032x",257),257,256,null).decision==MessagePreviewVaultFence.Decision.EXHAUSTED&&size(f,"seenIds")==256,"LEGACY_STAYS_BOUNDED");return;
        }
        if(scenario.equals("construct")){
            for(String prefix:new String[]{null,"",PREFIX+"0",PREFIX.substring(1),"0123456789abcdeF","0123456789abcdeg"}){
                boolean refused=false;try{nativeFence(9,47,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",prefix);}catch(IllegalArgumentException expected){refused=true;}need(refused,"EXACT_NATIVE_PREFIX");
            }
            for(long bad:new long[]{-1,MAX+1}){boolean refused=false;try{nativeFence(9,bad,id(1),PREFIX);}catch(IllegalArgumentException e){refused=true;}need(refused,"SAFE_DURABLE_REVISION");}
            for(Object[] bad:new Object[][]{{0L,1L,id(1)},{0L,0L,id(0)},{9L,47L,""},{-1L,47L,id(47)},{MAX+1,47L,id(47)}}){
                boolean refused=false;try{nativeFence((Long)bad[0],(Long)bad[1],(String)bad[2],PREFIX);}catch(IllegalArgumentException e){refused=true;}
                need(refused,"EXACT_NATIVE_DURABLE_SHAPE");
            }
            MessagePreviewVaultFence g0=nativeFence(0,0,"",PREFIX);need(g0.bindContext(CONTEXT),"G0_CONTEXT");
            need(g0.begin(id(1),1,0,CONTEXT,OWNER).operation!=null&&size(g0,"seenIds")==0,"NATIVE_G0_NO_REPLAY_SET");return;
        }
        MessagePreviewVaultFence f=fence();
        if(scenario.equals("many")){
            long gen=9;
            for(long rev=48;rev<1248;rev++){
                MessagePreviewVaultFence.Admission a=rev%2==0?f.begin(id(rev),rev,gen,CONTEXT,OWNER):f.retire(id(rev),rev,gen,null);
                need(a.decision==MessagePreviewVaultFence.Decision.RESERVED&&a.operation!=null,"NATIVE_OVER_512_ADMISSIONS");
                need(a.operation.generation==++gen&&a.operation.vaultRevision==rev&&id(rev).equals(a.operation.operationId),"EXACT_NATIVE_GENERATION");
                need(f.complete(a.operation)&&!f.complete(a.operation),"NATIVE_ONE_USE_COMPLETION");
                need(size(f,"seenIds")==1,"NATIVE_CONSTANT_MEMORY");
            }
        }else if(scenario.equals("ids")){
            for(String wrong:new String[]{null,"",id(47),id(49),"fedcba98765432100000000000000030",id(48).toUpperCase(Locale.ROOT),"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}){
                invalid(f,wrong,48,9,true);invalid(f,wrong,48,9,false);
            }
            need(f.begin("0123456789abcdef0000000000000030",48,9,CONTEXT,OWNER).operation!=null,"LITERAL_NATIVE_ID_ADMITTED");
        }else if(scenario.equals("replay")){
            need(f.begin(id(48),48,9,CONTEXT,OWNER).operation!=null,"INITIAL_NATIVE_BEGIN");
            invalid(f,id(48),49,10,true);invalid(f,id(48),49,10,false);invalid(f,id(48),48,10,true);
            need(f.retire(id(49),49,10,null).operation!=null,"REPLAY_CANNOT_POISON_NEXT_ID");
        }else if(scenario.equals("collision")){
            f=nativeFence(9,47,id(48),PREFIX);need(f.bindContext(CONTEXT),"COLLISION_CONTEXT");
            invalid(f,id(48),48,9,true);invalid(f,id(48),48,9,false);
            need(f.begin(id(49),49,9,CONTEXT,OWNER).operation!=null,"LEGACY_HEAD_PIN_ONLY_NOT_BLOCK_ALL");
        }else if(scenario.equals("correlation")){
            MessagePreviewVaultFence.Operation begin=f.begin(id(48),48,9,CONTEXT,OWNER).operation;
            need(f.retire(id(49),49,9,new MessagePreviewVaultFence.Correlation(id(47),48)).operation==null,"NATIVE_CORRELATION_ID");
            need(f.retire(id(49),49,9,new MessagePreviewVaultFence.Correlation(id(48),47)).operation==null,"NATIVE_CORRELATION_REVISION");
            need(f.retire(id(49),49,8,new MessagePreviewVaultFence.Correlation(id(48),48)).operation==null,"NATIVE_CORRELATION_BASE");
            need(f.retire(id(49),49,9,new MessagePreviewVaultFence.Correlation(id(48),48)).operation!=null&&!f.complete(begin),"NATIVE_CORRELATED_RETIRE_ONLY");
        }else if(scenario.equals("refused")){
            MessagePreviewVaultFence.Admission a=f.begin(id(48),48,9,CONTEXT,null);
            need(a.decision==MessagePreviewVaultFence.Decision.INVALID_OWNER&&a.operation!=null&&!f.canContinue(a.operation)&&f.canErase(a.operation),"NATIVE_REFUSED_ERASURE_ONLY");
            need(f.retire(id(49),49,9,new MessagePreviewVaultFence.Correlation(id(48),48)).operation!=null,"NATIVE_REFUSED_CORRELATION");
        }else if(scenario.equals("pinned-headroom")){
            for(MessagePreviewVaultFence.Owner tuple:new MessagePreviewVaultFence.Owner[]{OWNER,null}){
                f=nativeFence(9,MAX-2,id(MAX),PREFIX);need(f.bindContext(CONTEXT),"PINNED_HEADROOM_CONTEXT");
                MessagePreviewVaultFence.Admission a=f.begin(id(MAX-1),MAX-1,9,CONTEXT,tuple);
                need(a.decision==MessagePreviewVaultFence.Decision.EXHAUSTED&&a.operation==null,"NATIVE_PINNED_REVISION_HEADROOM");
                need((Long)field(f,"generation")==9&&(Long)field(f,"vaultRevision")==MAX-2&&field(f,"current")==null
                    &&size(f,"seenIds")==1&&((Set<?>)field(f,"seenIds")).contains(id(MAX)),"PINNED_HEADROOM_NO_RESERVATION");
            }
        }else if(scenario.equals("pinned-headroom-skip")){
            f=nativeFence(9,MAX-3,id(MAX-1),PREFIX);need(f.bindContext(CONTEXT),"PINNED_SKIP_CONTEXT");
            MessagePreviewVaultFence.Operation begin=f.begin(id(MAX-2),MAX-2,9,CONTEXT,OWNER).operation;
            need(begin!=null&&begin.generation==10,"PINNED_SKIP_BEGIN_ADMITTED");
            invalid(f,id(MAX-1),MAX-1,10,false);
            MessagePreviewVaultFence.Admission erased=f.retire(id(MAX),MAX,9,new MessagePreviewVaultFence.Correlation(id(MAX-2),MAX-2));
            need(erased.decision==MessagePreviewVaultFence.Decision.RESERVED&&erased.operation!=null
                &&erased.operation.generation==11&&erased.operation.vaultRevision==MAX&&!f.canContinue(begin),"PINNED_SKIP_LAST_RETIRE");
            need(size(f,"seenIds")==1&&((Set<?>)field(f,"seenIds")).contains(id(MAX-1)),"PINNED_SKIP_REPLAY_PIN_PRESERVED");
        }else if(scenario.equals("bounds")){
            invalid(f,id(48),MAX+1,9,true);invalid(f,id(48),48,MAX+1,false);
            f=nativeFence(MAX-1,47,id(47),PREFIX);need(f.bindContext(CONTEXT),"LIMIT_CONTEXT");
            need(f.begin(id(48),48,MAX-1,CONTEXT,OWNER).decision==MessagePreviewVaultFence.Decision.EXHAUSTED,"NATIVE_BEGIN_HEADROOM");
            need(f.retire(id(MAX),MAX,MAX-1,null).operation!=null,"NATIVE_LAST_RETIRE");
            f=nativeFence(9,47,id(47),PREFIX);need(f.bindContext(CONTEXT),"REV_LIMIT_CONTEXT");
            need(f.begin(id(MAX),MAX,9,CONTEXT,OWNER).decision==MessagePreviewVaultFence.Decision.EXHAUSTED,"NATIVE_REVISION_HEADROOM");
            need(f.retire(id(MAX),MAX,9,null).operation!=null,"NATIVE_MAX_REVISION_RETIRE");
            f=nativeFence(MAX,47,id(47),PREFIX);
            need(f.retire(id(48),48,MAX,null).decision==MessagePreviewVaultFence.Decision.EXHAUSTED,"NATIVE_GENERATION_EXHAUSTION");
        }else throw new AssertionError("UNKNOWN_PURE_CASE");
    }
    static final class Authority implements MessagePreviewVaultProvisioning.Authority {
        int calls;boolean deny;
        public void requireCurrent(MessagePreviewVaultProvisioning.Identity identity){calls++;if(deny)throw new IllegalStateException();}
        public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,String access,long deadline){throw new AssertionError("NO_NETWORK_OR_VERIFY");}
    }
    static MessagePreviewPristineInitializer create(Application app,MessagePreviewVaultAdoptionProbe.Authority issuer,Authority auth,boolean nativeMode)throws Exception{
        if(!nativeMode)return MessagePreviewPristineInitializer.getOrCreate(app,issuer,auth);
        try{return (MessagePreviewPristineInitializer)MessagePreviewPristineInitializer.class.getDeclaredMethod("getOrCreateForSession",android.content.Context.class,
            MessagePreviewInitializationGate.ForegroundAuthority.class,MessagePreviewVaultProvisioning.Authority.class).invoke(null,app,issuer,auth);}
        catch(NoSuchMethodException absent){throw new AssertionError("NATIVE_OWNER_FACTORY_REQUIRED");}
        catch(InvocationTargetException e){throw (Exception)e.getCause();}
    }
    static String next(MessagePreviewPristineInitializer owner,long rev)throws Exception{
        try{return (String)MessagePreviewPristineInitializer.class.getDeclaredMethod("nextOperationId",long.class).invoke(owner,rev);}
        catch(NoSuchMethodException absent){throw new AssertionError("NATIVE_NEXT_ID_REQUIRED");}
        catch(InvocationTargetException e){throw (Exception)e.getCause();}
    }
    static boolean begin(MessagePreviewPristineInitializer owner,String id,long rev,long gen,MessagePreviewPristineInitializer.ProvisionCompletion cb)throws Exception{
        return begin(owner,id,rev,gen,OWNER,cb);
    }
    static boolean begin(MessagePreviewPristineInitializer owner,String id,long rev,long gen,MessagePreviewVaultFence.Owner tuple,MessagePreviewPristineInitializer.ProvisionCompletion cb)throws Exception{
        Method m=MessagePreviewPristineInitializer.class.getDeclaredMethod("beginOwned",String.class,long.class,long.class,MessagePreviewVaultFence.Context.class,
            MessagePreviewVaultFence.Owner.class,MessagePreviewPristineInitializer.ProvisionCompletion.class);
        need(m.getReturnType()==boolean.class,"BEGIN_ADMISSION_BOOLEAN_REQUIRED");
        return (Boolean)m.invoke(owner,id,rev,gen,CONTEXT,tuple,cb);
    }
    static void owner(String scenario,String path)throws Exception{
        Looper.getMainLooper();MessagePreviewExistingVaultProbe.setup(path);
        MessagePreviewExistingVaultProbe.write(MessagePreviewMetadataEnvelope.Kind.EMPTY,8,46,(byte)0);
        if(scenario.equals("owner-collision")){
            MessagePreviewMetadataEnvelope.Header h=new MessagePreviewMetadataEnvelope.Header(INSTALL,8,MessagePreviewMetadataEnvelope.Kind.EMPTY,"",0,1000,
                "1111111111111111000000000000002f",7,46);
            Files.write(MessagePreviewExistingVaultProbe.journal.toPath(),MessagePreviewMetadataEnvelope.seal(h,new byte[0],MessagePreviewExistingVaultProbe.KEY));
        }
        Security.removeProvider("AndroidKeyStore");Security.addProvider(new MessagePreviewVaultAdoptionProbe.RetireProvider());
        final MessagePreviewExistingVaultProbe.OwnedContext base=MessagePreviewExistingVaultProbe.context;
        Application app=new Application(){public android.content.Context getApplicationContext(){return this;}public boolean isDeviceProtectedStorage(){return false;}
            public File getNoBackupFilesDir(){return base.getNoBackupFilesDir();}public Object getSystemService(String n){return base.getSystemService(n);}
            public android.content.pm.ApplicationInfo getApplicationInfo(){return base.getApplicationInfo();}};
        MessagePreviewVaultAdoptionProbe.Authority issuer=new MessagePreviewVaultAdoptionProbe.Authority();Authority auth=new Authority();
        boolean legacy=scenario.equals("owner-legacy");MessagePreviewPristineInitializer owner=create(app,issuer,auth,!legacy);
        try{
            need(next(owner,47)==null,"NOT_LOADED_NO_NATIVE_ID");
            need(MessagePreviewVaultAdoptionProbe.load(owner).status==MessagePreviewPristineInitializer.Status.LOADED_EXISTING,"ACTUAL_OWNER_ADOPTION");
            int reads=AtomicFile.reads,writes=AtomicFile.starts;
            if(scenario.equals("owner-mode")||legacy){
                need(create(app,issuer,auth,!legacy)==owner,"SAME_REGISTERED_MODE_REUSED");
                boolean rejected=false;try{create(app,issuer,auth,legacy);}catch(MessagePreviewPristineInitializer.Unavailable expected){rejected=true;}
                need(rejected,"REGISTERED_MODE_MUST_MATCH");
                if(legacy)need(next(owner,47)==null,"LEGACY_HAS_NO_NATIVE_IDS");
            }else if(scenario.equals("owner-generator")){
                need("1111111111111111000000000000002f".equals(next(owner,47)),"LITERAL_INSTALLATION_REVISION_ID");
                need(next(owner,46)==null&&next(owner,-1)==null&&next(owner,MAX+1)==null,"GENERATOR_SAFE_FLOOR");
                String[] background={"not-called"};Thread t=new Thread(()->{try{background[0]=next(owner,47);}catch(Exception e){throw new AssertionError(e);}});t.start();t.join();
                need(background[0]==null,"GENERATOR_MAIN_ONLY");
                need(AtomicFile.reads==reads&&AtomicFile.starts==writes&&size(field(owner,"initialized"),"acceptedOperations")==1,"GENERATOR_NO_IO_OR_RESERVATION");
                owner.close();need(next(owner,47)==null,"CLOSED_NO_NATIVE_ID");
            }else if(scenario.equals("owner-two")){
                long gen=8;
                for(long rev=47;rev<=49;rev+=2){
                    CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> ack=new CompletableFuture<>();String op=next(owner,rev);
                    need(begin(owner,op,rev,gen,ack::complete),"ACTUAL_BEGIN_ADMITTED");
                    need(ack.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.PENDING,"ACTUAL_QUEUED_PENDING");gen++;
                    need(next(owner,rev)==null,"RESERVED_FLOOR_NOT_REUSED");
                    CompletableFuture<MessagePreviewPristineInitializer.TransitionResult> erased=new CompletableFuture<>();
                    owner.retireExact(next(owner,rev+1),rev+1,gen,null,erased::complete);
                    need(erased.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED,"ACTUAL_NATIVE_RETIREMENT");gen++;
                    need(size(field(owner,"initialized"),"acceptedOperations")==1&&size(field(field(owner,"initialized"),"fence"),"seenIds")==1,"OWNER_CONSTANT_MEMORY");
                }
                need((Long)field(field(owner,"initialized"),"acceptedVaultRevision")==50,"OWNER_REVISION_FLOOR_ADVANCES");
            }else if(scenario.equals("owner-refused")){
                need(!begin(owner,next(owner,47),47,8,null),"NULL_CALLBACK_NOT_ADMITTED");
                CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> ack=new CompletableFuture<>();
                need(!begin(owner,"cccccccccccccccccccccccccccccccc",47,8,ack::complete),"BAD_NATIVE_ID_NOT_ADMITTED");
                need(ack.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST,"BAD_NATIVE_ID_STATUS");
                need(field(field(owner,"initialized"),"boundContext")==null,"BAD_ID_BEFORE_CONTEXT_BIND");
                auth.deny=true;ack=new CompletableFuture<>();
                need(!begin(owner,next(owner,47),47,8,ack::complete),"AUTH_REFUSAL_NOT_ADMITTED");ack.get(4,TimeUnit.SECONDS);
                need(AtomicFile.reads==reads&&AtomicFile.starts==writes,"REFUSAL_NO_IO");
            }else if(scenario.equals("owner-collision")){
                need(next(owner,47)==null&&"11111111111111110000000000000030".equals(next(owner,48)),"OWNER_DURABLE_COLLISION_PIN");
                CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> ack=new CompletableFuture<>();
                need(!begin(owner,"1111111111111111000000000000002f",47,8,ack::complete),"DURABLE_COLLISION_NOT_ADMITTED");
                need(ack.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_REQUEST,"DURABLE_COLLISION_STATUS");
                need(AtomicFile.reads==reads&&AtomicFile.starts==writes,"DURABLE_COLLISION_NO_IO");
            }else if(scenario.equals("owner-rejections")){
                String valid=next(owner,47);
                for(long[] tuple:new long[][]{{47,7},{46,8},{MAX+1,8},{47,MAX+1}}){
                    CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> ack=new CompletableFuture<>();
                    need(!begin(owner,valid,tuple[0],tuple[1],ack::complete),"REJECTION_NOT_ADMITTED");ack.get(4,TimeUnit.SECONDS);
                }
                owner.close();CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> ack=new CompletableFuture<>();
                need(!begin(owner,valid,47,8,ack::complete),"CLOSED_NOT_ADMITTED");ack.get(4,TimeUnit.SECONDS);
                need(AtomicFile.reads==reads&&AtomicFile.starts==writes,"REJECTION_NO_IO");
            }else if(scenario.equals("owner-invalid-owner")){
                CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> ack=new CompletableFuture<>();
                need(begin(owner,next(owner,47),47,8,null,ack::complete),"ERASURE_ONLY_ADMISSION_TRUE");
                need(ack.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.INVALID_OWNER,"ERASURE_ONLY_NOT_AUTHORIZED");
                need(size(field(owner,"initialized"),"acceptedOperations")==1,"REFUSED_OWNER_CONSTANT_MEMORY");
            }else throw new AssertionError("UNKNOWN_OWNER_CASE");
        }finally{owner.close();}
    }
    public static void main(String[] args){try{if(args[0].startsWith("owner-"))owner(args[0],args[1]);else pure(args[0]);System.out.println("PASS "+args[0]);}
        catch(Throwable e){System.err.println("FAIL "+(e instanceof AssertionError?e.getMessage():"UNEXPECTED"));System.exit(1);}}
}
