package com.remotehost.signaling.session;

import java.time.Clock;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * In-flight sessions, indexed by id and by participating device.
 *
 * <p>
 * A device participates in at most one session at a time: a second {@code connectRequest} while a
 * session is live is rejected rather than silently replacing it, so a stale phone tab cannot knock
 * a working session off its desktop.
 */
@Component
public class SessionRegistry {

    private final Map<UUID, Session> sessionsById = new ConcurrentHashMap<>();
    private final Map<UUID, UUID> sessionIdByDevice = new ConcurrentHashMap<>();
    private final Clock clock;

    public SessionRegistry(Clock clock) {
        this.clock = clock;
    }

    /** Thrown when a device already participates in a live session. */
    public static class DeviceBusyException extends RuntimeException {
        public DeviceBusyException(UUID deviceId) {
            super("Device " + deviceId + " is already in a session");
        }
    }

    /**
     * Opens a session between the two devices.
     *
     * @throws DeviceBusyException
     *             if either device is already in one
     */
    public synchronized Session open(UUID desktopDeviceId, UUID phoneDeviceId) {
        if (sessionIdByDevice.containsKey(desktopDeviceId)) {
            throw new DeviceBusyException(desktopDeviceId);
        }
        if (sessionIdByDevice.containsKey(phoneDeviceId)) {
            throw new DeviceBusyException(phoneDeviceId);
        }
        Session session = new Session(UUID.randomUUID(), desktopDeviceId, phoneDeviceId, clock.instant());
        sessionsById.put(session.id(), session);
        sessionIdByDevice.put(desktopDeviceId, session.id());
        sessionIdByDevice.put(phoneDeviceId, session.id());
        return session;
    }

    public Optional<Session> findById(UUID sessionId) {
        return Optional.ofNullable(sessionsById.get(sessionId));
    }

    public Optional<Session> findByDevice(UUID deviceId) {
        return Optional.ofNullable(sessionIdByDevice.get(deviceId)).map(sessionsById::get);
    }

    /** Closes a session and frees both devices. Returns it if it was still open. */
    public synchronized Optional<Session> close(UUID sessionId) {
        Session session = sessionsById.remove(sessionId);
        if (session == null) {
            return Optional.empty();
        }
        sessionIdByDevice.remove(session.desktopDeviceId(), sessionId);
        sessionIdByDevice.remove(session.phoneDeviceId(), sessionId);
        return Optional.of(session);
    }

    /** Closes whichever session this device is in, e.g. because its socket dropped. */
    public Optional<Session> closeForDevice(UUID deviceId) {
        return findByDevice(deviceId).flatMap(s -> close(s.id()));
    }

    public int activeCount() {
        return sessionsById.size();
    }
}
