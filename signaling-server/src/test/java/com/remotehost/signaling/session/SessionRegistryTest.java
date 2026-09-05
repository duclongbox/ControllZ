package com.remotehost.signaling.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SessionRegistryTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);

    private SessionRegistry registry;
    private UUID desktop;
    private UUID phone;

    @BeforeEach
    void setUp() {
        registry = new SessionRegistry(CLOCK);
        desktop = UUID.randomUUID();
        phone = UUID.randomUUID();
    }

    @Test
    void openIndexesBothParticipants() {
        Session session = registry.open(desktop, phone);

        assertThat(registry.findById(session.id())).contains(session);
        assertThat(registry.findByDevice(desktop)).contains(session);
        assertThat(registry.findByDevice(phone)).contains(session);
        assertThat(session.peerOf(phone)).isEqualTo(desktop);
        assertThat(session.peerOf(desktop)).isEqualTo(phone);
    }

    @Test
    void aDeviceCannotJoinTwoSessionsAtOnce() {
        registry.open(desktop, phone);

        assertThatThrownBy(() -> registry.open(desktop, UUID.randomUUID()))
                .isInstanceOf(SessionRegistry.DeviceBusyException.class);
        assertThatThrownBy(() -> registry.open(UUID.randomUUID(), phone))
                .isInstanceOf(SessionRegistry.DeviceBusyException.class);
    }

    @Test
    void closeFreesBothDevices() {
        Session session = registry.open(desktop, phone);

        assertThat(registry.close(session.id())).contains(session);

        assertThat(registry.findByDevice(desktop)).isEmpty();
        assertThat(registry.findByDevice(phone)).isEmpty();
        // Freed, so a new session can be opened with the same devices.
        assertThat(registry.open(desktop, phone)).isNotNull();
    }

    @Test
    void closingTwiceIsHarmless() {
        Session session = registry.open(desktop, phone);

        assertThat(registry.close(session.id())).isPresent();
        assertThat(registry.close(session.id())).isEmpty();
    }

    @Test
    void closeForDeviceTearsDownWhicheverSessionItIsIn() {
        Session session = registry.open(desktop, phone);

        assertThat(registry.closeForDevice(phone)).contains(session);
        assertThat(registry.activeCount()).isZero();
    }

    @Test
    void sessionRejectsDevicesThatAreNotParticipants() {
        Session session = registry.open(desktop, phone);

        assertThat(session.involves(UUID.randomUUID())).isFalse();
        assertThatThrownBy(() -> session.peerOf(UUID.randomUUID()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
