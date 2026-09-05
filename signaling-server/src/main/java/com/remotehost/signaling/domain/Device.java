package com.remotehost.signaling.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * A registered desktop or phone.
 *
 * <p>
 * {@code credentialHash} is the only form of the device secret the server ever stores; the
 * plaintext is returned exactly once, at registration, and then lives in the OS keychain (desktop)
 * or IndexedDB (phone).
 *
 * <p>
 * {@code id} is a UUID rather than a short human-typeable handle on purpose: it is the value a
 * phone sends in {@code connectRequest}, and short handles would make desktops enumerable
 * (system-design.md §2.5). The 6-digit pairing code is first-pairing-only.
 */
public record Device(
        UUID id,
        DeviceType deviceType,
        String credentialHash,
        String displayName,
        Instant createdAt,
        Instant lastSeenAt) {

    public Device withLastSeenAt(Instant seenAt) {
        return new Device(id, deviceType, credentialHash, displayName, createdAt, seenAt);
    }

    public Device withDisplayName(String newDisplayName) {
        return new Device(id, deviceType, credentialHash, newDisplayName, createdAt, lastSeenAt);
    }
}
