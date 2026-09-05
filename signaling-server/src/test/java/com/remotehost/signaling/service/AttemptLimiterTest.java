package com.remotehost.signaling.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The limiter is the only thing standing between a six-digit pairing code and a brute-force sweep:
 * a million possibilities falls in minutes unthrottled. So the exact budget, and the fact that spent
 * attempts eventually fall out of the window, are load-bearing rather than incidental.
 *
 * <p>
 * Reuses {@link PairingCodeStoreTest.MutableClock} so the five-minute window can be crossed without
 * sleeping through it.
 */
class AttemptLimiterTest {

    private static final String KEY = "203.0.113.7";

    private PairingCodeStoreTest.MutableClock clock;
    private AttemptLimiter limiter;

    @BeforeEach
    void setUp() {
        clock = new PairingCodeStoreTest.MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        limiter = new AttemptLimiter(clock);
    }

    private void exhaust(String key) {
        for (int attempt = 1; attempt <= AttemptLimiter.MAX_ATTEMPTS; attempt++) {
            assertThat(limiter.tryAcquire(key)).as("attempt %d of the budget", attempt).isTrue();
        }
    }

    @Test
    void allowsExactlyTheBudgetThenRefuses() {
        exhaust(KEY);

        assertThat(limiter.tryAcquire(KEY)).isFalse();
        assertThat(limiter.tryAcquire(KEY)).as("stays refused").isFalse();
    }

    @Test
    void budgetsAreIndependentPerKey() {
        exhaust(KEY);

        // One noisy source must not lock everybody else out of pairing.
        assertThat(limiter.tryAcquire("198.51.100.4")).isTrue();
    }

    @Test
    void resetClearsTheBudget() {
        exhaust(KEY);
        assertThat(limiter.tryAcquire(KEY)).isFalse();

        // What a successful pairing does, so a legitimate user who fumbled the code
        // a few times is not left throttled afterwards.
        limiter.reset(KEY);

        assertThat(limiter.tryAcquire(KEY)).isTrue();
    }

    @Test
    void attemptsFallOutOfTheWindow() {
        exhaust(KEY);
        assertThat(limiter.tryAcquire(KEY)).isFalse();

        clock.advance(AttemptLimiter.WINDOW.plusSeconds(1));

        assertThat(limiter.tryAcquire(KEY)).isTrue();
    }

    @Test
    void onlyTheAttemptsStillInsideTheWindowCount() {
        int half = AttemptLimiter.MAX_ATTEMPTS / 2;
        for (int i = 0; i < half; i++) {
            assertThat(limiter.tryAcquire(KEY)).isTrue();
        }
        clock.advance(AttemptLimiter.WINDOW.dividedBy(2));
        for (int i = 0; i < AttemptLimiter.MAX_ATTEMPTS - half; i++) {
            assertThat(limiter.tryAcquire(KEY)).isTrue();
        }
        assertThat(limiter.tryAcquire(KEY)).as("budget spent").isFalse();

        // Far enough that the first half has aged out but the second half has not:
        // the window slides, it does not reset wholesale.
        clock.advance(AttemptLimiter.WINDOW.dividedBy(2).plusSeconds(1));

        for (int i = 0; i < half; i++) {
            assertThat(limiter.tryAcquire(KEY)).as("freed slot %d", i + 1).isTrue();
        }
        assertThat(limiter.tryAcquire(KEY)).as("the newer attempts still count").isFalse();
    }

    @Test
    void anUnidentifiableSourceStillGetsABudget() {
        // A null key means the server could not read a remote address; it must not
        // become an unlimited free pass.
        exhaust(null);

        assertThat(limiter.tryAcquire(null)).isFalse();
    }
}
