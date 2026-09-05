package com.remotehost.signaling.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PairingCodeStoreTest {

    private MutableClock clock;
    private PairingCodeStore store;

    /** Lets tests jump past the TTL instead of sleeping for five minutes. */
    static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }

    @BeforeEach
    void setUp() {
        clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        store = new PairingCodeStore(clock);
    }

    @Test
    void issuesSixDigitCode() {
        PairingCodeStore.Entry entry = store.issue(UUID.randomUUID());

        assertThat(entry.code()).hasSize(6).containsOnlyDigits();
        assertThat(entry.expiresAt()).isEqualTo(clock.instant().plus(PairingCodeStore.TTL));
    }

    @Test
    void codeIsSingleUse() {
        PairingCodeStore.Entry entry = store.issue(UUID.randomUUID());

        assertThat(store.consume(entry.code())).isPresent();
        assertThat(store.consume(entry.code())).isEmpty();
    }

    @Test
    void expiredCodeIsRejected() {
        PairingCodeStore.Entry entry = store.issue(UUID.randomUUID());

        clock.advance(PairingCodeStore.TTL.plusSeconds(1));

        assertThat(store.consume(entry.code())).isEmpty();
    }

    @Test
    void reissuingInvalidatesThePreviousCodeForThatDesktop() {
        UUID desktop = UUID.randomUUID();
        PairingCodeStore.Entry first = store.issue(desktop);
        PairingCodeStore.Entry second = store.issue(desktop);

        // The desktop is now displaying `second`; `first` must not still work.
        assertThat(store.consume(first.code())).isEmpty();
        assertThat(store.consume(second.code())).isPresent();
    }

    @Test
    void unknownCodeIsRejected() {
        assertThat(store.consume("000000")).isEmpty();
        assertThat(store.consume(null)).isEmpty();
    }

    @Test
    void revokeDropsOutstandingCode() {
        UUID desktop = UUID.randomUUID();
        PairingCodeStore.Entry entry = store.issue(desktop);

        store.revokeFor(desktop);

        assertThat(store.consume(entry.code())).isEmpty();
        assertThat(store.outstandingCount()).isZero();
    }
}
