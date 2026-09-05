package com.remotehost.signaling.session;

import java.util.UUID;

import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.message.SignalingMessage;

/**
 * One authenticated device's outbound channel.
 *
 * <p>
 * An interface rather than a raw {@code WebSocketSession} so the registries and services below stay
 * testable without a servlet container, and so a future transport (say, SSE fallback) does not
 * ripple through the service layer.
 */
public interface PeerChannel {

    /** Transport-level connection id, unique per socket. */
    String connectionId();

    /** The authenticated device, or null before {@code authenticate} succeeds. */
    UUID deviceId();

    DeviceType deviceType();

    /** Sends a message. Implementations must be safe to call from other peers' threads. */
    void send(SignalingMessage message);

    void close();
}
