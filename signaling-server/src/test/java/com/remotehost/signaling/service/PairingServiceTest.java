package com.remotehost.signaling.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.domain.Pairing;
import com.remotehost.signaling.repository.memory.InMemoryDeviceRepository;
import com.remotehost.signaling.repository.memory.InMemoryPairingRepository;

class PairingServiceTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);

    private InMemoryDeviceRepository devices;
    private InMemoryPairingRepository pairings;
    private PairingCodeStore codes;
    private PairingService service;
    private DeviceService deviceService;

    @BeforeEach
    void setUp() {
        devices = new InMemoryDeviceRepository();
        pairings = new InMemoryPairingRepository();
        codes = new PairingCodeStore(CLOCK);
        deviceService = new DeviceService(devices, new CredentialHasher(), CLOCK);
        service = new PairingService(pairings, devices, codes, CLOCK);
    }

    private Device desktop() {
        return deviceService.register(DeviceType.DESKTOP, "Test Desktop").device();
    }

    private Device phone() {
        return deviceService.register(DeviceType.PHONE, "Test Phone").device();
    }

    @Test
    void redeemingCodeCreatesPairing() {
        Device desktop = desktop();
        Device phone = phone();
        String code = service.issueCode(desktop).code();

        Pairing pairing = service.redeemCode(code, phone);

        assertThat(pairing.desktopDeviceId()).isEqualTo(desktop.id());
        assertThat(pairing.phoneDeviceId()).isEqualTo(phone.id());
        assertThat(pairing.isActive()).isTrue();
        assertThat(service.verifyPairing(phone.id(), desktop.id())).isPresent();
    }

    @Test
    void rePairingDoesNotCreateADuplicate() {
        Device desktop = desktop();
        Device phone = phone();

        Pairing first = service.redeemCode(service.issueCode(desktop).code(), phone);
        Pairing second = service.redeemCode(service.issueCode(desktop).code(), phone);

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(pairings.count()).isEqualTo(1);
    }

    @Test
    void invalidCodeIsRejected() {
        Device phone = phone();

        assertThatThrownBy(() -> service.redeemCode("123456", phone))
                .isInstanceOf(PairingService.InvalidPairCodeException.class);
    }

    @Test
    void onlyDesktopsIssueCodesAndOnlyPhonesRedeemThem() {
        Device desktop = desktop();
        Device phone = phone();

        assertThatThrownBy(() -> service.issueCode(phone)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.redeemCode(service.issueCode(desktop).code(), desktop))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void verifyPairingRejectsUnknownAndRevokedIdentically() {
        Device desktop = desktop();
        Device phone = phone();

        // Never paired.
        assertThat(service.verifyPairing(phone.id(), desktop.id())).isEmpty();
        // Unknown device id.
        assertThat(service.verifyPairing(phone.id(), UUID.randomUUID())).isEmpty();

        Pairing pairing = service.redeemCode(service.issueCode(desktop).code(), phone);
        assertThat(service.verifyPairing(phone.id(), desktop.id())).isPresent();

        service.revoke(pairing.id(), phone.id());
        assertThat(service.verifyPairing(phone.id(), desktop.id())).isEmpty();
    }

    @Test
    void revokeRequiresBeingPartOfThePairing() {
        Device desktop = desktop();
        Device phone = phone();
        Device stranger = phone();
        Pairing pairing = service.redeemCode(service.issueCode(desktop).code(), phone);

        assertThat(service.revoke(pairing.id(), stranger.id())).isEmpty();
        assertThat(service.verifyPairing(phone.id(), desktop.id())).isPresent();
    }

    @Test
    void revokedPairingCanBeRecreated() {
        Device desktop = desktop();
        Device phone = phone();
        Pairing first = service.redeemCode(service.issueCode(desktop).code(), phone);
        service.revoke(first.id(), phone.id());

        Pairing second = service.redeemCode(service.issueCode(desktop).code(), phone);

        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(service.verifyPairing(phone.id(), desktop.id())).isPresent();
    }

    @Test
    void listPairingsResolvesPeerAndOnlineState() {
        Device desktop = desktop();
        Device phone = phone();
        service.redeemCode(service.issueCode(desktop).code(), phone);

        var fromPhone = service.listPairings(phone.id(), id -> id.equals(desktop.id()));

        assertThat(fromPhone).hasSize(1);
        assertThat(fromPhone.getFirst().peer().id()).isEqualTo(desktop.id());
        assertThat(fromPhone.getFirst().peerOnline()).isTrue();

        var fromDesktop = service.listPairings(desktop.id(), id -> false);
        assertThat(fromDesktop).hasSize(1);
        assertThat(fromDesktop.getFirst().peer().id()).isEqualTo(phone.id());
        assertThat(fromDesktop.getFirst().peerOnline()).isFalse();
    }

    @Test
    void revokedPairingDisappearsFromTheList() {
        Device desktop = desktop();
        Device phone = phone();
        Pairing pairing = service.redeemCode(service.issueCode(desktop).code(), phone);

        service.revoke(pairing.id(), desktop.id());

        assertThat(service.listPairings(phone.id(), id -> false)).isEmpty();
    }
}
