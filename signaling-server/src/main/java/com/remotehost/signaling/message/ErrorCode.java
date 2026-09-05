package com.remotehost.signaling.message;

/**
 * Machine-readable error codes carried by {@code error} and {@code connectRejected}.
 *
 * <p>
 * {@link #NOT_PAIRED} is deliberately overloaded: unknown device, never-paired device and revoked
 * pairing all produce it, so a caller cannot use rejection messages to discover which device IDs
 * exist (system-design.md §2.5).
 */
public enum ErrorCode {
    MALFORMED_MESSAGE("malformedMessage"),
    UNSUPPORTED_MESSAGE("unsupportedMessage"),
    NOT_AUTHENTICATED("notAuthenticated"),
    ALREADY_AUTHENTICATED("alreadyAuthenticated"),
    INVALID_CREDENTIAL("invalidCredential"),
    WRONG_DEVICE_TYPE("wrongDeviceType"),
    INVALID_PAIR_CODE("invalidPairCode"),
    NOT_PAIRED("notPaired"),
    DESKTOP_OFFLINE("desktopOffline"),
    ALREADY_IN_SESSION("alreadyInSession"),
    UNKNOWN_SESSION("unknownSession"),
    SELF_PAIRING("selfPairing"),
    RATE_LIMITED("rateLimited");

    private final String wireName;

    ErrorCode(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }
}
