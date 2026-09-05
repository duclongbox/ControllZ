package com.remotehost.signaling.rest;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import com.remotehost.signaling.domain.DeviceType;
import com.remotehost.signaling.service.DeviceService;
import com.remotehost.signaling.service.PairingService;

/**
 * The REST surface: enrolment, self-service, and the paired-devices listing.
 *
 * <p>
 * Boot 4 no longer registers {@link TestRestTemplate} implicitly, hence the explicit
 * {@code @AutoConfigureTestRestTemplate}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class DeviceApiIntegrationTest {

    @Autowired
    TestRestTemplate rest;

    @Autowired
    DeviceService deviceService;

    @Autowired
    PairingService pairingService;

    /** Enrols a device straight through the service and returns its bearer token. */
    private record Enrolled(UUID id, String token) {
    }

    private Enrolled enroll(DeviceType type, String name) {
        DeviceService.Enrollment enrollment = deviceService.register(type, name);
        return new Enrolled(
                enrollment.device().id(), enrollment.device().id() + ":" + enrollment.credential());
    }

    private HttpHeaders auth(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    @Test
    @SuppressWarnings("unchecked")
    void registerReturnsCredentialExactlyOnce() {
        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/api/v1/devices",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("deviceType", "desktop", "displayName", "REST Mac"), jsonHeaders()),
                (Class<Map<String, Object>>) (Class<?>) Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map<String, Object> body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("deviceId")).isNotNull();
        assertThat(body.get("credential")).isNotNull();
        assertThat(body).containsEntry("deviceType", "desktop").containsEntry("displayName", "REST Mac");

        // Fetching the device again must never expose the credential or its hash.
        String token = body.get("deviceId") + ":" + body.get("credential");
        ResponseEntity<Map<String, Object>> me = rest.exchange(
                "/api/v1/devices/me",
                HttpMethod.GET,
                new HttpEntity<>(auth(token)),
                (Class<Map<String, Object>>) (Class<?>) Map.class);
        assertThat(me.getBody()).doesNotContainKeys("credential", "credentialHash");
    }

    @Test
    void registerRejectsAMissingDeviceType() {
        ResponseEntity<String> response = rest.exchange(
                "/api/v1/devices",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("displayName", "Nameless"), jsonHeaders()),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void protectedEndpointsRejectMissingOrBadCredentials() {
        assertThat(rest.getForEntity("/api/v1/devices/me", String.class).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> badToken = rest.exchange(
                "/api/v1/devices/me",
                HttpMethod.GET,
                new HttpEntity<>(auth(UUID.randomUUID() + ":wrong")),
                String.class);
        assertThat(badToken.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> garbage = rest.exchange(
                "/api/v1/devices/me", HttpMethod.GET, new HttpEntity<>(auth("not-a-token")), String.class);
        assertThat(garbage.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @SuppressWarnings("unchecked")
    void listsPairedDevicesFromBothSides() {
        Enrolled desktop = enroll(DeviceType.DESKTOP, "Paired Mac");
        Enrolled phone = enroll(DeviceType.PHONE, "Paired Phone");
        pairDevices(desktop.id(), phone.id());

        ResponseEntity<Map<String, Object>> fromPhone = rest.exchange(
                "/api/v1/devices/me/pairings",
                HttpMethod.GET,
                new HttpEntity<>(auth(phone.token())),
                (Class<Map<String, Object>>) (Class<?>) Map.class);

        assertThat(fromPhone.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(fromPhone.getBody()).containsEntry("count", 1);
        List<Map<String, Object>> devices = (List<Map<String, Object>>) fromPhone.getBody().get("devices");
        assertThat(devices).hasSize(1);
        assertThat(devices.getFirst())
                .containsEntry("deviceId", desktop.id().toString())
                .containsEntry("deviceType", "desktop")
                .containsEntry("displayName", "Paired Mac")
                // Nothing is connected over WebSocket in this test.
                .containsEntry("online", false);
        assertThat(devices.getFirst().get("pairingId")).isNotNull();

        // The desktop sees the phone, symmetrically.
        ResponseEntity<Map<String, Object>> fromDesktop = rest.exchange(
                "/api/v1/devices/me/pairings",
                HttpMethod.GET,
                new HttpEntity<>(auth(desktop.token())),
                (Class<Map<String, Object>>) (Class<?>) Map.class);
        List<Map<String, Object>> peers = (List<Map<String, Object>>) fromDesktop.getBody().get("devices");
        assertThat(peers.getFirst()).containsEntry("deviceId", phone.id().toString());
    }

    @Test
    @SuppressWarnings("unchecked")
    void pairingListIsEmptyForAnUnpairedDevice() {
        Enrolled phone = enroll(DeviceType.PHONE, "Fresh Phone");

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/api/v1/devices/me/pairings",
                HttpMethod.GET,
                new HttpEntity<>(auth(phone.token())),
                (Class<Map<String, Object>>) (Class<?>) Map.class);

        assertThat(response.getBody()).containsEntry("count", 0);
    }

    @Test
    @SuppressWarnings("unchecked")
    void revokingRemovesThePairingFromBothListings() {
        Enrolled desktop = enroll(DeviceType.DESKTOP, "Revoke Mac");
        Enrolled phone = enroll(DeviceType.PHONE, "Revoke Phone");
        UUID pairingId = pairDevices(desktop.id(), phone.id());

        ResponseEntity<Void> deleted = rest.exchange(
                "/api/v1/pairings/" + pairingId,
                HttpMethod.DELETE,
                new HttpEntity<>(auth(phone.token())),
                Void.class);
        assertThat(deleted.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        ResponseEntity<Map<String, Object>> after = rest.exchange(
                "/api/v1/devices/me/pairings",
                HttpMethod.GET,
                new HttpEntity<>(auth(desktop.token())),
                (Class<Map<String, Object>>) (Class<?>) Map.class);
        assertThat(after.getBody()).containsEntry("count", 0);
    }

    @Test
    void aStrangerCannotRevokeSomeoneElsesPairing() {
        Enrolled desktop = enroll(DeviceType.DESKTOP, "Private Mac");
        Enrolled phone = enroll(DeviceType.PHONE, "Private Phone");
        Enrolled stranger = enroll(DeviceType.PHONE, "Nosy Phone");
        UUID pairingId = pairDevices(desktop.id(), phone.id());

        ResponseEntity<String> response = rest.exchange(
                "/api/v1/pairings/" + pairingId,
                HttpMethod.DELETE,
                new HttpEntity<>(auth(stranger.token())),
                String.class);

        // 404, not 403: a stranger should not even learn that this pairing exists.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @SuppressWarnings("unchecked")
    void deviceCanBeRenamed() {
        Enrolled desktop = enroll(DeviceType.DESKTOP, "Before");

        ResponseEntity<Map<String, Object>> response = rest.exchange(
                "/api/v1/devices/me",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("displayName", "After"), auth(desktop.token())),
                (Class<Map<String, Object>>) (Class<?>) Map.class);

        assertThat(response.getBody()).containsEntry("displayName", "After");
    }

    @Test
    void healthEndpointIsPublic() {
        assertThat(rest.getForEntity("/actuator/health", String.class).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    private UUID pairDevices(UUID desktopId, UUID phoneId) {
        var desktop = deviceService.findById(desktopId).orElseThrow();
        var phone = deviceService.findById(phoneId).orElseThrow();
        String code = pairingService.issueCode(desktop).code();
        return pairingService.redeemCode(code, phone).id();
    }

    private HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
