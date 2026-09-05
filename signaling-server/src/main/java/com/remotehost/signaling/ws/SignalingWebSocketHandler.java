package com.remotehost.signaling.ws;

import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.domain.Pairing;
import com.remotehost.signaling.message.ErrorCode;
import com.remotehost.signaling.message.SignalingMessage;
import com.remotehost.signaling.service.AttemptLimiter;
import com.remotehost.signaling.service.DeviceService;
import com.remotehost.signaling.service.PairingCodeStore;
import com.remotehost.signaling.service.PairingService;
import com.remotehost.signaling.session.PeerChannel;
import com.remotehost.signaling.session.PresenceRegistry;
import com.remotehost.signaling.session.Session;
import com.remotehost.signaling.session.SessionRegistry;

import tools.jackson.databind.ObjectMapper;

/**
 * The signaling protocol, end to end.
 *
 * <p>
 * Everything except {@code register}, {@code authenticate} and {@code echo} requires an
 * authenticated connection. SDP and ICE payloads are relayed byte-for-byte and never parsed: the
 * backend must never see media, and it does not need to understand the handshake to broker it
 * (CLAUDE.md).
 */
@Component
public class SignalingWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SignalingWebSocketHandler.class);
    private static final String CHANNEL_ATTRIBUTE = "peerChannel";

    private final ObjectMapper objectMapper;
    private final DeviceService deviceService;
    private final PairingService pairingService;
    private final PresenceRegistry presence;
    private final SessionRegistry sessions;
    private final AttemptLimiter pairCodeAttempts;

    public SignalingWebSocketHandler(
            ObjectMapper objectMapper,
            DeviceService deviceService,
            PairingService pairingService,
            PresenceRegistry presence,
            SessionRegistry sessions,
            AttemptLimiter pairCodeAttempts) {
        this.objectMapper = objectMapper;
        this.deviceService = deviceService;
        this.pairingService = pairingService;
        this.presence = presence;
        this.sessions = sessions;
        this.pairCodeAttempts = pairCodeAttempts;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.getAttributes().put(CHANNEL_ATTRIBUTE, new WebSocketPeerChannel(session, objectMapper));
        log.debug("Connection {} opened", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage textMessage) {
        WebSocketPeerChannel channel = channelOf(session);

        SignalingMessage message;
        try {
            message = objectMapper.readValue(textMessage.getPayload(), SignalingMessage.class);
        } catch (Exception e) {
            log.debug("Malformed message on connection {}: {}", session.getId(), e.toString());
            channel.send(error(ErrorCode.MALFORMED_MESSAGE, "Could not parse message"));
            return;
        }

        try {
            dispatch(session, channel, message);
        } catch (Exception e) {
            // One peer's bad request must never take the server, or the other peer, down.
            log.error("Error handling {} on connection {}", message.getClass().getSimpleName(), session.getId(), e);
            channel.send(error(ErrorCode.MALFORMED_MESSAGE, "Could not handle message"));
        }
    }

    private void dispatch(WebSocketSession session, WebSocketPeerChannel channel, SignalingMessage message) {
        switch (message) {
            case SignalingMessage.Echo echo -> channel.send(echo); // connectivity probe, no auth needed
            case SignalingMessage.Register register -> handleRegister(channel, register);
            case SignalingMessage.Authenticate authenticate -> handleAuthenticate(channel, authenticate);
            case SignalingMessage.Heartbeat ignored -> handleHeartbeat(channel);
            case SignalingMessage.PairCodeRequest ignored -> handlePairCodeRequest(channel);
            case SignalingMessage.PairCodeSubmit submit -> handlePairCodeSubmit(session, channel, submit);
            case SignalingMessage.ConnectRequest request -> handleConnectRequest(channel, request);
            case SignalingMessage.SdpOffer offer -> relay(channel, offer.sessionId(), offer);
            case SignalingMessage.SdpAnswer answer -> relay(channel, answer.sessionId(), answer);
            case SignalingMessage.IceCandidate candidate -> relay(channel, candidate.sessionId(), candidate);
            case SignalingMessage.EndSession end -> handleEndSession(channel, end);
            default -> channel.send(error(
                    ErrorCode.UNSUPPORTED_MESSAGE,
                    "Clients may not send " + message.getClass().getSimpleName()));
        }
    }

    // ------------------------------------------------------------------ identity

    private void handleRegister(WebSocketPeerChannel channel, SignalingMessage.Register register) {
        if (channel.isAuthenticated()) {
            channel.send(error(ErrorCode.ALREADY_AUTHENTICATED, "This connection already has an identity"));
            return;
        }
        if (register.deviceType() == null) {
            channel.send(error(ErrorCode.MALFORMED_MESSAGE, "deviceType is required"));
            return;
        }
        DeviceService.Enrollment enrollment = deviceService.register(register.deviceType(), register.displayName());
        Device device = enrollment.device();
        bindAndAnnounce(channel, device);
        channel.send(new SignalingMessage.Registered(device.id(), enrollment.credential(), device.deviceType()));
        log.info("Registered {} device {}", device.deviceType().wireName(), device.id());
    }

    private void handleAuthenticate(WebSocketPeerChannel channel, SignalingMessage.Authenticate authenticate) {
        if (channel.isAuthenticated()) {
            channel.send(error(ErrorCode.ALREADY_AUTHENTICATED, "This connection already has an identity"));
            return;
        }
        Optional<Device> device = deviceService.authenticate(authenticate.deviceId(), authenticate.credential());
        if (device.isEmpty()) {
            // Same response for unknown device and wrong credential, so device IDs stay unenumerable.
            channel.send(error(ErrorCode.INVALID_CREDENTIAL, "Unknown device or bad credential"));
            return;
        }
        bindAndAnnounce(channel, device.get());
        channel.send(new SignalingMessage.Authenticated(device.get().id(), device.get().deviceType()));
        log.debug("Authenticated device {}", device.get().id());
    }

    /** Binds identity to the connection and takes over presence from any older connection. */
    private void bindAndAnnounce(WebSocketPeerChannel channel, Device device) {
        channel.bindIdentity(device.id(), device.deviceType());
        presence.register(device.id(), channel).ifPresent(displaced -> {
            log.info("Device {} reconnected; closing displaced connection {}", device.id(), displaced.connectionId());
            displaced.close();
        });
    }

    private void handleHeartbeat(WebSocketPeerChannel channel) {
        if (requireAuth(channel) == null) {
            return;
        }
        deviceService.touch(channel.deviceId());
        channel.send(new SignalingMessage.HeartbeatAck(java.time.Instant.now()));
    }

    // ------------------------------------------------------------------ pairing

    private void handlePairCodeRequest(WebSocketPeerChannel channel) {
        UUID deviceId = requireAuth(channel);
        if (deviceId == null) {
            return;
        }
        Optional<Device> device = deviceService.findById(deviceId);
        if (device.isEmpty() || device.get().deviceType() != DeviceType.DESKTOP) {
            channel.send(error(ErrorCode.WRONG_DEVICE_TYPE, "Only a desktop can request a pairing code"));
            return;
        }
        PairingCodeStore.Entry entry = pairingService.issueCode(device.get());
        channel.send(new SignalingMessage.PairCodeIssued(entry.code(), entry.expiresAt()));
        log.debug("Issued pairing code for desktop {}", deviceId);
    }

    private void handlePairCodeSubmit(
            WebSocketSession session, WebSocketPeerChannel channel, SignalingMessage.PairCodeSubmit submit) {
        UUID deviceId = requireAuth(channel);
        if (deviceId == null) {
            return;
        }
        String limiterKey = remoteAddressOf(session);
        if (!pairCodeAttempts.tryAcquire(limiterKey)) {
            channel.send(error(ErrorCode.RATE_LIMITED, "Too many pairing attempts; try again shortly"));
            log.warn("Rate-limited pairing attempts from {}", limiterKey);
            return;
        }

        Optional<Device> phone = deviceService.findById(deviceId);
        if (phone.isEmpty() || phone.get().deviceType() != DeviceType.PHONE) {
            channel.send(error(ErrorCode.WRONG_DEVICE_TYPE, "Only a phone can submit a pairing code"));
            return;
        }

        Pairing pairing;
        try {
            pairing = pairingService.redeemCode(submit.code(), phone.get());
        } catch (PairingService.InvalidPairCodeException e) {
            channel.send(error(ErrorCode.INVALID_PAIR_CODE, "Pairing code is invalid or expired"));
            return;
        } catch (IllegalArgumentException e) {
            channel.send(error(ErrorCode.SELF_PAIRING, e.getMessage()));
            return;
        }

        pairCodeAttempts.reset(limiterKey);
        notifyPaired(pairing, phone.get());
        log.info("Paired desktop {} with phone {}", pairing.desktopDeviceId(), pairing.phoneDeviceId());
    }

    /** Both sides learn about a new pairing; the desktop only if it is still connected. */
    private void notifyPaired(Pairing pairing, Device phone) {
        Optional<Device> desktop = deviceService.findById(pairing.desktopDeviceId());
        presence.find(pairing.phoneDeviceId())
                .ifPresent(c -> c.send(new SignalingMessage.PairedConfirmed(
                        pairing.id(),
                        pairing.desktopDeviceId(),
                        desktop.map(Device::displayName).orElse("Desktop"))));
        presence.find(pairing.desktopDeviceId())
                .ifPresent(c -> c.send(new SignalingMessage.PairedConfirmed(
                        pairing.id(), pairing.phoneDeviceId(), phone.displayName())));
    }

    // ------------------------------------------------------------------ sessions

    private void handleConnectRequest(WebSocketPeerChannel channel, SignalingMessage.ConnectRequest request) {
        UUID phoneId = requireAuth(channel);
        if (phoneId == null) {
            return;
        }
        if (channel.deviceType() != DeviceType.PHONE) {
            channel.send(error(ErrorCode.WRONG_DEVICE_TYPE, "Only a phone can start a session"));
            return;
        }
        UUID desktopId = request.targetDeviceId();
        if (pairingService.verifyPairing(phoneId, desktopId).isEmpty()) {
            // Unknown, unpaired and revoked are indistinguishable on purpose.
            channel.send(new SignalingMessage.ConnectRejected(ErrorCode.NOT_PAIRED.wireName()));
            return;
        }
        Optional<PeerChannel> desktopChannel = presence.find(desktopId);
        if (desktopChannel.isEmpty()) {
            channel.send(new SignalingMessage.ConnectRejected(ErrorCode.DESKTOP_OFFLINE.wireName()));
            return;
        }

        Session session;
        try {
            session = sessions.open(desktopId, phoneId);
        } catch (SessionRegistry.DeviceBusyException e) {
            channel.send(new SignalingMessage.ConnectRejected(ErrorCode.ALREADY_IN_SESSION.wireName()));
            return;
        }

        // The desktop is the offerer, so it needs this before the phone does.
        desktopChannel.get().send(new SignalingMessage.SessionStarted(session.id(), phoneId, DeviceType.DESKTOP));
        channel.send(new SignalingMessage.SessionStarted(session.id(), desktopId, DeviceType.PHONE));
        log.info("Session {} started: desktop {} <-> phone {}", session.id(), desktopId, phoneId);
    }

    /** Forwards an SDP or ICE message to the other participant, verbatim. */
    private void relay(WebSocketPeerChannel channel, UUID sessionId, SignalingMessage message) {
        UUID deviceId = requireAuth(channel);
        if (deviceId == null) {
            return;
        }
        Optional<Session> session = sessions.findById(sessionId);
        if (session.isEmpty() || !session.get().involves(deviceId)) {
            // Covers both a stale sessionId and one belonging to somebody else's session.
            channel.send(error(ErrorCode.UNKNOWN_SESSION, "No such session for this device"));
            return;
        }
        UUID peerId = session.get().peerOf(deviceId);
        Optional<PeerChannel> peer = presence.find(peerId);
        if (peer.isEmpty()) {
            channel.send(new SignalingMessage.PeerDisconnected(sessionId));
            return;
        }
        peer.get().send(message);
    }

    private void handleEndSession(WebSocketPeerChannel channel, SignalingMessage.EndSession end) {
        UUID deviceId = requireAuth(channel);
        if (deviceId == null) {
            return;
        }
        Optional<Session> session = sessions.findById(end.sessionId());
        if (session.isEmpty() || !session.get().involves(deviceId)) {
            channel.send(error(ErrorCode.UNKNOWN_SESSION, "No such session for this device"));
            return;
        }
        UUID peerId = session.get().peerOf(deviceId);
        sessions.close(end.sessionId());
        presence.find(peerId).ifPresent(c -> c.send(new SignalingMessage.PeerDisconnected(end.sessionId())));
        log.debug("Session {} ended by {}", end.sessionId(), deviceId);
    }

    // ------------------------------------------------------------------ teardown

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        WebSocketPeerChannel channel = (WebSocketPeerChannel) session.getAttributes().get(CHANNEL_ATTRIBUTE);
        if (channel == null || !channel.isAuthenticated()) {
            return;
        }
        UUID deviceId = channel.deviceId();
        presence.unregister(deviceId, channel);

        // Tell the other side before forgetting the session, or nobody learns the peer is gone.
        sessions.closeForDevice(deviceId).ifPresent(closed -> {
            UUID peerId = closed.peerOf(deviceId);
            presence.find(peerId).ifPresent(c -> c.send(new SignalingMessage.PeerDisconnected(closed.id())));
            log.info("Session {} torn down: device {} disconnected", closed.id(), deviceId);
        });

        if (channel.deviceType() == DeviceType.DESKTOP) {
            // A code shown on a desktop that just went away must not stay redeemable.
            pairingService.onDesktopDisconnected(deviceId);
        }
        log.debug("Connection {} closed ({}), device {}", session.getId(), status.getCode(), deviceId);
    }

    // ------------------------------------------------------------------ helpers

    private WebSocketPeerChannel channelOf(WebSocketSession session) {
        return (WebSocketPeerChannel) session.getAttributes().get(CHANNEL_ATTRIBUTE);
    }

    /** Returns the authenticated device id, or null after sending a rejection. */
    private UUID requireAuth(WebSocketPeerChannel channel) {
        if (!channel.isAuthenticated()) {
            channel.send(error(ErrorCode.NOT_AUTHENTICATED, "Send register or authenticate first"));
            return null;
        }
        return channel.deviceId();
    }

    private static SignalingMessage.ErrorMessage error(ErrorCode code, String detail) {
        return new SignalingMessage.ErrorMessage(code.wireName(), detail);
    }

    private static String remoteAddressOf(WebSocketSession session) {
        var address = session.getRemoteAddress();
        return address == null || address.getAddress() == null
                ? "unknown"
                : address.getAddress().getHostAddress();
    }
}
