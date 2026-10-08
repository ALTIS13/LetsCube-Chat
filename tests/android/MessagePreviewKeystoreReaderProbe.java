package com.kub.messenger;

import android.content.Context;
import android.os.UserManager;
import android.security.keystore.KeyInfo;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.Key;
import java.security.KeyStoreSpi;
import java.security.Provider;
import java.security.Security;
import java.security.cert.Certificate;
import java.security.spec.KeySpec;
import java.util.Date;
import java.util.Enumeration;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactorySpi;
import javax.crypto.spec.SecretKeySpec;
import java.security.spec.InvalidKeySpecException;
import java.security.InvalidKeyException;

// Child-JVM fictional JCA provider + labeled Android API stubs, not Keystore proof.
public final class MessagePreviewKeystoreReaderProbe {
    private static final String INSTALL = "11111111111111111111111111111111";
    private static final String META = "letscube.nmpv.metadata.v1.11111111111111111111111111111111";
    private static final String CREDENTIAL = "letscube.nmpv.credential.v1.11111111111111111111111111111111.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final class OwnedContext extends Context {
        boolean protectedStorage, fail;
        UserManager manager = new UserManager();
        public boolean isDeviceProtectedStorage() {
            if (fail) throw new IllegalStateException("FIXTURE");
            return protectedStorage;
        }
        public Object getSystemService(String name) { return manager; }
    }
    private static final class FictionalKey implements SecretKey {
        private static final long serialVersionUID = 1L;
        String algorithm = "AES";
        public String getAlgorithm() { return algorithm; }
        public String getFormat() { throw new AssertionError("NO_KEY_EXPORT"); }
        public byte[] getEncoded() { throw new AssertionError("NO_KEY_EXPORT"); }
    }
    private static OwnedContext context = new OwnedContext();
    private static FictionalKey key = new FictionalKey();
    private static Key resultKey = key;
    private static KeyInfo info = new KeyInfo();
    private static int loads, lookups, specs, mutations;
    private static boolean loadFailure, lookupFailure, specFailure, wrongSpec, lockDuringLookup;
    private static String requestedAlias;
    public static final class FictionalProvider extends Provider {
        private static final long serialVersionUID = 1L;
        FictionalProvider() {
            super("AndroidKeyStore", "1.0", "ISOLATED FICTIONAL TEST PROVIDER");
            put("KeyStore.AndroidKeyStore", Store.class.getName());
            put("SecretKeyFactory.AES", Factory.class.getName());
        }
    }
    public static final class Store extends KeyStoreSpi {
        public Key engineGetKey(String alias, char[] password) {
            lookups++; requestedAlias = alias;
            require(password == null, "NO_PASSWORD_OR_REFRESH");
            if (lookupFailure) throw new IllegalStateException("FIXTURE");
            if (lockDuringLookup) context.manager.unlocked = false;
            return resultKey;
        }
        public void engineLoad(InputStream stream, char[] password) throws IOException {
            loads++; require(stream == null && password == null, "NO_IMPORT_INPUT");
            if (loadFailure) throw new IOException("FIXTURE");
        }
        public void engineSetKeyEntry(String alias, Key k, char[] password, Certificate[] chain) { changed(); }
        public void engineSetKeyEntry(String alias, byte[] bytes, Certificate[] chain) { changed(); }
        public void engineSetCertificateEntry(String alias, Certificate certificate) { changed(); }
        public void engineDeleteEntry(String alias) { changed(); }
        public void engineStore(OutputStream stream, char[] password) { changed(); }
        public Certificate[] engineGetCertificateChain(String alias) { throw new AssertionError("UNUSED_API"); }
        public Certificate engineGetCertificate(String alias) { throw new AssertionError("UNUSED_API"); }
        public Date engineGetCreationDate(String alias) { throw new AssertionError("UNUSED_API"); }
        public Enumeration<String> engineAliases() { throw new AssertionError("NO_NAMESPACE_ENUMERATION"); }
        public boolean engineContainsAlias(String alias) { throw new AssertionError("UNUSED_API"); }
        public int engineSize() { throw new AssertionError("UNUSED_API"); }
        public boolean engineIsKeyEntry(String alias) { throw new AssertionError("UNUSED_API"); }
        public boolean engineIsCertificateEntry(String alias) { throw new AssertionError("UNUSED_API"); }
        public String engineGetCertificateAlias(Certificate certificate) { throw new AssertionError("UNUSED_API"); }
    }
    public static final class Factory extends SecretKeyFactorySpi {
        protected KeySpec engineGetKeySpec(SecretKey supplied, Class<?> requested) throws InvalidKeySpecException {
            specs++;
            require(supplied == key && requested == KeyInfo.class, "EXACT_ANDROID_KEYINFO");
            if (specFailure) throw new InvalidKeySpecException("FIXTURE");
            return wrongSpec ? new SecretKeySpec(new byte[32], "AES") : info;
        }
        protected SecretKey engineGenerateSecret(KeySpec spec) throws InvalidKeySpecException { changed(); return null; }
        protected SecretKey engineTranslateKey(SecretKey supplied) throws InvalidKeyException { changed(); return null; }
    }
    private static void changed() { mutations++; throw new IllegalStateException("FIXTURE_MUTATION"); }
    interface Checked { void run() throws Exception; }
    private static void require(boolean value, String oracle) { if (!value) throw new AssertionError(oracle); }
    private static void unavailable(Checked action, String oracle) throws Exception {
        try { action.run(); }
        catch (MessagePreviewKeystoreReader.Unavailable refusal) {
            require("UNAVAILABLE".equals(refusal.getMessage()) && refusal.getCause() == null
                && refusal.getStackTrace().length == 0 && refusal.getSuppressed().length == 0, "FIXED_REFUSAL");
            return;
        }
        throw new AssertionError(oracle);
    }
    private static MessagePreviewKeystoreReader reader() throws Exception { return new MessagePreviewKeystoreReader(context, INSTALL); }
    private static void positive() throws Exception {
        MessagePreviewKeystoreReader reader = reader(); info.alias = META;
        SecretKey metadata;
        try { metadata = reader.loadMetadata(); }
        catch (MessagePreviewKeystoreReader.Unavailable refusal) { throw new AssertionError("FIXED_METADATA_ALIAS"); }
        require(metadata == key && META.equals(requestedAlias), "FIXED_METADATA_ALIAS");
        info.alias = CREDENTIAL;
        require(reader.loadCredential(CREDENTIAL) == key && CREDENTIAL.equals(requestedAlias), "EXACT_CREDENTIAL_ALIAS");
        require(loads == 2 && lookups == 2 && specs == 2 && mutations == 0, "READ_ONLY_NO_CACHE");
    }
    private static void aliases() throws Exception {
        MessagePreviewKeystoreReader reader = reader(); info.alias = CREDENTIAL;
        for (String alias : new String[] { null, "", META, CREDENTIAL.replace("111111", "222222"),
            CREDENTIAL + ".extra", CREDENTIAL.replace("aaaaaaaa", "AAAAAAAA"), CREDENTIAL.replace("aaaaaaaa", "gggggggg"),
            CREDENTIAL.substring(0, CREDENTIAL.length() - 1) }) {
            info.alias = alias;
            unavailable(() -> reader.loadCredential(alias), "FOREIGN_OR_MALFORMED_ALIAS");
        }
        require(lookups == 0 && loads == 0 && mutations == 0, "ALIAS_BEFORE_LOOKUP");
    }
    private static void installations() throws Exception {
        for (String install : new String[] { null, "", INSTALL + "0", INSTALL.substring(1),
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "gggggggggggggggggggggggggggggggg" }) {
            unavailable(() -> new MessagePreviewKeystoreReader(context, install), "INSTALLATION_REFUSED");
        }
        require(loads == 0 && lookups == 0, "INSTALLATION_BEFORE_LOOKUP");
    }
    private static void admission(String scenario) throws Exception {
        info.alias = META;
        if (scenario.equals("protected")) context.protectedStorage = true;
        if (scenario.equals("locked")) context.manager.unlocked = false;
        if (scenario.equals("unknown-user")) context.manager = null;
        if (scenario.equals("unknown-context")) context.fail = true;
        if (scenario.equals("null-context")) {
            unavailable(() -> new MessagePreviewKeystoreReader(null, INSTALL), "CONTEXT_REFUSED"); return;
        }
        unavailable(() -> reader().loadMetadata(), "CONTEXT_REFUSED");
        require(loads == 0 && lookups == 0, "CONTEXT_BEFORE_LOOKUP");
    }
    private static void contextRecheck() throws Exception {
        MessagePreviewKeystoreReader reader = reader(); info.alias = META;
        context.manager.unlocked = false;
        unavailable(() -> reader.loadMetadata(), "LOCKED_LOAD_REFUSED");
        context.manager.unlocked = true; context.protectedStorage = true;
        unavailable(() -> reader.loadMetadata(), "PROTECTED_LOAD_REFUSED");
        context.protectedStorage = false; context.manager = null;
        unavailable(() -> reader.loadMetadata(), "UNKNOWN_LOAD_REFUSED");
        require(loads == 0 && lookups == 0, "LOAD_RECHECK_BEFORE_LOOKUP");
    }
    private static void retirement() throws Exception {
        MessagePreviewKeystoreReader reader = reader(); info.alias = META; lockDuringLookup = true;
        unavailable(() -> reader.loadMetadata(), "LOCK_DURING_LOOKUP_REFUSED");
        require(lookups == 1 && mutations == 0, "NO_CONTEXT_REPAIR");
    }
    private static void unavailableKey(String scenario) throws Exception {
        MessagePreviewKeystoreReader reader = reader(); info.alias = META;
        if (scenario.equals("missing")) resultKey = null;
        if (scenario.equals("not-secret")) resultKey = new Key() {
            public String getAlgorithm() { return "AES"; }
            public String getFormat() { throw new AssertionError("NO_KEY_EXPORT"); }
            public byte[] getEncoded() { throw new AssertionError("NO_KEY_EXPORT"); }
        };
        if (scenario.equals("algorithm")) key.algorithm = "HmacSHA256";
        if (scenario.equals("load-error")) loadFailure = true;
        if (scenario.equals("lookup-error")) lookupFailure = true;
        if (scenario.equals("spec-error")) specFailure = true;
        if (scenario.equals("wrong-spec")) wrongSpec = true;
        if (scenario.equals("missing-provider")) Security.removeProvider("AndroidKeyStore");
        unavailable(() -> reader.loadMetadata(), "KEY_UNAVAILABLE");
        require(mutations == 0, "NO_RECREATE_OR_IMPORT");
    }
    private static void policy(String scenario) throws Exception {
        MessagePreviewKeystoreReader reader = reader(); info.alias = META;
        switch (scenario) {
            case "info-alias": info.alias = CREDENTIAL; break;
            case "size": info.size = 128; break;
            case "origin": info.origin = 2; break;
            case "purposes": info.purposes = 7; break;
            case "modes": info.modes = new String[] { "GCM", "CBC" }; break;
            case "padding": info.paddings = new String[] { "NoPadding", "PKCS7Padding" }; break;
            case "authentication": info.authentication = true; break;
            case "null-modes": info.modes = null; break;
            case "null-padding": info.paddings = null; break;
            case "null-info-alias": info.alias = null; break;
            default: throw new AssertionError("UNKNOWN_POLICY");
        }
        unavailable(() -> reader.loadMetadata(), "POLICY_REFUSED");
        require(mutations == 0, "NO_POLICY_REPAIR");
    }
    public static void main(String[] args) throws Exception {
        require(Security.getProvider("AndroidKeyStore") == null, "ISOLATED_PROVIDER_NAMESPACE");
        require(Security.addProvider(new FictionalProvider()) > 0, "PROVIDER_REGISTERED");
        String scenario = args[0];
        switch (scenario) {
            case "positive": positive(); break; case "aliases": aliases(); break;
            case "installations": installations(); break; case "context-recheck": contextRecheck(); break;
            case "retirement": retirement(); break;
            case "protected": case "locked": case "unknown-user": case "unknown-context": case "null-context": admission(scenario); break;
            case "missing": case "not-secret": case "algorithm": case "load-error": case "lookup-error":
            case "spec-error": case "wrong-spec": case "missing-provider": unavailableKey(scenario); break;
            default: policy(scenario);
        }
        require(mutations == 0, "READ_ONLY");
        System.out.println("PASS " + scenario);
    }
}
