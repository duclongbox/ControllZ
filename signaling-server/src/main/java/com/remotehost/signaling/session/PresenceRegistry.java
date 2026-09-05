package com.remotehost.signaling.session;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Who is online right now.
 *
 * <p>
 * In memory, not Redis. Once the WebSocket is open the presence state is already in this process —
 * the connection object is the presence record. Redis plus pub/sub only becomes necessary with more
 * than one signaling instance, which is many multiples of current traffic away (system-design.md
 * §4.2).
 *
 * <p>
 * Consequence to keep in mind: a restart clears presence, and every device must reconnect. That is
 * acceptable because established sessions are peer-to-peer and keep streaming without us.
 */
@Component
public class PresenceRegistry {

    private final Map<UUID, PeerChannel> online = new ConcurrentHashMap<>();

    /**
     * Marks a device online, returning the channel it displaced if the same device was already
     * connected. The caller is expected to close that stale channel — one connection per device.
     */
    public Optional<PeerChannel> register(UUID deviceId, PeerChannel channel) {
        return Optional.ofNullable(online.put(deviceId, channel));
    }

    /** Removes the device only if the given channel is still the registered one. */
    public void unregister(UUID deviceId, PeerChannel channel) {
        online.remove(deviceId, channel);
    }

    public Optional<PeerChannel> find(UUID deviceId) {
        return Optional.ofNullable(online.get(deviceId));
    }

    public boolean isOnline(UUID deviceId) {
        return online.containsKey(deviceId);
    }

    public int onlineCount() {
        return online.size();
    }
}
