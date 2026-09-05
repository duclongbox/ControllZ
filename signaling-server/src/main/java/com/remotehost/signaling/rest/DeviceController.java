package com.remotehost.signaling.rest;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.rest.auth.CurrentDevice;
import com.remotehost.signaling.rest.dto.RestDtos.DeviceResponse;
import com.remotehost.signaling.rest.dto.RestDtos.PairedDevicesResponse;
import com.remotehost.signaling.rest.dto.RestDtos.RegisterDeviceRequest;
import com.remotehost.signaling.rest.dto.RestDtos.RegisterDeviceResponse;
import com.remotehost.signaling.rest.dto.RestDtos.RenameDeviceRequest;
import com.remotehost.signaling.service.DeviceService;
import com.remotehost.signaling.service.PairingService;
import com.remotehost.signaling.session.PresenceRegistry;

/**
 * Device enrolment and self-service.
 *
 * <p>
 * Everything is scoped to "me", the device presenting the credentials. There is no user or account
 * entity in this system — a device's world is itself and the devices it has paired with — so there
 * is deliberately no endpoint that lists all devices on the server.
 */
@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

    private final DeviceService deviceService;
    private final PairingService pairingService;
    private final PresenceRegistry presence;

    public DeviceController(
            DeviceService deviceService, PairingService pairingService, PresenceRegistry presence) {
        this.deviceService = deviceService;
        this.pairingService = pairingService;
        this.presence = presence;
    }

    /**
     * Enrols a device. The same thing the {@code register} WebSocket message does, exposed over HTTP so
     * tooling and tests can create a device without opening a socket.
     */
    @PostMapping
    public ResponseEntity<RegisterDeviceResponse> register(@RequestBody RegisterDeviceRequest request) {
        if (request == null || request.deviceType() == null) {
            throw new IllegalArgumentException("deviceType is required");
        }
        DeviceService.Enrollment enrollment = deviceService.register(request.deviceType(), request.displayName());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(RegisterDeviceResponse.of(enrollment.device(), enrollment.credential()));
    }

    /** The calling device. */
    @GetMapping("/me")
    public DeviceResponse me(@CurrentDevice Device device) {
        return DeviceResponse.of(device, presence.isOnline(device.id()));
    }

    @PatchMapping("/me")
    public DeviceResponse rename(@CurrentDevice Device device, @RequestBody RenameDeviceRequest request) {
        Device updated = deviceService
                .rename(device.id(), request == null ? null : request.displayName())
                .orElseThrow(() -> new RestExceptionHandler.NotFoundException("Device no longer exists"));
        return DeviceResponse.of(updated, presence.isOnline(updated.id()));
    }

    /**
     * Every device this one is paired with, each flagged with whether it is connected right now. This
     * is what the phone's device picker and the desktop's pairing list both render.
     */
    @GetMapping("/me/pairings")
    public PairedDevicesResponse myPairings(@CurrentDevice Device device) {
        List<PairingService.PairingView> views = pairingService.listPairings(device.id(), presence::isOnline);
        return PairedDevicesResponse.of(views);
    }
}
