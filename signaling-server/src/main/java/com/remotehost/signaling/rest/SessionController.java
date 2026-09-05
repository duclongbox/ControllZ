package com.remotehost.signaling.rest;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.rest.auth.CurrentDevice;
import com.remotehost.signaling.rest.dto.RestDtos.SessionResponse;
import com.remotehost.signaling.rest.dto.RestDtos.SessionsResponse;
import com.remotehost.signaling.rest.dto.RestDtos.StatsResponse;
import com.remotehost.signaling.service.DeviceService;
import com.remotehost.signaling.service.PairingCodeStore;
import com.remotehost.signaling.session.PresenceRegistry;
import com.remotehost.signaling.session.SessionRegistry;

/** Read-only views of in-flight state, for the client UI and for operational debugging. */
@RestController
@RequestMapping("/api/v1")
public class SessionController {

    private final SessionRegistry sessions;
    private final PresenceRegistry presence;
    private final DeviceService deviceService;
    private final PairingCodeStore pairingCodes;
    private final com.remotehost.signaling.repository.PairingRepository pairings;

    public SessionController(
            SessionRegistry sessions,
            PresenceRegistry presence,
            DeviceService deviceService,
            PairingCodeStore pairingCodes,
            com.remotehost.signaling.repository.PairingRepository pairings) {
        this.sessions = sessions;
        this.presence = presence;
        this.deviceService = deviceService;
        this.pairingCodes = pairingCodes;
        this.pairings = pairings;
    }

    /** The caller's own session, if it has one. Scoped to the caller — not a server-wide list. */
    @GetMapping("/sessions/me")
    public SessionsResponse mySession(@CurrentDevice Device device) {
        List<SessionResponse> mine = sessions.findByDevice(device.id())
                .map(s -> new SessionResponse(s.id(), s.desktopDeviceId(), s.phoneDeviceId(), s.startedAt()))
                .map(List::of)
                .orElseGet(List::of);
        return new SessionsResponse(mine.size(), mine);
    }

    /**
     * Server counters. Aggregate numbers only — no device IDs — so this stays safe to expose while
     * still answering "is anything actually connected?" during development.
     */
    @GetMapping("/stats")
    public StatsResponse stats() {
        return new StatsResponse(
                deviceService.count(),
                pairings.count(),
                presence.onlineCount(),
                sessions.activeCount(),
                pairingCodes.outstandingCount());
    }
}
