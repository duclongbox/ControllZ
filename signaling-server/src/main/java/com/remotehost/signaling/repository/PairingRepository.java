package com.remotehost.signaling.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.remotehost.signaling.domain.Pairing;

/**
 * Port for the durable pairing store. See {@link DeviceRepository} for why this is hand-written.
 */
public interface PairingRepository {

    Pairing save(Pairing pairing);

    Optional<Pairing> findById(UUID id);

    /**
     * The hot path: every {@code connectRequest} calls this. Returns the active (non-revoked) pairing
     * between these two devices, in either direction.
     */
    Optional<Pairing> findActiveBetween(UUID desktopDeviceId, UUID phoneDeviceId);

    /** Every active pairing involving this device, whichever end it sits on. */
    List<Pairing> findActiveForDevice(UUID deviceId);

    long count();
}
