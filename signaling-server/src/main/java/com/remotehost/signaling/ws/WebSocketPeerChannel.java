package com.remotehost.signaling.ws;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.message.SignalingMessage;
import com.remotehost.signaling.session.PeerChannel;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * A {@link PeerChannel} backed by a Spring {@link WebSocketSession}.
 *
 * <p>
 * Sends are synchronized because a session is not safe for concurrent writes and relaying means one
 * peer's inbound thread writes to the other peer's socket: two frames interleaved on the same
 * connection corrupt the stream.
 */
public class WebSocketPeerChannel implements PeerChannel {

    private static final Logger log = LoggerFactory.getLogger(WebSocketPeerChannel.class);

    private final WebSocketSession session;
    private final ObjectMapper objectMapper;
    private final AtomicReference<UUID> deviceId = new AtomicReference<>();
    private final AtomicReference<DeviceType> deviceType = new AtomicReference<>();
    private final Object sendLock = new Object();

    public WebSocketPeerChannel(WebSocketSession session, ObjectMapper objectMapper) {
        this.session = session;
        this.objectMapper = objectMapper;
    }

    /** Called once {@code authenticate} or {@code register} succeeds. */
    public void bindIdentity(UUID id, DeviceType type) {
        deviceId.set(id);
        deviceType.set(type);
    }

    public boolean isAuthenticated() {
        return deviceId.get() != null;
    }

    @Override
    public String connectionId() {
        return session.getId();
    }

    @Override
    public UUID deviceId() {
        return deviceId.get();
    }

    @Override
    public DeviceType deviceType() {
        return deviceType.get();
    }

    @Override
    public void send(SignalingMessage message) {
        String payload;
        try {
            // Jackson 3 throws unchecked JacksonException rather than a checked IOException.
            payload = objectMapper.writeValueAsString(message);
        } catch (JacksonException e) {
            // A message we cannot serialize is our bug, not the peer's; drop it rather than
            // killing an otherwise healthy connection.
            log.error("Failed to serialize {} for connection {}", message.getClass().getSimpleName(), session.getId(),
                    e);
            return;
        }
        synchronized (sendLock) {
            if (!session.isOpen()) {
                log.debug("Dropping {} for closed connection {}", message.getClass().getSimpleName(), session.getId());
                return;
            }
            try {
                session.sendMessage(new TextMessage(payload));
            } catch (IOException e) {
                log.debug("Send failed on connection {}, closing", session.getId(), e);
                close();
            }
        }
    }

    @Override
    public void close() {
        try {
            if (session.isOpen()) {
                session.close(CloseStatus.NORMAL);
            }
        } catch (IOException e) {
            log.debug("Error closing connection {}", session.getId(), e);
        }
    }
}
