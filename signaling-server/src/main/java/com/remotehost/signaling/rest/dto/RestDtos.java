package com.remotehost.signaling.rest.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.service.PairingService;

/** Request and response shapes for the REST API, kept apart from the domain records. */
public final class RestDtos {

    private RestDtos() {
    }

    /** POST /api/v1/devices */
    public record RegisterDeviceRequest(DeviceType deviceType, String displayName) {
    }

    /**
     * Registration response. {@code credential} appears here and nowhere else, ever — the server keeps
     * only a hash, so a device that loses it must re-enrol and re-pair.
     */
    public record RegisterDeviceResponse(
            UUID deviceId, DeviceType deviceType, String displayName, String credential, Instant createdAt) {

        public static RegisterDeviceResponse of(Device device, String credential) {
            return new RegisterDeviceResponse(
                    device.id(), device.deviceType(), device.displayName(), credential, device.createdAt());
        }
    }

    /** A device as exposed to API callers. Never includes the credential hash. */
    public record DeviceResponse(
            UUID deviceId,
            DeviceType deviceType,
            String displayName,
            boolean online,
            Instant createdAt,
            Instant lastSeenAt) {

        public static DeviceResponse of(Device device, boolean online) {
            return new DeviceResponse(
                    device.id(),
                    device.deviceType(),
                    device.displayName(),
                    online,
                    device.createdAt(),
                    device.lastSeenAt());
        }
    }

    /** One entry in "the devices I am paired with". */
    public record PairedDeviceResponse(
            UUID pairingId, UUID deviceId, DeviceType deviceType, String displayName, boolean online,
            Instant pairedAt) {

        public static PairedDeviceResponse of(PairingService.PairingView view) {
            return new PairedDeviceResponse(
                    view.pairing().id(),
                    view.peer().id(),
                    view.peer().deviceType(),
                    view.peer().displayName(),
                    view.peerOnline(),
                    view.pairing().createdAt());
        }
    }

    public record PairedDevicesResponse(int count, List<PairedDeviceResponse> devices) {
        public static PairedDevicesResponse of(List<PairingService.PairingView> views) {
            List<PairedDeviceResponse> devices = views.stream().map(PairedDeviceResponse::of).toList();
            return new PairedDevicesResponse(devices.size(), devices);
        }
    }

    /** PATCH /api/v1/devices/me */
    public record RenameDeviceRequest(String displayName) {
    }

    /** An in-flight session, for operational visibility. */
    public record SessionResponse(UUID sessionId, UUID desktopDeviceId, UUID phoneDeviceId, Instant startedAt) {
    }

    public record SessionsResponse(int count, List<SessionResponse> sessions) {

    }

    /** Server counters — cheap operational insight without wiring up metrics infrastructure. */
    public record StatsResponse(
            long devices, long pairings, int onlineDevices, int activeSessions, int outstandingPairCodes) {
    }

    /** Uniform error body. */
    public record ErrorResponse(String code, String message) {
    }
}
