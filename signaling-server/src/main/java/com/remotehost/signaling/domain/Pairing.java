package com.remotehost.signaling.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A durable desktop-to-phone relationship, created once by the first-time pairing-code flow and
 * reused silently on every later reconnect.
 *
 * <p>
 * Revocation sets {@code revokedAt} rather than deleting the row: revocation has to be auditable,
 * and {@code verifyPairing} reads the same row either way.
 */
public record Pairing(
        UUID id, UUID desktopDeviceId, UUID phoneDeviceId, Instant createdAt, Instant revokedAt) {

    public boolean isActive() {
        return revokedAt == null;
    }

    public Pairing revoke(Instant at) {
        return new Pairing(id, desktopDeviceId, phoneDeviceId, createdAt, at);
    }

    /** The other side of this pairing, given one end of it. */
    public UUID peerOf(UUID deviceId) {
        if (deviceId.equals(desktopDeviceId)) {
            return phoneDeviceId;
        }
        if (deviceId.equals(phoneDeviceId)) {
            return desktopDeviceId;
        }
        throw new IllegalArgumentException("Device " + deviceId + " is not part of pairing " + id);
    }
}
