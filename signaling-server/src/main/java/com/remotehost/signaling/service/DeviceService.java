package com.remotehost.signaling.service;

import java.time.Clock;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.repository.DeviceRepository;

/** Device enrollment and credential authentication. */
@Service
public class DeviceService {

    /** A newly enrolled device plus the one and only copy of its plaintext credential. */
    public record Enrollment(Device device, String credential) {
    }

    private static final int MAX_DISPLAY_NAME = 100;

    private final DeviceRepository devices;
    private final CredentialHasher hasher;
    private final Clock clock;

    public DeviceService(DeviceRepository devices, CredentialHasher hasher, Clock clock) {
        this.devices = devices;
        this.hasher = hasher;
        this.clock = clock;
    }

    /**
     * Enrolls a device and mints its credential. The plaintext is returned here and never again — only
     * the hash is stored.
     */
    public Enrollment register(DeviceType deviceType, String displayName) {
        if (deviceType == null) {
            throw new IllegalArgumentException("deviceType is required");
        }
        String credential = hasher.generateCredential();
        Device device = new Device(
                UUID.randomUUID(),
                deviceType,
                hasher.hash(credential),
                sanitizeDisplayName(displayName, deviceType),
                clock.instant(),
                clock.instant());
        return new Enrollment(devices.save(device), credential);
    }

    /**
     * Verifies a device's credential.
     *
     * <p>
     * Returns empty for both an unknown device and a wrong credential, so callers cannot use the
     * distinction to enumerate device IDs.
     */
    public Optional<Device> authenticate(UUID deviceId, String credential) {
        if (deviceId == null || credential == null) {
            return Optional.empty();
        }
        return devices.findById(deviceId)
                .filter(device -> hasher.matches(credential, device.credentialHash()))
                .map(device -> devices.save(device.withLastSeenAt(clock.instant())));
    }

    public Optional<Device> findById(UUID deviceId) {
        return devices.findById(deviceId);
    }

    /**
     * Records liveness; presence itself is in memory, this is for pairing management after a restart.
     */
    public void touch(UUID deviceId) {
        devices.findById(deviceId).ifPresent(device -> devices.save(device.withLastSeenAt(clock.instant())));
    }

    public Optional<Device> rename(UUID deviceId, String displayName) {
        return devices.findById(deviceId)
                .map(device -> devices.save(
                        device.withDisplayName(sanitizeDisplayName(displayName, device.deviceType()))));
    }

    public long count() {
        return devices.count();
    }

    private String sanitizeDisplayName(String displayName, DeviceType deviceType) {
        if (displayName == null || displayName.isBlank()) {
            return deviceType == DeviceType.DESKTOP ? "Desktop" : "Phone";
        }
        String trimmed = displayName.strip();
        return trimmed.length() > MAX_DISPLAY_NAME ? trimmed.substring(0, MAX_DISPLAY_NAME) : trimmed;
    }
}
