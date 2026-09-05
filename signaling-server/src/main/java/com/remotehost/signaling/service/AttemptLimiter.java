package com.remotehost.signaling.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * A small sliding-window attempt limiter.
 *
 * <p>
 * Exists for one specific reason: a 6-digit pairing code is only a million possibilities, which an
 * unthrottled attacker exhausts quickly. Limiting submissions per source turns that into a
 * non-attack. Not a general-purpose rate limiter — good enough at this traffic, and it lives in
 * memory like everything else ephemeral.
 */
@Component
public class AttemptLimiter {

    public static final int MAX_ATTEMPTS = 10;
    public static final Duration WINDOW = Duration.ofMinutes(5);

    private final Map<String, Deque<Instant>> attempts = new ConcurrentHashMap<>();
    private final Clock clock;

    public AttemptLimiter(Clock clock) {
        this.clock = clock;
    }

    /**
     * Records an attempt for a key (a client IP, typically).
     *
     * @return true when the attempt is allowed, false when the key is over its budget
     */
    public boolean tryAcquire(String key) {
        if (key == null) {
            key = "unknown";
        }
        Instant now = clock.instant();
        Instant cutoff = now.minus(WINDOW);
        Deque<Instant> window = attempts.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && window.peekFirst().isBefore(cutoff)) {
                window.pollFirst();
            }
            if (window.size() >= MAX_ATTEMPTS) {
                return false;
            }
            window.addLast(now);
            return true;
        }
    }

    /** Clears a key's history, e.g. after a successful pairing. */
    public void reset(String key) {
        if (key != null) {
            attempts.remove(key);
        }
    }
}
