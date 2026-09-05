package com.remotehost.signaling.service;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Short-lived, single-use pairing codes.
 *
 * <p>
 * In memory on purpose, and not in Postgres: a code is ephemeral by definition, and one that
 * survives a server restart is a liability rather than a feature.
 *
 * <p>
 * Codes are single-use — {@link #consume} removes the entry whether or not the caller goes on to
 * create a pairing. Combined with the ~5 minute expiry and the per-IP attempt limiting applied at
 * the edge, that keeps a 6-digit space from being brute-forceable.
 */
@Component
public class PairingCodeStore {

    public static final Duration TTL = Duration.ofMinutes(5);
    private static final int CODE_BOUND = 1_000_000; // six digits, zero-padded

    private final Map<String, Entry> codes = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final Clock clock;

    public PairingCodeStore(Clock clock) {
        this.clock = clock;
    }

    /** An outstanding code and the desktop that owns it. */
    public record Entry(String code, UUID desktopDeviceId, Instant expiresAt) {
        public boolean isExpired(Instant now) {
            return !now.isBefore(expiresAt);
        }
    }

    /**
     * Issues a code for a desktop, replacing any code that desktop already had outstanding — a desktop
     * showing a new code on screen must invalidate the old one.
     */
    public Entry issue(UUID desktopDeviceId) {
        codes.values().removeIf(e -> e.desktopDeviceId().equals(desktopDeviceId));
        purgeExpired();

        String code;
        do {
            code = "%06d".formatted(random.nextInt(CODE_BOUND));
        } while (codes.containsKey(code));

        Entry entry = new Entry(code, desktopDeviceId, clock.instant().plus(TTL));
        codes.put(code, entry);
        return entry;
    }

    /** Redeems a code, removing it. Empty when unknown or expired — the caller cannot tell which. */
    public Optional<Entry> consume(String code) {
        if (code == null) {
            return Optional.empty();
        }
        Entry entry = codes.remove(code);
        if (entry == null || entry.isExpired(clock.instant())) {
            return Optional.empty();
        }
        return Optional.of(entry);
    }

    /** Drops an outstanding code, e.g. when the issuing desktop disconnects. */
    public void revokeFor(UUID desktopDeviceId) {
        codes.values().removeIf(e -> e.desktopDeviceId().equals(desktopDeviceId));
    }

    public int outstandingCount() {
        purgeExpired();
        return codes.size();
    }

    private void purgeExpired() {
        Instant now = clock.instant();
        codes.values().removeIf(e -> e.isExpired(now));
    }
}
