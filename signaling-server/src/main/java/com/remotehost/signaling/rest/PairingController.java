package com.remotehost.signaling.rest;

import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.domain.Pairing;
import com.remotehost.signaling.message.SignalingMessage;
import com.remotehost.signaling.rest.auth.CurrentDevice;
import com.remotehost.signaling.service.PairingService;
import com.remotehost.signaling.session.PresenceRegistry;
import com.remotehost.signaling.session.SessionRegistry;

/** Pairing management. Creating pairings is the WebSocket code flow; this is the revoke side. */
@RestController
@RequestMapping("/api/v1/pairings")
public class PairingController {

    private final PairingService pairingService;
    private final PresenceRegistry presence;
    private final SessionRegistry sessions;

    public PairingController(
            PairingService pairingService, PresenceRegistry presence, SessionRegistry sessions) {
        this.pairingService = pairingService;
        this.presence = presence;
        this.sessions = sessions;
    }

    /**
     * Revokes a pairing. Only a participant may revoke, so a guessed pairing id gets a 404 rather than
     * acting on somebody else's relationship.
     * <p>
     * Revoking also tears down any live session between the two devices — otherwise "revoke" would
     * leave the current stream running, which is the opposite of what the word means.
     */
    @DeleteMapping("/{pairingId}")
    public ResponseEntity<Void> revoke(@CurrentDevice Device device, @PathVariable UUID pairingId) {
        Pairing revoked = pairingService
                .revoke(pairingId, device.id())
                .orElseThrow(() -> new RestExceptionHandler.NotFoundException("No such active pairing"));

        sessions.findByDevice(revoked.desktopDeviceId())
                .filter(session -> session.involves(revoked.phoneDeviceId()))
                .ifPresent(session -> {
                    sessions.close(session.id());
                    presence.find(session.desktopDeviceId())
                            .ifPresent(c -> c.send(new SignalingMessage.PeerDisconnected(session.id())));
                    presence.find(session.phoneDeviceId())
                            .ifPresent(c -> c.send(new SignalingMessage.PeerDisconnected(session.id())));
                });

        return ResponseEntity.noContent().build();
    }
}
