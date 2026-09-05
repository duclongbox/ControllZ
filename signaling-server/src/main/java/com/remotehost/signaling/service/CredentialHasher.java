package com.remotehost.signaling.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

import org.springframework.stereotype.Component;

/**
 * Generates and verifies device credentials.
 *
 * <p>
 * Credentials are 256-bit values drawn from {@link SecureRandom}, not user-chosen passwords. That
 * matters for the hash choice: slow KDFs (bcrypt/Argon2) exist to make low-entropy passwords
 * expensive to guess, and there is nothing to guess here — brute-forcing 256 bits is infeasible
 * regardless of hash speed. So a salted SHA-256 is sufficient and costs no extra dependency. If
 * these ever become user-chosen, this class must switch to Argon2id.
 */
@Component
public class CredentialHasher {

    private static final int CREDENTIAL_BYTES = 32;
    private static final int SALT_BYTES = 16;

    private final SecureRandom random = new SecureRandom();

    /** A fresh URL-safe credential to hand to a device exactly once. */
    public String generateCredential() {
        byte[] bytes = new byte[CREDENTIAL_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Hashes a credential for storage, as {@code <saltHex>:<hashHex>}. */
    public String hash(String credential) {
        byte[] salt = new byte[SALT_BYTES];
        random.nextBytes(salt);
        return HexFormat.of().formatHex(salt) + ":" + HexFormat.of().formatHex(digest(credential, salt));
    }

    /** Constant-time verification of a presented credential against a stored hash. */
    public boolean matches(String credential, String storedHash) {
        if (credential == null || storedHash == null) {
            return false;
        }
        int separator = storedHash.indexOf(':');
        if (separator < 0) {
            return false;
        }
        byte[] salt;
        byte[] expected;
        try {
            salt = HexFormat.of().parseHex(storedHash.substring(0, separator));
            expected = HexFormat.of().parseHex(storedHash.substring(separator + 1));
        } catch (IllegalArgumentException e) {
            return false;
        }
        return MessageDigest.isEqual(digest(credential, salt), expected);
    }

    private byte[] digest(String credential, byte[] salt) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            sha.update(salt);
            sha.update(credential.getBytes(StandardCharsets.UTF_8));
            return sha.digest();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JDK spec", e);
        }
    }
}
