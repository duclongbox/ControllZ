package com.remotehost.signaling.service;

import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.domain.Pairing;
import com.remotehost.signaling.repository.DeviceRepository;
import com.remotehost.signaling.repository.PairingRepository;

/**
 * First-time pairing, pairing verification, and pairing management.
 *
 * <p>
 * The 6-digit code is first-pairing-only and never a permanent handle: after one successful
 * pairing, reconnects authenticate with the stored per-device credential and the code is gone
 * (system-design.md §2.5).
 */
@Service
public class PairingService {

    /** A pairing plus the resolved peer device, which is what both UIs actually want to show. */
    public record PairingView(Pairing pairing, Device peer, boolean peerOnline) {
    }

    private final PairingRepository pairings;
    private final DeviceRepository devices;
    private final PairingCodeStore codes;
    private final Clock clock;

    public PairingService(
            PairingRepository pairings, DeviceRepository devices, PairingCodeStore codes, Clock clock) {
        this.pairings = pairings;
        this.devices = devices;
        this.codes = codes;
        this.clock = clock;
    }

    /** Issues a code for a desktop to display. Only desktops may issue. */
    public PairingCodeStore.Entry issueCode(Device desktop) {
        if (desktop.deviceType() != DeviceType.DESKTOP) {
            throw new IllegalArgumentException("Only a desktop can issue a pairing code");
        }
        return codes.issue(desktop.id());
    }

    /** Thrown when a submitted code is unknown, expired, or already used. */
    public static class InvalidPairCodeException extends RuntimeException {
        public InvalidPairCodeException() {
            super("Pairing code is invalid or expired");
        }
    }

    /**
     * Redeems a code on behalf of a phone and creates the pairing.
     *
     * <p>
     * Idempotent against an existing active pairing: re-pairing an already-paired phone returns the
     * existing record rather than creating a duplicate, matching the {@code
     * pairings_active_uniq} constraint in the Postgres schema.
     */
    public Pairing redeemCode(String code, Device phone) {
        if (phone.deviceType() != DeviceType.PHONE) {
            throw new IllegalArgumentException("Only a phone can submit a pairing code");
        }
        PairingCodeStore.Entry entry = codes.consume(code).orElseThrow(InvalidPairCodeException::new);
        UUID desktopId = entry.desktopDeviceId();

        if (desktopId.equals(phone.id())) {
            throw new IllegalArgumentException("A device cannot pair with itself");
        }
        // The desktop could have been removed between issuing and redeeming.
        devices.findById(desktopId).orElseThrow(InvalidPairCodeException::new);

        return pairings.findActiveBetween(desktopId, phone.id())
                .orElseGet(() -> pairings.save(
                        new Pairing(UUID.randomUUID(), desktopId, phone.id(), clock.instant(), null)));
    }

    /**
     * The check every {@code connectRequest} runs. Empty means "no active pairing", with no distinction
     * between unknown, never-paired and revoked.
     */
    public Optional<Pairing> verifyPairing(UUID phoneDeviceId, UUID desktopDeviceId) {
        if (phoneDeviceId == null || desktopDeviceId == null) {
            return Optional.empty();
        }
        return pairings.findActiveBetween(desktopDeviceId, phoneDeviceId);
    }

    /** Every device this one is actively paired with, resolved for display. */
    public List<PairingView> listPairings(UUID deviceId, java.util.function.Predicate<UUID> onlineCheck) {
        return pairings.findActiveForDevice(deviceId).stream()
                .flatMap(pairing -> {
                    UUID peerId = pairing.peerOf(deviceId);
                    return devices.findById(peerId)
                            .map(peer -> new PairingView(pairing, peer, onlineCheck.test(peerId)))
                            .stream();
                })
                .toList();
    }

    /**
     * Revokes a pairing, but only if the requesting device is part of it — otherwise any device could
     * revoke any pairing by guessing an id.
     */
    public Optional<Pairing> revoke(UUID pairingId, UUID requestingDeviceId) {
        return pairings.findById(pairingId)
                .filter(Pairing::isActive)
                .filter(p -> p.desktopDeviceId().equals(requestingDeviceId)
                        || p.phoneDeviceId().equals(requestingDeviceId))
                .map(p -> pairings.save(p.revoke(clock.instant())));
    }

    /** Drops any outstanding code for a desktop that just went offline. */
    public void onDesktopDisconnected(UUID desktopDeviceId) {
        codes.revokeFor(desktopDeviceId);
    }
}
