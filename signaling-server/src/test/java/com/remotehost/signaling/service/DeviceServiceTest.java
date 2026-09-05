package com.remotehost.signaling.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.repository.memory.InMemoryDeviceRepository;

class DeviceServiceTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);

    private DeviceService service;

    @BeforeEach
    void setUp() {
        service = new DeviceService(new InMemoryDeviceRepository(), new CredentialHasher(), CLOCK);
    }

    @Test
    void registrationReturnsPlaintextCredentialOnlyOnce() {
        DeviceService.Enrollment enrollment = service.register(DeviceType.DESKTOP, "My Mac");

        assertThat(enrollment.credential()).isNotBlank();
        // The stored form must not be the credential itself.
        assertThat(enrollment.device().credentialHash()).isNotEqualTo(enrollment.credential());
        assertThat(enrollment.device().credentialHash()).contains(":");
    }

    @Test
    void authenticateAcceptsTheIssuedCredential() {
        DeviceService.Enrollment enrollment = service.register(DeviceType.PHONE, "My Phone");

        assertThat(service.authenticate(enrollment.device().id(), enrollment.credential()))
                .isPresent();
    }

    @Test
    void authenticateRejectsWrongCredentialAndUnknownDevice() {
        DeviceService.Enrollment enrollment = service.register(DeviceType.PHONE, "My Phone");

        assertThat(service.authenticate(enrollment.device().id(), "wrong")).isEmpty();
        assertThat(service.authenticate(UUID.randomUUID(), enrollment.credential()))
                .isEmpty();
        assertThat(service.authenticate(null, null)).isEmpty();
    }

    @Test
    void credentialsAreUniquePerDevice() {
        String first = service.register(DeviceType.PHONE, "A").credential();
        String second = service.register(DeviceType.PHONE, "B").credential();

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void blankDisplayNameFallsBackToDeviceType() {
        assertThat(service.register(DeviceType.DESKTOP, "  ").device().displayName())
                .isEqualTo("Desktop");
        assertThat(service.register(DeviceType.PHONE, null).device().displayName())
                .isEqualTo("Phone");
    }

    @Test
    void renameUpdatesTheDisplayName() {
        DeviceService.Enrollment enrollment = service.register(DeviceType.DESKTOP, "Old");

        service.rename(enrollment.device().id(), "New");

        assertThat(service.findById(enrollment.device().id()).orElseThrow().displayName())
                .isEqualTo("New");
    }
}
