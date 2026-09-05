package com.remotehost.signaling.session;

import java.time.Instant;
import java.util.UUID;

/**
 * An in-flight signaling session between one desktop and one phone.
 *
 * <p>
 * Ephemeral by nature: it exists only to carry the SDP/ICE exchange. Once ICE completes, the media
 * path is peer-to-peer and this record has no further influence on the stream — which is why it
 * lives in memory and never in Postgres.
 */
public record Session(UUID id, UUID desktopDeviceId, UUID phoneDeviceId, Instant startedAt) {

    public UUID peerOf(UUID deviceId) {
        if (deviceId.equals(desktopDeviceId)) {
            return phoneDeviceId;
        }
        if (deviceId.equals(phoneDeviceId)) {
            return desktopDeviceId;
        }
        throw new IllegalArgumentException("Device " + deviceId + " is not part of session " + id);
    }

    public boolean involves(UUID deviceId) {
        return deviceId.equals(desktopDeviceId) || deviceId.equals(phoneDeviceId);
    }
}
