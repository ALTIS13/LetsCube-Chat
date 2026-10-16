package com.kub.messenger;

import android.app.Application;
import android.os.Looper;
import android.system.Os;
import android.util.AtomicFile;
import java.io.File;
import java.nio.file.Files;
import java.security.Security;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

// Real owner/Fence/JCA/files, existing fictional Android policy and Keystore provider.
// A raw authenticated head is retirement-only, never a credential or consent grant.
public final class MessagePreviewNativeRecoveryProbe {
    static final String INSTALL=MessagePreviewExistingVaultProbe.INSTALL;
    static final String ALIAS=MessagePreviewExistingVaultProbe.ALIAS;
    static final String RETIRE="11111111111111110000000000000030";
    static final MessagePreviewVaultFence.Context CAPTURED=new MessagePreviewVaultFence.Context(1,
        "11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",4);
    static final MessagePreviewVaultFence.Owner TUPLE=new MessagePreviewVaultFence.Owner(CAPTURED.recipient,CAPTURED.session,
        "44444444-4444-4444-8444-444444444444",4);
    static void need(boolean yes,String code){if(!yes)throw new AssertionError(code);}
    static byte[] bytes()throws Exception{return Files.readAllBytes(MessagePreviewExistingVaultProbe.journal.toPath());}
    static MessagePreviewMetadataEnvelope.Record record()throws Exception{
        return MessagePreviewMetadataEnvelope.open(bytes(),INSTALL,MessagePreviewExistingVaultProbe.KEY);
    }
    static final class Authority implements MessagePreviewVaultProvisioning.Authority {
        public void requireCurrent(MessagePreviewVaultProvisioning.Identity identity){}
        public MessagePreviewVaultProvisioning.Verification verify(MessagePreviewVaultProvisioning.Identity identity,String access,long deadline){throw new AssertionError("NO_VERIFY_OR_CREDENTIAL_USE");}
    }
    static MessagePreviewPristineInitializer.InitResult initialize(MessagePreviewPristineInitializer owner)throws Exception{
        CompletableFuture<MessagePreviewPristineInitializer.InitResult> result=new CompletableFuture<>();owner.initializeExplicit(result::complete);return result.get(4,TimeUnit.SECONDS);
    }
    static MessagePreviewPristineInitializer.TransitionResult retire(MessagePreviewPristineInitializer owner)throws Exception{
        CompletableFuture<MessagePreviewPristineInitializer.TransitionResult> result=new CompletableFuture<>();
        owner.retireExact(RETIRE,48,9,null,result::complete);return result.get(4,TimeUnit.SECONDS);
    }
    static void noWrites(byte[] before,String code)throws Exception{
        need(Arrays.equals(before,bytes())&&AtomicFile.starts==0&&AtomicFile.finishes==0&&MessagePreviewVaultAdoptionProbe.deleted==0,code);
        need(MessagePreviewExistingVaultProbe.mutations==0,"NO_KEY_MINT_OR_RESET");
    }
    static void noEligibility(MessagePreviewPristineInitializer owner,byte[] before)throws Exception{
        CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> begin=new CompletableFuture<>();
        need(!owner.beginOwned(RETIRE,48,9,CAPTURED,TUPLE,begin::complete),"RAW_HEAD_NO_BEGIN_ADMISSION");
        MessagePreviewPristineInitializer.ProvisionResult refused=begin.get(4,TimeUnit.SECONDS);
        need(refused.status==MessagePreviewPristineInitializer.ProvisionStatus.UNAVAILABLE&&refused.ticket==null&&refused.expiresAt==null,"RAW_HEAD_NO_TICKET_OR_CREDENTIAL");
        CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> provision=new CompletableFuture<>();
        owner.provisionExact(MessagePreviewExistingVaultProbe.OP,"fictional-ticket","fictional-access",provision::complete);
        need(provision.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.UNKNOWN,"NO_RECONSTRUCTED_ACQUISITION");
        need(initialize(owner).status==MessagePreviewPristineInitializer.Status.UNAVAILABLE,"NO_PRISTINE_RESET_OF_RAW_HEAD");
        noWrites(before,"RAW_ADOPTION_READ_ONLY");
    }
    static void run(String scenario,String path)throws Exception{
        Looper.getMainLooper();MessagePreviewExistingVaultProbe.setup(path);
        MessagePreviewMetadataEnvelope.Kind kind=scenario.startsWith("retiring")||scenario.equals("legacy-retiring")
            ?MessagePreviewMetadataEnvelope.Kind.RETIRING:MessagePreviewMetadataEnvelope.Kind.PENDING;
        if(scenario.equals("committed"))kind=MessagePreviewMetadataEnvelope.Kind.COMMITTED;
        if(scenario.equals("empty")||scenario.equals("owned-pending-replace"))kind=MessagePreviewMetadataEnvelope.Kind.EMPTY;
        MessagePreviewExistingVaultProbe.write(kind,9,47,(byte)1);
        Security.removeProvider("AndroidKeyStore");Security.addProvider(new MessagePreviewVaultAdoptionProbe.RetireProvider());
        MessagePreviewExistingVaultProbe.keys.put(ALIAS,MessagePreviewExistingVaultProbe.KEY);
        if(scenario.equals("owned-pending-replace"))MessagePreviewExistingVaultProbe.keys.remove(ALIAS);
        if(scenario.equals("retiring-no-key"))MessagePreviewExistingVaultProbe.keys.remove(ALIAS);
        if(scenario.equals("retiring-empty-alias")){
            MessagePreviewMetadataEnvelope.Header h=new MessagePreviewMetadataEnvelope.Header(INSTALL,9,kind,"",0,1000,MessagePreviewExistingVaultProbe.OP,8,47);
            Files.write(MessagePreviewExistingVaultProbe.journal.toPath(),MessagePreviewMetadataEnvelope.seal(h,new byte[0],MessagePreviewExistingVaultProbe.KEY));
            MessagePreviewExistingVaultProbe.keys.remove(ALIAS);
        }
        if(scenario.equals("metadata-missing"))MessagePreviewExistingVaultProbe.keys.remove("letscube.nmpv.metadata.v1."+INSTALL);
        if(scenario.equals("all-keys-missing"))MessagePreviewExistingVaultProbe.keys.clear();
        if(scenario.equals("corrupt")){byte[] b=bytes();b[b.length-1]^=1;Files.write(MessagePreviewExistingVaultProbe.journal.toPath(),b);}
        if(scenario.equals("missing-marker"))Files.delete(MessagePreviewExistingVaultProbe.marker.toPath());
        if(scenario.equals("unknown-namespace"))Os.modes.put(MessagePreviewExistingVaultProbe.namespace.getPath(),0755);
        byte[] before=bytes();byte[] marker=MessagePreviewExistingVaultProbe.marker.exists()?Files.readAllBytes(MessagePreviewExistingVaultProbe.marker.toPath()):null;
        boolean[] replaced={false};
        if(scenario.equals("reader-identity"))Os.onEvent=e->{
            if(!replaced[0]&&AtomicFile.reads==1&&e.equals("lstat:journal-v1.bin")){
                replaced[0]=true;Os.replaceIdentity(MessagePreviewExistingVaultProbe.namespace.getPath());
            }
        };
        final MessagePreviewExistingVaultProbe.OwnedContext base=MessagePreviewExistingVaultProbe.context;
        Application app=new Application(){public android.content.Context getApplicationContext(){return this;}public boolean isDeviceProtectedStorage(){return false;}
            public File getNoBackupFilesDir(){return base.getNoBackupFilesDir();}public Object getSystemService(String n){return base.getSystemService(n);}
            public android.content.pm.ApplicationInfo getApplicationInfo(){return base.getApplicationInfo();}};
        MessagePreviewVaultAdoptionProbe.Authority issuer=new MessagePreviewVaultAdoptionProbe.Authority();Authority auth=new Authority();
        MessagePreviewPristineInitializer owner=scenario.startsWith("legacy-")?MessagePreviewPristineInitializer.getOrCreate(app,issuer,auth)
            :MessagePreviewPristineInitializer.getOrCreateForSession(app,issuer,auth);
        try{
            MessagePreviewPristineInitializer.InitResult loaded=MessagePreviewVaultAdoptionProbe.load(owner);
            boolean refusal=Arrays.asList("legacy-pending","legacy-retiring","metadata-missing","all-keys-missing","corrupt","missing-marker","unknown-namespace","reader-identity").contains(scenario);
            if(refusal){
                if(scenario.equals("reader-identity"))need(replaced[0],"ACTUAL_READER_IDENTITY_CHANGED");
                need(loaded.status==MessagePreviewPristineInitializer.Status.UNAVAILABLE&&loaded.generation==null&&loaded.vaultRevision==null,"UNTRUSTED_OR_LEGACY_RAW_REFUSED");
                need(initialize(owner).status==MessagePreviewPristineInitializer.Status.UNAVAILABLE,"FAILED_LOAD_NEVER_PRISTINE_RESET");
                noWrites(before,"REFUSAL_WITHOUT_EFFECTS");return;
            }
            boolean settled=scenario.equals("committed")||scenario.equals("empty")||scenario.equals("owned-pending-replace");
            need((settled?"LOADED_EXISTING":"LOADED_FOR_RETIREMENT").equals(loaded.status.name())&&loaded.generation==9L&&loaded.vaultRevision==47L,"EXPLICIT_RAW_RETIRE_ONLY_ADOPTION");
            need(Arrays.equals(marker,Files.readAllBytes(MessagePreviewExistingVaultProbe.marker.toPath())),"MARKER_NOT_REPLACED");
            noWrites(before,"LOAD_NEVER_REWRITES_RAW_HEAD");
            if(settled){
                if(scenario.equals("owned-pending-replace"))for(long rev=48;rev<=49;rev++){
                    CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> begun=new CompletableFuture<>();
                    need(owner.beginOwned(owner.nextOperationId(rev),rev,rev-39,CAPTURED,TUPLE,begun::complete),"OWNED_PENDING_CAN_REPLACE");
                    need(begun.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.PENDING,"OWNED_PENDING_REPLACEMENT_ACK");
                }
                return;
            }
            noEligibility(owner,before);
            need(RETIRE.equals(owner.nextOperationId(48)),"RAW_DURABLE_REVISION_FLOOR");
            if(scenario.endsWith("-load"))return;
            if(scenario.equals("stale-head")){
                MessagePreviewExistingVaultProbe.write(kind,10,48,(byte)0);before=bytes();
                need(retire(owner).status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE,"FRESH_RAW_HEAD_REQUIRED");
                noWrites(before,"STALE_HEAD_NO_ERASURE");return;
            }
            if(scenario.equals("metadata-lost-after-load")){
                MessagePreviewExistingVaultProbe.keys.remove("letscube.nmpv.metadata.v1."+INSTALL);
                need(retire(owner).status==MessagePreviewPristineInitializer.TransitionStatus.INCOMPLETE,"CURRENT_METADATA_REQUIRED");
                noWrites(before,"KEY_LOSS_NO_ERASURE");return;
            }
            MessagePreviewPristineInitializer.TransitionResult result=retire(owner);
            need(result.status==MessagePreviewPristineInitializer.TransitionStatus.RETIRED&&result.generation==10L,"EXPLICIT_RAW_RETIREMENT_COMPLETES");
            MessagePreviewMetadataEnvelope.Header h=record().header;
            need(h.kind==MessagePreviewMetadataEnvelope.Kind.EMPTY&&h.generation==10&&h.baseGeneration==9&&h.vaultRevision==48&&RETIRE.equals(h.operationId)
                &&h.alias.isEmpty()&&h.expiresWallMillis==0&&record().credentialBytes().length==0,"EXACT_G10_V48_EMPTY_READBACK");
            boolean noKey=scenario.equals("retiring-no-key")||scenario.equals("retiring-empty-alias");
            need(MessagePreviewVaultAdoptionProbe.deleted==(noKey?0:1)&&!MessagePreviewExistingVaultProbe.keys.containsKey(ALIAS),"EXACT_ALIAS_DELETED_ONCE");
            need(MessagePreviewExistingVaultProbe.keys.containsKey("letscube.nmpv.metadata.v1."+INSTALL)&&MessagePreviewExistingVaultProbe.mutations==0,"METADATA_KEY_PRESERVED_NO_MINT");
            CompletableFuture<MessagePreviewPristineInitializer.ProvisionResult> next=new CompletableFuture<>();
            need(owner.beginOwned(owner.nextOperationId(49),49,10,CAPTURED,TUPLE,next::complete),"BEGIN_ONLY_AFTER_EXPLICIT_RETIREMENT");
            need(next.get(4,TimeUnit.SECONDS).status==MessagePreviewPristineInitializer.ProvisionStatus.PENDING,"FRESH_BEGIN_AFTER_RECOVERY");
        }finally{owner.close();Os.onEvent=null;}
    }
    public static void main(String[] args){try{run(args[0],args[1]);System.out.println("PASS "+args[0]);}
        catch(Throwable error){System.err.println("FAIL "+(error instanceof AssertionError?error.getMessage():"UNEXPECTED"));System.exit(1);}}
}
