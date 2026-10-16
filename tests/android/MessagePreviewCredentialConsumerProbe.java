package com.kub.messenger;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Actual JVM/JCA with fictional credentials only, not Keystore/current-head authority. */
public final class MessagePreviewCredentialConsumerProbe {
    static final String INSTALL="11111111111111111111111111111111", OP="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    static final String USER="11111111-1111-1111-1111-111111111111", SESSION="22222222-2222-2222-2222-222222222222";
    static final String DEVICE="33333333-3333-3333-3333-333333333333", ACCESS="fictional.borrowed.access";
    static final long EXPIRY=123456789;
    static final SecretKey KEY=new SecretKeySpec(new byte[32],"AES"), META=new SecretKeySpec(fill(32,9),"AES");
    static void check(boolean value,String code){if(!value)throw new AssertionError(code);}
    static byte[] fill(int length,int value){byte[] bytes=new byte[length];Arrays.fill(bytes,(byte)value);return bytes;}
    static MessagePreviewMetadataEnvelope.Header header(){return new MessagePreviewMetadataEnvelope.Header(INSTALL,2,
        MessagePreviewMetadataEnvelope.Kind.COMMITTED,"letscube.nmpv.credential.v1."+INSTALL+".33333333333333333333333333333333",EXPIRY,17,OP,1,7);}
    static MessagePreviewVaultFence.Owner owner(){return new MessagePreviewVaultFence.Owner(USER,SESSION,DEVICE,4);}
    static MessagePreviewMetadataEnvelope.Record record(MessagePreviewMetadataEnvelope.Header h,byte[] blob)throws Exception{
        byte[] outer=MessagePreviewMetadataEnvelope.seal(h,blob,META);
        return MessagePreviewMetadataEnvelope.open(outer,h.installation,META);
    }
    static void text(DataOutputStream out,String value)throws Exception{out.writeShort(value.length());out.write(value.getBytes(StandardCharsets.US_ASCII));}
    // Independent literal serializer. Encryption/authentication is real SunJCE, not a cipher stub.
    static byte[] external(byte[] plain,MessagePreviewMetadataEnvelope.Header h,String domain)throws Exception{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);
        out.writeInt(1);text(out,h.installation);out.writeLong(h.generation);out.writeByte(2);text(out,h.alias);
        out.writeLong(h.expiresWallMillis);out.writeLong(h.wallHighWaterMillis);text(out,h.operationId);out.writeLong(h.baseGeneration);out.writeLong(h.vaultRevision);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding","SunJCE");cipher.init(Cipher.ENCRYPT_MODE,KEY);
        cipher.updateAAD(domain.getBytes(StandardCharsets.US_ASCII));cipher.updateAAD(bytes.toByteArray());byte[] encrypted=cipher.doFinal(plain);
        return ByteBuffer.allocate(12+encrypted.length).put(cipher.getIV()).put(encrypted).array();
    }
    static byte[] plain(String access)throws Exception{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);
        out.writeInt(1);out.writeInt(access.length());out.write(access.getBytes(StandardCharsets.US_ASCII));
        out.write(USER.getBytes(StandardCharsets.US_ASCII));out.write(SESSION.getBytes(StandardCharsets.US_ASCII));out.write(DEVICE.getBytes(StandardCharsets.US_ASCII));
        out.writeLong(4);out.writeLong(EXPIRY);return bytes.toByteArray();
    }
    interface Callback {void accept(MessagePreviewVaultFence.Owner owner,byte[] access,long expiry);}
    static void consume(MessagePreviewMetadataEnvelope.Record record,MessagePreviewMetadataEnvelope.Header expected,SecretKey key,Callback callback)throws Exception{
        Class<?> consumer;Method method;
        try{
            consumer=Class.forName("com.kub.messenger.MessagePreviewCredentialEnvelope$Consumer");
            method=MessagePreviewCredentialEnvelope.class.getDeclaredMethod("consume",MessagePreviewMetadataEnvelope.Record.class,
                MessagePreviewMetadataEnvelope.Header.class,SecretKey.class,consumer);
        }catch(ClassNotFoundException|NoSuchMethodException missing){throw new AssertionError("NATIVE_CREDENTIAL_CONSUMER_REQUIRED");}
        check(method.getReturnType()==void.class&&!Modifier.isPublic(method.getModifiers())&&!Modifier.isPublic(consumer.getModifiers()),"NATIVE_VOID_ONLY_SCOPE");
        Object borrowed=callback==null?null:Proxy.newProxyInstance(consumer.getClassLoader(),new Class<?>[]{consumer},(proxy,m,args)->{
            check(m.getName().equals("accept")&&args.length==3,"CALLBACK_SIGNATURE");
            callback.accept((MessagePreviewVaultFence.Owner)args[0],(byte[])args[1],(Long)args[2]);return null;
        });
        try{method.invoke(null,record,expected,key,borrowed);}
        catch(InvocationTargetException failure){
            if(failure.getCause() instanceof Exception)throw (Exception)failure.getCause();
            if(failure.getCause() instanceof Error)throw (Error)failure.getCause();throw failure;
        }
    }
    static boolean zero(byte[] bytes){if(bytes==null)return false;for(byte value:bytes)if(value!=0)return false;return true;}
    static void privacy(MessagePreviewCredentialEnvelope.Unavailable failure){
        check("UNAVAILABLE".equals(failure.getMessage())&&failure.getCause()==null&&failure.getStackTrace().length==0
            &&failure.getSuppressed().length==0,"FIXED_REFUSAL_PRIVACY");
    }
    static void healthy(String scenario)throws Exception{
        String access=scenario.equals("minimum")?"!":scenario.equals("maximum")?"x".repeat(8192):ACCESS;
        byte[] blob=MessagePreviewCredentialEnvelope.seal(header(),owner(),access,EXPIRY,KEY);
        MessagePreviewMetadataEnvelope.Record record=record(header(),blob);byte[] unchanged=record.credentialBytes();
        MessagePreviewCredentialEnvelopeProbe.CountProvider provider=new MessagePreviewCredentialEnvelopeProbe.CountProvider();
        Security.insertProviderAt(provider,1);
        byte[][] retained={null};int[] calls={0};RuntimeException expected=new IllegalStateException("fictional callback uncertainty");
        Error expectedError=new AssertionError("FICTIONAL_CALLBACK_ERROR");
        try{
            Callback callback=(actual,borrowed,expiry)->{
                calls[0]++;retained[0]=borrowed;
                check(USER.equals(actual.recipient)&&SESSION.equals(actual.session)&&DEVICE.equals(actual.device)&&actual.accountEpoch==4,"EXACT_DECODED_OWNER");
                check(expiry==123456789&&Arrays.equals(borrowed,access.getBytes(StandardCharsets.US_ASCII)),"VALID_BORROWED_ACCESS");
                check(!zero(MessagePreviewCredentialEnvelopeProbe.CountCipher.outputReference),"LIVE_PLAINTEXT_CONTROL");
                if(scenario.equals("callback-throw"))throw expected;
                if(scenario.equals("callback-error"))throw expectedError;
                if(scenario.equals("borrower-write"))Arrays.fill(borrowed,(byte)7);
            };
            try{consume(record,header(),KEY,callback);check(!scenario.equals("callback-throw")&&!scenario.equals("callback-error"),"CALLBACK_FAILURE_REQUIRED");}
            catch(MessagePreviewCredentialEnvelope.Unavailable failure){throw new AssertionError("CALLBACK_NOT_MISLABELLED_UNAVAILABLE");}
            catch(RuntimeException failure){check(scenario.equals("callback-throw")&&failure==expected,"CALLBACK_RUNTIME_PROPAGATED_UNCHANGED");}
            catch(Error failure){if(!scenario.equals("callback-error"))throw failure;check(failure==expectedError,"CALLBACK_ERROR_PROPAGATED_UNCHANGED");}
            check(calls[0]==1,"ONE_CALLBACK");
            check(zero(retained[0]),"BORROWED_ACCESS_SCRUBBED");
            check(zero(MessagePreviewCredentialEnvelopeProbe.CountCipher.inputReference)
                &&zero(MessagePreviewCredentialEnvelopeProbe.CountCipher.outputReference)
                &&zero(MessagePreviewCredentialEnvelopeProbe.CountCipher.aadReference),"DECRYPT_TEMPORARIES_SCRUBBED");
            check(Arrays.equals(record.credentialBytes(),unchanged),"RECORD_CIPHERTEXT_UNCHANGED");
            if(scenario.equals("repeat")){
                byte[] first=retained[0];consume(record,header(),KEY,callback);
                check(calls[0]==2&&first!=retained[0]&&zero(first)&&zero(retained[0]),"DISTINCT_BORROWED_SCOPES");
            }
        }finally{Security.removeProvider(provider.getName());}
    }
    static MessagePreviewMetadataEnvelope.Header changed(String field){
        var h=header();String installation=field.equals("installation")?"22222222222222222222222222222222":h.installation;
        return new MessagePreviewMetadataEnvelope.Header(installation,field.equals("generation")||field.equals("base")?3:h.generation,
            field.equals("kind")?MessagePreviewMetadataEnvelope.Kind.RETIRING:h.kind,
            field.equals("installation")?h.alias.replace(INSTALL,installation):field.equals("alias")?h.alias.replace(".33333333333333333333333333333333",".44444444444444444444444444444444"):h.alias,
            field.equals("expiry")?h.expiresWallMillis+1:h.expiresWallMillis,field.equals("wall")?18:h.wallHighWaterMillis,
            field.equals("operation")?"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb":h.operationId,
            field.equals("generation")||field.equals("base")?2:h.baseGeneration,field.equals("revision")?8:h.vaultRevision);
    }
    static void refusal(String scenario)throws Exception{
        byte[] plaintext=plain(ACCESS),blob;var expected=header();var recordHeader=header();SecretKey key=KEY;
        if(scenario.startsWith("header-"))expected=changed(scenario.substring(7));
        if(scenario.startsWith("decode-")){
            String field=scenario.substring(7);ByteBuffer frame=ByteBuffer.wrap(plaintext);
            switch(field){
                case "version":frame.putInt(0,2);break;
                case "length":frame.putInt(4,ACCESS.length()+1);break;
                case "empty":frame.putInt(4,0);break;
                case "oversize":frame.putInt(4,8193);break;
                case "control":plaintext[8]=32;break;
                case "high-byte":plaintext[8]=(byte)128;break;
                case "recipient":plaintext[8+ACCESS.length()]='Z';break;
                case "session":plaintext[8+ACCESS.length()+36]='Z';break;
                case "device":plaintext[8+ACCESS.length()+72]='Z';break;
                case "epoch":frame.putLong(plaintext.length-16,9007199254740992L);break;
                case "expiry":frame.putLong(plaintext.length-8,9007199254740992L);break;
                case "expiry-zero":frame.putLong(plaintext.length-8,0);break;
                case "expiry-header":frame.putLong(plaintext.length-8,EXPIRY+1);break;
                case "trailing":plaintext=Arrays.copyOf(plaintext,plaintext.length+1);break;
                default:throw new AssertionError("UNKNOWN_DECODE_CASE");
            }
        }
        blob=external(plaintext,recordHeader,scenario.equals("domain")?"FOREIGN-CREDENTIAL-DOMAIN":"LETSCUBE-NMPV-CREDENTIAL-v1");
        Arrays.fill(plaintext,(byte)0);
        if(scenario.equals("iv"))blob[0]^=1;
        if(scenario.equals("tag"))blob[blob.length-1]^=1;
        if(scenario.equals("ciphertext"))blob[12]^=1;
        if(scenario.equals("short"))blob=new byte[160];
        if(scenario.equals("oversize"))blob=new byte[8353];
        if(scenario.equals("wrong-key"))key=new SecretKeySpec(fill(32,8),"AES");
        if(scenario.equals("null-key"))key=null;
        if(scenario.equals("wrong-algorithm"))key=new SecretKeySpec(fill(32,8),"DES");
        MessagePreviewMetadataEnvelope.Record record=record(recordHeader,blob);
        if(scenario.equals("null-record"))record=null;
        if(scenario.equals("null-header"))expected=null;
        MessagePreviewCredentialEnvelopeProbe.CountProvider provider=new MessagePreviewCredentialEnvelopeProbe.CountProvider();
        Security.insertProviderAt(provider,1);int[] calls={0};boolean rejected=false;
        try{
            if(scenario.equals("provider-tag"))MessagePreviewCredentialEnvelopeProbe.CountCipher.bits=96;
            if(scenario.equals("provider-iv"))MessagePreviewCredentialEnvelopeProbe.CountCipher.ivLength=13;
            try{consume(record,expected,key,scenario.equals("null-consumer")?null:(o,a,e)->calls[0]++);}
            catch(MessagePreviewCredentialEnvelope.Unavailable failure){privacy(failure);rejected=true;}
            check(rejected&&calls[0]==0,"CONSUMER_REFUSAL_REQUIRED");
            if(scenario.startsWith("header-")||scenario.startsWith("null-")||scenario.equals("wrong-algorithm")
                ||scenario.equals("short")||scenario.equals("oversize"))check(MessagePreviewCredentialEnvelopeProbe.CountCipher.entries==0,"REFUSAL_BEFORE_PROVIDER");
            if(scenario.startsWith("decode-"))check(zero(MessagePreviewCredentialEnvelopeProbe.CountCipher.outputReference),"INVALID_PLAINTEXT_SCRUBBED");
        }finally{Security.removeProvider(provider.getName());}
    }
    public static void main(String[] args){
        try{
            String scenario=args[0];
            if(Arrays.asList("current","minimum","maximum","callback-throw","callback-error","borrower-write","repeat").contains(scenario))healthy(scenario);
            else refusal(scenario);
            System.out.println("PASS "+scenario);
        }catch(Throwable failure){String code=failure instanceof AssertionError?failure.getMessage():null;
            System.err.println("FAIL "+(code!=null&&code.matches("[A-Z0-9_]+")?code:"UNEXPECTED_FAILURE"));System.exit(1);}
    }
}
