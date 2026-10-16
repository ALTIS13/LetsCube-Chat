package com.kub.messenger;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.AlgorithmParameterSpec;
import java.util.Arrays;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

// Isolated JVM/JCA fixture, fictional inputs only. No Android/Keystore/live credential authority.
public final class MessagePreviewCredentialEnvelopeProbe {
    private static final String INSTALL = "11111111111111111111111111111111";
    private static final String OP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String USER = "11111111-1111-1111-1111-111111111111";
    private static final String SESSION = "22222222-2222-2222-2222-222222222222";
    private static final String DEVICE = "33333333-3333-3333-3333-333333333333";
    private static final String OTHER = "44444444-4444-4444-4444-444444444444";
    private static final String ACCESS = "fictional.access-only";
    private static final long EXPIRY = 123456789, WALL = 17;
    private static final SecretKey KEY = new SecretKeySpec(new byte[32], "AES");
    private static final SecretKey META = new SecretKeySpec(fill(32, 9), "AES");
    private static byte[] fill(int n,int value) { byte[] bytes = new byte[n]; Arrays.fill(bytes,(byte)value); return bytes; }
    private static void check(boolean value,String tag) { if (!value) throw new AssertionError(tag); }
    private static MessagePreviewMetadataEnvelope.Header header() {
        return new MessagePreviewMetadataEnvelope.Header(INSTALL, 2, MessagePreviewMetadataEnvelope.Kind.COMMITTED,
            "letscube.nmpv.credential.v1." + INSTALL + ".33333333333333333333333333333333", EXPIRY, WALL, OP, 1, 7);
    }
    private static MessagePreviewVaultFence.Owner owner() { return new MessagePreviewVaultFence.Owner(USER, SESSION, DEVICE, 4); }
    private static MessagePreviewMetadataEnvelope.Record record(MessagePreviewMetadataEnvelope.Header h,byte[] blob) throws Exception {
        byte[] outer = MessagePreviewMetadataEnvelope.seal(h, blob, META);
        check(outer.length <= 16384, "ONE_OUTER_BUDGET");
        return MessagePreviewMetadataEnvelope.open(outer, h.installation, META);
    }
    private static void text(DataOutputStream output,String value) throws Exception {
        byte[] bytes = value.getBytes(StandardCharsets.US_ASCII); output.writeShort(bytes.length); output.write(bytes);
    }
    // Independent literal stream serializer, not the feature's AAD implementation/constants.
    private static byte[] aad(MessagePreviewMetadataEnvelope.Header h) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); DataOutputStream output = new DataOutputStream(bytes);
        output.writeInt(1); text(output,h.installation); output.writeLong(h.generation); output.writeByte(2); text(output,h.alias);
        output.writeLong(h.expiresWallMillis); output.writeLong(h.wallHighWaterMillis); text(output,h.operationId);
        output.writeLong(h.baseGeneration); output.writeLong(h.vaultRevision); return bytes.toByteArray();
    }
    private static byte[] plain(String access, MessagePreviewVaultFence.Owner owner,long expiry) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); DataOutputStream output = new DataOutputStream(bytes);
        output.writeInt(1); output.writeInt(access.length()); output.write(access.getBytes(StandardCharsets.US_ASCII));
        output.write(owner.recipient.getBytes(StandardCharsets.US_ASCII)); output.write(owner.session.getBytes(StandardCharsets.US_ASCII));
        output.write(owner.device.getBytes(StandardCharsets.US_ASCII)); output.writeLong(owner.accountEpoch); output.writeLong(expiry);
        return bytes.toByteArray();
    }
    private static byte[] externalSeal(byte[] plaintext,MessagePreviewMetadataEnvelope.Header h,String domain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding", "SunJCE"); cipher.init(Cipher.ENCRYPT_MODE, KEY);
        cipher.updateAAD(domain.getBytes(StandardCharsets.US_ASCII)); cipher.updateAAD(aad(h));
        byte[] encrypted = cipher.doFinal(plaintext), iv = cipher.getIV();
        return ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array();
    }
    private static void externalCheck(byte[] blob,MessagePreviewMetadataEnvelope.Header h,String access) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding", "SunJCE");
        cipher.init(Cipher.DECRYPT_MODE,KEY,new GCMParameterSpec(128,blob,0,12));
        cipher.updateAAD("LETSCUBE-NMPV-CREDENTIAL-v1".getBytes(StandardCharsets.US_ASCII)); cipher.updateAAD(aad(h));
        byte[] opened = null, expected = plain(access,owner(),EXPIRY);
        try {
            try { opened = cipher.doFinal(blob,12,blob.length-12); }
            catch (GeneralSecurityException unavailable) { throw new AssertionError("EXTERNAL_AAD_AUTH"); }
            check(Arrays.equals(opened,expected), "EXTERNAL_PLAIN_FRAME");
            check(opened.length == 132 + access.length() && blob.length == 132 + access.length() + 28, "LITERAL_FRAME_BOUNDS");
        } finally { if (opened != null) Arrays.fill(opened,(byte)0); Arrays.fill(expected,(byte)0); }
    }
    private interface Action { void run() throws Exception; }
    private static void unavailable(Action action,String oracle) throws Exception {
        boolean refused = false;
        try { action.run(); }
        catch (MessagePreviewCredentialEnvelope.Unavailable value) {
            check("UNAVAILABLE".equals(value.getMessage()) && value.getCause() == null && value.getStackTrace().length == 0
                && value.getSuppressed().length == 0, "FIXED_EXCEPTION_PRIVACY");
            value.addSuppressed(new Exception("FICTIONAL_NOT_EXPOSED")); check(value.getSuppressed().length == 0,"NO_SUPPRESSED");
            refused = true;
        }
        check(refused,oracle);
    }
    private static void healthy() throws Exception {
        byte[] blob = MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY);
        MessagePreviewMetadataEnvelope.Record record = record(header(),blob);
        check(MessagePreviewCredentialEnvelope.verifyMatch(record,header(),owner(),ACCESS,EXPIRY,KEY), "HEALTHY_MATCH");
        externalCheck(blob,header(),ACCESS);
    }
    private static MessagePreviewMetadataEnvelope.Header changed(String field) {
        MessagePreviewMetadataEnvelope.Header h = header();
        return new MessagePreviewMetadataEnvelope.Header(field.equals("installation") ? "22222222222222222222222222222222" : h.installation,
            field.equals("generation") || field.equals("base") ? 3 : h.generation,
            field.equals("kind") ? MessagePreviewMetadataEnvelope.Kind.RETIRING : h.kind,
            field.equals("installation") ? h.alias.replace(INSTALL,"22222222222222222222222222222222")
                : field.equals("alias") ? h.alias.replace(".33333333333333333333333333333333",".44444444444444444444444444444444") : h.alias,
            field.equals("expiry") ? h.expiresWallMillis + 1 : h.expiresWallMillis,
            field.equals("wall") ? h.wallHighWaterMillis + 1 : h.wallHighWaterMillis,
            field.equals("operation") ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" : h.operationId,
            field.equals("generation") || field.equals("base") ? 2 : h.baseGeneration,
            field.equals("revision") ? h.vaultRevision + 1 : h.vaultRevision);
    }
    private static void mismatch(String field) throws Exception {
        healthy(); final MessagePreviewMetadataEnvelope.Record r = record(header(),MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY));
        MessagePreviewVaultFence.Owner expected = new MessagePreviewVaultFence.Owner(field.equals("recipient") ? OTHER : USER,
            field.equals("session") ? OTHER : SESSION, field.equals("device") ? OTHER : DEVICE,field.equals("epoch") ? 5 : 4);
        MessagePreviewMetadataEnvelope.Header h = field.equals("expiry") ? changed("expiry") : header();
        check(!MessagePreviewCredentialEnvelope.verifyMatch(r,h,expected,field.equals("access") ? "other.fictional.access" : ACCESS,
            h.expiresWallMillis,KEY), "MATCH_" + field.toUpperCase());
    }
    private static void headerMismatch(String field) throws Exception {
        healthy(); final MessagePreviewMetadataEnvelope.Record r = record(header(),MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY));
        final MessagePreviewMetadataEnvelope.Header h = changed(field);
        if (field.equals("kind")) unavailable(new Action() { public void run() throws Exception {
            MessagePreviewCredentialEnvelope.verifyMatch(r,h,owner(),ACCESS,h.expiresWallMillis,KEY);
        }}, "MALFORMED_HEADER_MUST_REFUSE");
        else check(!MessagePreviewCredentialEnvelope.verifyMatch(r,h,owner(),ACCESS,h.expiresWallMillis,KEY),"HEADER_MISMATCH");
    }
    private static void tamper(String field) throws Exception {
        healthy(); byte[] blob = MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY);
        final MessagePreviewMetadataEnvelope.Header h = field.startsWith("aad-") ? changed(field.substring(4)) : header();
        if (field.equals("iv")) blob[0] ^= 1;
        if (field.equals("ciphertext")) blob[12] ^= 1;
        if (field.equals("tag")) blob[blob.length-1] ^= 1;
        if (field.equals("domain")) blob = externalSeal(plain(ACCESS,owner(),EXPIRY),h,"FOREIGN-CREDENTIAL-DOMAIN");
        final MessagePreviewMetadataEnvelope.Record r = record(h,blob);
        unavailable(new Action() { public void run() throws Exception {
            MessagePreviewCredentialEnvelope.verifyMatch(r,h,owner(),ACCESS,h.expiresWallMillis,
                field.equals("key") ? new SecretKeySpec(fill(32,8),"AES") : KEY);
        }}, "AUTHENTICATION_MUST_REFUSE");
    }
    private static void malformed(String field) throws Exception {
        healthy(); byte[] bytes = plain(ACCESS,owner(),EXPIRY); ByteBuffer input = ByteBuffer.wrap(bytes);
        if (field.equals("version")) input.putInt(0,2);
        if (field.equals("length")) input.putInt(4,ACCESS.length()+1);
        if (field.equals("control")) bytes[8] = 32;
        if (field.equals("uuid")) bytes[8+ACCESS.length()] = 'Z';
        if (field.equals("epoch")) input.putLong(bytes.length-16,9007199254740992L);
        if (field.equals("expiry")) input.putLong(bytes.length-8,9007199254740992L);
        if (field.equals("expiry-header")) input.putLong(bytes.length-8,EXPIRY+1);
        if (field.equals("trailing")) bytes = Arrays.copyOf(bytes,bytes.length+1);
        final MessagePreviewMetadataEnvelope.Record r;
        try { r = record(header(),externalSeal(bytes,header(),"LETSCUBE-NMPV-CREDENTIAL-v1")); }
        finally { Arrays.fill(bytes,(byte)0); }
        unavailable(new Action() { public void run() throws Exception {
            MessagePreviewCredentialEnvelope.verifyMatch(r,header(),owner(),ACCESS,EXPIRY,KEY);
        }},"DECODE_MUST_REFUSE");
    }
    public static final class CountProvider extends Provider {
        private static final long serialVersionUID = 1L;
        public CountProvider() { super("NmpvCount", "1.0", "FICTIONAL SOURCE PROVIDER"); put("Cipher.AES/GCM/NoPadding", CountCipher.class.getName()); }
    }
    // Real SunJCE delegate with counted entry and explicitly fictional reported-parameter faults.
    public static final class CountCipher extends CipherSpi {
        static int entries, ivLength = 12, bits = 128;
        static byte[] inputReference, outputReference, aadReference, ivReference;
        private final Cipher delegate;
        private int mode;
        public CountCipher() throws Exception { entries++; delegate = Cipher.getInstance("AES/GCM/NoPadding","SunJCE"); }
        protected void engineSetMode(String value) throws NoSuchAlgorithmException { if (!value.equals("GCM")) throw new NoSuchAlgorithmException(); }
        protected void engineSetPadding(String value) throws NoSuchPaddingException { if (!value.equals("NoPadding")) throw new NoSuchPaddingException(); }
        protected int engineGetBlockSize() { return 16; }
        protected int engineGetOutputSize(int size) { return delegate.getOutputSize(size); }
        protected byte[] engineGetIV() { ivReference = Arrays.copyOf(delegate.getIV(),ivLength); return ivReference; }
        protected AlgorithmParameters engineGetParameters() {
            try { AlgorithmParameters p = AlgorithmParameters.getInstance("GCM"); p.init(new GCMParameterSpec(bits,Arrays.copyOf(delegate.getIV(),ivLength))); return p; }
            catch (Exception unavailable) { throw new IllegalStateException("FICTIONAL_PARAMETER_FAULT"); }
        }
        protected void engineInit(int mode,Key key,SecureRandom random) throws InvalidKeyException { this.mode=mode; delegate.init(mode,key,random); }
        protected void engineInit(int mode,Key key,AlgorithmParameterSpec params,SecureRandom random) throws InvalidKeyException,InvalidAlgorithmParameterException {
            this.mode=mode; delegate.init(mode,key,params,random);
        }
        protected void engineInit(int mode,Key key,AlgorithmParameters params,SecureRandom random) throws InvalidKeyException,InvalidAlgorithmParameterException {
            this.mode=mode; delegate.init(mode,key,params,random);
        }
        protected byte[] engineUpdate(byte[] input,int start,int length) { return delegate.update(input,start,length); }
        protected int engineUpdate(byte[] input,int start,int length,byte[] output,int offset) throws ShortBufferException { return delegate.update(input,start,length,output,offset); }
        protected void engineUpdateAAD(byte[] bytes,int start,int length) { aadReference=bytes; delegate.updateAAD(bytes,start,length); }
        protected byte[] engineDoFinal(byte[] input,int start,int length) throws IllegalBlockSizeException,BadPaddingException {
            inputReference=input; outputReference=delegate.doFinal(input,start,length); return outputReference;
        }
        protected int engineDoFinal(byte[] input,int start,int length,byte[] output,int offset) throws ShortBufferException,IllegalBlockSizeException,BadPaddingException {
            return delegate.doFinal(input,start,length,output,offset);
        }
    }
    private static void early(String field) throws Exception {
        healthy(); CountProvider provider = new CountProvider(); Security.insertProviderAt(provider,1);
        try {
            MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY);
            check(CountCipher.entries > 0,"COUNTED_PROVIDER_CALIBRATED"); CountCipher.entries=0;
            final String access = field.equals("access") ? repeat('x',8193) : field.equals("control") ? "not printable"
                : field.equals("empty") ? "" : field.equals("null") ? null : ACCESS;
            final MessagePreviewVaultFence.Owner expected = field.equals("epoch") ? new MessagePreviewVaultFence.Owner(USER,SESSION,DEVICE,9007199254740992L) : owner();
            final MessagePreviewMetadataEnvelope.Header h = field.equals("alias") ? new MessagePreviewMetadataEnvelope.Header(INSTALL,2,
                MessagePreviewMetadataEnvelope.Kind.COMMITTED,"foreign",EXPIRY,WALL,OP,1,7)
                : field.equals("overflow") ? new MessagePreviewMetadataEnvelope.Header(INSTALL,Long.MAX_VALUE,
                    MessagePreviewMetadataEnvelope.Kind.COMMITTED,header().alias,EXPIRY,WALL,OP,Long.MAX_VALUE-1,7) : header();
            unavailable(new Action() { public void run() throws Exception { MessagePreviewCredentialEnvelope.seal(h,expected,access,EXPIRY,KEY); }},"EARLY_INPUT_MUST_REFUSE");
            check(CountCipher.entries == 0,"EARLY_BOUND_BEFORE_PROVIDER");
        } finally { Security.removeProvider(provider.getName()); }
    }
    private static boolean zero(byte[] value) { if (value == null) return false; for (byte b:value) if (b != 0) return false; return true; }
    private static void provider(String field) throws Exception {
        healthy(); byte[] blob = MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY);
        final MessagePreviewMetadataEnvelope.Record r = record(header(),blob);
        CountProvider provider = new CountProvider(); Security.insertProviderAt(provider,1);
        try {
            MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY); check(CountCipher.entries>0,"COUNTED_PROVIDER_CALIBRATED");
            if (field.equals("clear")) {
                check(zero(CountCipher.inputReference) && zero(CountCipher.outputReference) && zero(CountCipher.aadReference)
                    && zero(CountCipher.ivReference),"SEAL_TEMPORARIES_CLEARED");
                check(MessagePreviewCredentialEnvelope.verifyMatch(r,header(),owner(),ACCESS,EXPIRY,KEY),"COUNTED_MATCH");
                check(zero(CountCipher.inputReference) && zero(CountCipher.outputReference) && zero(CountCipher.aadReference),"VERIFY_TEMPORARIES_CLEARED");
                return;
            }
            if (field.equals("iv")) CountCipher.ivLength=13;
            if (field.equals("tag")) CountCipher.bits=96;
            unavailable(new Action() { public void run() throws Exception { MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY); }},"PROVIDER_PARAMETERS_MUST_REFUSE");
        } finally { Security.removeProvider(provider.getName()); }
    }
    private static String repeat(char value,int length) { char[] chars=new char[length]; Arrays.fill(chars,value); return new String(chars); }
    private static void bounds() throws Exception {
        String access=repeat('x',8192); byte[] blob=MessagePreviewCredentialEnvelope.seal(header(),owner(),access,EXPIRY,KEY);
        check(blob.length==8352,"MAX_BLOB_LITERAL"); externalCheck(blob,header(),access);
        check(MessagePreviewCredentialEnvelope.verifyMatch(record(header(),blob),header(),owner(),access,EXPIRY,KEY),"MAX_COMPOSED_MATCH");
    }
    private static void minimum() throws Exception {
        byte[] blob=MessagePreviewCredentialEnvelope.seal(header(),owner(),"!",EXPIRY,KEY);
        check(blob.length==161,"MIN_BLOB_LITERAL"); externalCheck(blob,header(),"!");
        check(MessagePreviewCredentialEnvelope.verifyMatch(record(header(),blob),header(),owner(),"!",EXPIRY,KEY),"MIN_COMPOSED_MATCH");
    }
    private static void inputShapes() throws Exception {
        healthy(); final MessagePreviewMetadataEnvelope.Record r=record(header(),MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY));
        CountProvider provider=new CountProvider(); Security.insertProviderAt(provider,1);
        try {
            MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY); check(CountCipher.entries>0,"COUNTED_PROVIDER_CALIBRATED");
            Action[] checks={
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(null,owner(),ACCESS,EXPIRY,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(header(),null,ACCESS,EXPIRY,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,null);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,new SecretKeySpec(new byte[32],"DES"));}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,0,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(header(),new MessagePreviewVaultFence.Owner(repeat('x',9000),SESSION,DEVICE,4),ACCESS,EXPIRY,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.seal(header(),owner(),"\u0080",EXPIRY,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.verifyMatch(r,header(),null,ACCESS,EXPIRY,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.verifyMatch(r,header(),owner(),null,EXPIRY,KEY);}},
                new Action(){public void run()throws Exception{MessagePreviewCredentialEnvelope.verifyMatch(r,header(),owner(),ACCESS,EXPIRY,null);}}
            };
            for(Action check:checks){CountCipher.entries=0;unavailable(check,"INPUT_SHAPE_MUST_REFUSE");check(CountCipher.entries==0,"INPUT_SHAPE_BEFORE_PROVIDER");}
        } finally {Security.removeProvider(provider.getName());}
    }
    private static void snapshots() throws Exception {
        healthy(); byte[] first=MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY);
        byte[] second=MessagePreviewCredentialEnvelope.seal(header(),owner(),ACCESS,EXPIRY,KEY);
        check(!Arrays.equals(Arrays.copyOf(first,12),Arrays.copyOf(second,12)),"FRESH_PROVIDER_IV");
        MessagePreviewMetadataEnvelope.Record r=record(header(),first); first[0]^=1; r.credentialBytes()[12]^=1;
        check(MessagePreviewCredentialEnvelope.verifyMatch(r,header(),owner(),ACCESS,EXPIRY,KEY),"RECORD_DEFENSIVE_COPY");
        check(MessagePreviewCredentialEnvelope.verifyMatch(record(header(),second),header(),owner(),ACCESS,EXPIRY,KEY),"INDEPENDENT_RESULT");
        for (String literal:new String[]{ACCESS,USER,SESSION,DEVICE}) check(!contains(second,literal.getBytes(StandardCharsets.US_ASCII)),"SUPPORTING_PLAINTEXT_ABSENCE");
    }
    private static boolean contains(byte[] bytes,byte[] value) {
        for(int i=0;i<=bytes.length-value.length;i++){boolean same=true;for(int j=0;j<value.length;j++)same&=bytes[i+j]==value[j];if(same)return true;}return false;
    }
    private static void run(String scenario) throws Exception {
        if(scenario.equals("healthy")||scenario.equals("external"))healthy();
        else if(scenario.equals("bounds"))bounds(); else if(scenario.equals("minimum"))minimum();
        else if(scenario.equals("input-shapes"))inputShapes(); else if(scenario.equals("snapshots"))snapshots();
        else if(scenario.startsWith("match-"))mismatch(scenario.substring(6));
        else if(scenario.startsWith("header-"))headerMismatch(scenario.substring(7));
        else if(scenario.startsWith("tamper-"))tamper(scenario.substring(7));
        else if(scenario.startsWith("decode-"))malformed(scenario.substring(7));
        else if(scenario.startsWith("early-"))early(scenario.substring(6));
        else if(scenario.startsWith("provider-"))provider(scenario.substring(9));
        else throw new AssertionError("UNKNOWN_CASE");
    }
    public static void main(String[] args) {
        try { check(args.length==1&&args[0].matches("[a-z-]+"),"FIXED_CASE"); run(args[0]); System.out.println("PASS "+args[0]); }
        catch(Throwable refused) {
            String tag=refused instanceof AssertionError?refused.getMessage():null;
            System.err.println("FAIL "+(tag!=null&&tag.matches("[A-Z0-9_]+")?tag:"UNEXPECTED_FAILURE")); System.exit(1);
        }
    }
}
