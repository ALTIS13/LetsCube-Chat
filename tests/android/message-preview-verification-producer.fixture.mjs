import { provisioningStubs } from './message-preview-vault-provisioning.fixture.mjs';
import { messagePreviewStubs } from './message-preview-stubs.fixture.mjs';

// Android/Firebase/Capacitor doubles only. Key handles use a fictional provider
// in the child JVM; actual envelopes run AES-GCM through SunJCE, not Android.
export const producerStubs = {
  ...messagePreviewStubs,
  ...provisioningStubs,
  'android/os/SystemClock.java': `package android.os;
public final class SystemClock {
  public static volatile long value=100;
  public static volatile Runnable onRead;
  public static long elapsedRealtime() { Runnable hook=onRead; if (hook!=null) hook.run(); return value; }
}`,
};

export const producerPlatform = `package com.kub.messenger;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import java.io.*;
import java.security.*;
import java.security.cert.Certificate;
import java.security.spec.*;
import java.util.*;
import javax.crypto.*;

final class MessagePreviewProducerPlatform {
  static final Map<String,Handle> keys=Collections.synchronizedMap(new LinkedHashMap<String,Handle>());
  static final List<String> trace=Collections.synchronizedList(new ArrayList<String>());
  static volatile Runnable afterGenerate;
  static void check(boolean value) { if (!value) throw new AssertionError("FICTIONAL_PROVIDER_POLICY"); }
  static void install() { check(Security.getProvider("AndroidKeyStore")==null); Security.insertProviderAt(new FixtureProvider(),1); }
  static int credentials() { synchronized(keys) { int n=0; for(String alias:keys.keySet()) if(alias.startsWith("letscube.nmpv.credential.v1.")) n++; return n; } }
  static final class Handle implements SecretKey {
    private static final long serialVersionUID=1L;
    final SecretKey backing;
    Handle() throws Exception { KeyGenerator g=KeyGenerator.getInstance("AES","SunJCE"); g.init(256); backing=g.generateKey(); }
    public String getAlgorithm() { return "AES"; }
    public String getFormat() { throw new AssertionError("NO_KEY_EXPORT"); }
    public byte[] getEncoded() { throw new AssertionError("NO_KEY_EXPORT"); }
  }
  public static final class FixtureProvider extends Provider {
    private static final long serialVersionUID=1L;
    FixtureProvider() {
      super("AndroidKeyStore","1.0","FICTIONAL CHILD JVM ONLY");
      put("KeyStore.AndroidKeyStore",Store.class.getName()); put("KeyGenerator.AES",Generator.class.getName());
      put("SecretKeyFactory.AES",Factory.class.getName()); put("Cipher.AES/GCM/NoPadding",Gcm.class.getName());
    }
  }
  public static final class Store extends KeyStoreSpi {
    public void engineLoad(InputStream i,char[] p) { check(i==null && p==null); }
    public Key engineGetKey(String a,char[] p) { check(p==null && a.startsWith("letscube.nmpv.")); return keys.get(a); }
    public Enumeration<String> engineAliases() { synchronized(keys) { return Collections.enumeration(new ArrayList<String>(keys.keySet())); } }
    public boolean engineContainsAlias(String a) { return keys.containsKey(a); }
    public void engineDeleteEntry(String a) { check(a.startsWith("letscube.nmpv.credential.v1.")); trace.add("delete:"+a); keys.remove(a); }
    public void engineSetKeyEntry(String a,Key b,char[] c,Certificate[] d) { throw new AssertionError("NO_IMPORT"); }
    public void engineSetKeyEntry(String a,byte[] b,Certificate[] c) { throw new AssertionError("NO_IMPORT"); }
    public void engineSetCertificateEntry(String a,Certificate b) { throw new AssertionError("NO_IMPORT"); }
    public void engineStore(OutputStream a,char[] b) { throw new AssertionError("NO_EXPORT"); }
    public Certificate[] engineGetCertificateChain(String a) { throw new AssertionError("NO_DETAILS"); }
    public Certificate engineGetCertificate(String a) { throw new AssertionError("NO_DETAILS"); }
    public Date engineGetCreationDate(String a) { throw new AssertionError("NO_DETAILS"); }
    public int engineSize() { throw new AssertionError("NO_DETAILS"); }
    public boolean engineIsKeyEntry(String a) { throw new AssertionError("NO_DETAILS"); }
    public boolean engineIsCertificateEntry(String a) { throw new AssertionError("NO_DETAILS"); }
    public String engineGetCertificateAlias(Certificate a) { throw new AssertionError("NO_DETAILS"); }
  }
  public static final class Generator extends KeyGeneratorSpi {
    KeyGenParameterSpec policy;
    protected void engineInit(SecureRandom r) { throw new AssertionError("EXACT_POLICY"); }
    protected void engineInit(int size,SecureRandom r) { throw new AssertionError("EXACT_POLICY"); }
    protected void engineInit(AlgorithmParameterSpec spec,SecureRandom r) { policy=(KeyGenParameterSpec)spec; }
    protected SecretKey engineGenerateKey() {
      check(policy.size==256 && policy.purposes==3 && policy.random && !policy.auth
        && Arrays.equals(policy.modes,new String[]{"GCM"}) && Arrays.equals(policy.paddings,new String[]{"NoPadding"}));
      try {
        boolean credential=policy.alias.startsWith("letscube.nmpv.credential.v1.");
        if(credential) check(credentials()==0);
        Handle key=new Handle(); keys.put(policy.alias,key); trace.add("generate:"+policy.alias);
        if(credential && afterGenerate!=null) afterGenerate.run(); return key;
      } catch(Exception failure) { throw new AssertionError("FICTIONAL_GENERATOR"); }
    }
  }
  public static final class Factory extends SecretKeyFactorySpi {
    protected KeySpec engineGetKeySpec(SecretKey key,Class<?> type) {
      check(type==KeyInfo.class); KeyInfo result=new KeyInfo();
      synchronized(keys) { for(Map.Entry<String,Handle> e:keys.entrySet()) if(e.getValue()==key) result.alias=e.getKey(); }
      check(result.alias!=null); return result;
    }
    protected SecretKey engineGenerateSecret(KeySpec spec) { throw new AssertionError("NO_IMPORT"); }
    protected SecretKey engineTranslateKey(SecretKey key) { throw new AssertionError("NO_TRANSLATE"); }
  }
  public static final class Gcm extends CipherSpi {
    final Cipher actual;
    public Gcm() { try { actual=Cipher.getInstance("AES/GCM/NoPadding","SunJCE"); } catch(Exception e) { throw new AssertionError("JVM_AES_GCM"); } }
    Key backing(Key key) { check(key instanceof Handle); return ((Handle)key).backing; }
    protected void engineSetMode(String m) { check(m.equals("GCM")); }
    protected void engineSetPadding(String p) { check(p.equals("NoPadding")); }
    protected int engineGetBlockSize() { return actual.getBlockSize(); }
    protected int engineGetOutputSize(int n) { return actual.getOutputSize(n); }
    protected byte[] engineGetIV() { return actual.getIV(); }
    protected AlgorithmParameters engineGetParameters() { return actual.getParameters(); }
    protected void engineInit(int o,Key k,SecureRandom r) throws InvalidKeyException { actual.init(o,backing(k),r); }
    protected void engineInit(int o,Key k,AlgorithmParameterSpec p,SecureRandom r) throws InvalidKeyException,InvalidAlgorithmParameterException { actual.init(o,backing(k),p,r); }
    protected void engineInit(int o,Key k,AlgorithmParameters p,SecureRandom r) throws InvalidKeyException,InvalidAlgorithmParameterException { actual.init(o,backing(k),p,r); }
    protected void engineUpdateAAD(byte[] b,int o,int n) { actual.updateAAD(b,o,n); }
    protected byte[] engineUpdate(byte[] b,int o,int n) { return actual.update(b,o,n); }
    protected int engineUpdate(byte[] b,int o,int n,byte[] d,int x) throws ShortBufferException { return actual.update(b,o,n,d,x); }
    protected byte[] engineDoFinal(byte[] b,int o,int n) throws IllegalBlockSizeException,BadPaddingException { return actual.doFinal(b,o,n); }
    protected int engineDoFinal(byte[] b,int o,int n,byte[] d,int x) throws ShortBufferException,IllegalBlockSizeException,BadPaddingException { return actual.doFinal(b,o,n,d,x); }
  }
}
`;
