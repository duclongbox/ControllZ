package com.remotehost.signaling.ws;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import org.awaitility.Awaitility;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import tools.jackson.databind.ObjectMapper;

/**
 * The whole signaling protocol over real WebSocket connections: enrol, pair, connect, relay,
 * disconnect.
 * Uses two live clients rather than mocks because the interesting failures here are about two
 * connections interacting — relaying to the wrong peer, missing a disconnect notice, interleaving
 * frames — none of which a single-session unit test can catch.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SignalingFlowIntegrationTest {

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper objectMapper;

    private TestSignalingClient connect() throws Exception {
        return new TestSignalingClient("ws://localhost:" + port + "/ws", objectMapper);
    }

    /** Registers a device and returns {deviceId, credential}. */
    private Map<String, Object> register(TestSignalingClient client, String deviceType, String name) {
        client.send("register", Map.of("deviceType", deviceType, "displayName", name));
        Map<String, Object> registered = client.await("registered");
        assertThat(registered.get("deviceId")).isNotNull();
        assertThat(registered.get("credential")).isNotNull();
        return registered;
    }

    /** Drives a desktop and phone all the way to an open session. */
    private record PairedPeers(
            TestSignalingClient desktop, TestSignalingClient phone, String desktopId, String phoneId) {
    }

    private PairedPeers pair(TestSignalingClient desktop, TestSignalingClient phone) {
        String desktopId = (String) register(desktop, "desktop", "Test Desktop").get("deviceId");
        String phoneId = (String) register(phone, "phone", "Test Phone").get("deviceId");

        desktop.send("pairCodeRequest");
        String code = (String) desktop.await("pairCodeIssued").get("code");

        phone.send("pairCodeSubmit", Map.of("code", code));
        phone.await("pairedConfirmed");
        desktop.await("pairedConfirmed");

        return new PairedPeers(desktop, phone, desktopId, phoneId);
    }

    @Test
    void echoRoundTripsWithoutAuthentication() throws Exception {
        try (TestSignalingClient client = connect()) {
            client.send("echo", Map.of("payload", "hello signaling"));

            assertThat(client.await("echo")).containsEntry("payload", "hello signaling");
        }
    }

    @Test
    void protectedMessagesRequireAuthentication() throws Exception {
        try (TestSignalingClient client = connect()) {
            client.send("pairCodeRequest");

            assertThat(client.await("error")).containsEntry("code", "notAuthenticated");
        }
    }

    @Test
    void registeredDeviceCanAuthenticateOnANewConnection() throws Exception {
        String deviceId;
        String credential;
        try (TestSignalingClient first = connect()) {
            Map<String, Object> registered = register(first, "phone", "Reconnecting Phone");
            deviceId = (String) registered.get("deviceId");
            credential = (String) registered.get("credential");
        }

        try (TestSignalingClient second = connect()) {
            second.send("authenticate", Map.of("deviceId", deviceId, "credential", credential));

            assertThat(second.await("authenticated")).containsEntry("deviceId", deviceId);
        }
    }

    @Test
    void authenticationRejectsABadCredential() throws Exception {
        try (TestSignalingClient client = connect()) {
            client.send(
                    "authenticate",
                    Map.of("deviceId", UUID.randomUUID().toString(), "credential", "nonsense"));

            assertThat(client.await("error")).containsEntry("code", "invalidCredential");
        }
    }

    @Test
    void pairingCodeFlowConfirmsBothSides() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            String desktopId = (String) register(desktop, "desktop", "My Mac").get("deviceId");
            String phoneId = (String) register(phone, "phone", "My Phone").get("deviceId");

            desktop.send("pairCodeRequest");
            Map<String, Object> issued = desktop.await("pairCodeIssued");
            assertThat((String) issued.get("code")).hasSize(6);

            phone.send("pairCodeSubmit", Map.of("code", issued.get("code")));

            Map<String, Object> phoneConfirmation = phone.await("pairedConfirmed");
            assertThat(phoneConfirmation)
                    .containsEntry("peerDeviceId", desktopId)
                    .containsEntry("peerDisplayName", "My Mac");

            Map<String, Object> desktopConfirmation = desktop.await("pairedConfirmed");
            assertThat(desktopConfirmation)
                    .containsEntry("peerDeviceId", phoneId)
                    .containsEntry("peerDisplayName", "My Phone");
        }
    }

    @Test
    void wrongPairingCodeIsRejected() throws Exception {
        try (TestSignalingClient phone = connect()) {
            register(phone, "phone", "My Phone");

            phone.send("pairCodeSubmit", Map.of("code", "000001"));

            assertThat(phone.await("error")).containsEntry("code", "invalidPairCode");
        }
    }

    @Test
    void connectRequestWithoutPairingIsRejectedAsNotPaired() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            String desktopId = (String) register(desktop, "desktop", "Unpaired Desktop").get("deviceId");
            register(phone, "phone", "Unpaired Phone");

            phone.send("connectRequest", Map.of("targetDeviceId", desktopId));

            assertThat(phone.await("connectRejected")).containsEntry("reason", "notPaired");
        }
    }

    @Test
    void connectRequestForAnUnknownDeviceLooksIdenticalToUnpaired() throws Exception {
        try (TestSignalingClient phone = connect()) {
            register(phone, "phone", "Curious Phone");

            phone.send("connectRequest", Map.of("targetDeviceId", UUID.randomUUID().toString()));

            // Identical to the unpaired case on purpose: device IDs must not be enumerable.
            assertThat(phone.await("connectRejected")).containsEntry("reason", "notPaired");
        }
    }

    @Test
    void connectRequestToAnOfflineDesktopReportsDesktopOffline() throws Exception {
        String desktopId;
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            PairedPeers peers = pair(desktop, phone);
            desktopId = peers.desktopId();
            desktop.close();

            // Presence removal happens on the server thread that handles the close.
            Awaitility.await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
                phone.send("connectRequest", Map.of("targetDeviceId", desktopId));
                assertThat(phone.await("connectRejected")).containsEntry("reason", "desktopOffline");
            });
        }
    }

    @Test
    void pairedPeersExchangeOfferAnswerAndCandidates() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            PairedPeers peers = pair(desktop, phone);

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));

            // The desktop is the offerer, so it is told first.
            Map<String, Object> desktopStart = desktop.await("sessionStarted");
            Map<String, Object> phoneStart = phone.await("sessionStarted");
            String sessionId = (String) desktopStart.get("sessionId");

            assertThat(desktopStart).containsEntry("role", "desktop").containsEntry("peerDeviceId", peers.phoneId());
            assertThat(phoneStart).containsEntry("role", "phone").containsEntry("peerDeviceId", peers.desktopId());
            assertThat(phoneStart.get("sessionId")).isEqualTo(sessionId);

            // SDP must arrive byte-for-byte: the server does not parse or rewrite it.
            String offerSdp = "v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
            desktop.send("sdpOffer", Map.of("sessionId", sessionId, "sdp", offerSdp));
            assertThat(phone.await("sdpOffer")).containsEntry("sdp", offerSdp).containsEntry("sessionId", sessionId);

            String answerSdp = "v=0\r\no=- 43 2 IN IP4 127.0.0.1\r\na=recvonly\r\n";
            phone.send("sdpAnswer", Map.of("sessionId", sessionId, "sdp", answerSdp));
            assertThat(desktop.await("sdpAnswer")).containsEntry("sdp", answerSdp);

            phone.send(
                    "iceCandidate",
                    Map.of(
                            "sessionId", sessionId,
                            "candidate", "candidate:1 1 UDP 2130706431 192.168.1.5 54321 typ host",
                            "sdpMid", "0",
                            "sdpMLineIndex", 0));
            assertThat(desktop.await("iceCandidate"))
                    .containsEntry("candidate", "candidate:1 1 UDP 2130706431 192.168.1.5 54321 typ host")
                    .containsEntry("sdpMid", "0")
                    .containsEntry("sdpMLineIndex", 0);
        }
    }

    @Test
    void relayingToAnUnknownSessionIsRejected() throws Exception {
        try (TestSignalingClient phone = connect()) {
            register(phone, "phone", "Lonely Phone");

            phone.send("sdpAnswer", Map.of("sessionId", UUID.randomUUID().toString(), "sdp", "v=0"));

            assertThat(phone.await("error")).containsEntry("code", "unknownSession");
        }
    }

    @Test
    void aThirdDeviceCannotRelayIntoSomeoneElsesSession() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect();
                TestSignalingClient intruder = connect()) {
            PairedPeers peers = pair(desktop, phone);
            register(intruder, "phone", "Intruder");

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));
            String sessionId = (String) desktop.await("sessionStarted").get("sessionId");
            phone.await("sessionStarted");

            intruder.send("sdpOffer", Map.of("sessionId", sessionId, "sdp", "malicious"));

            assertThat(intruder.await("error")).containsEntry("code", "unknownSession");
            assertThat(desktop.receivedNothing(Duration.ofMillis(500))).isTrue();
            assertThat(phone.receivedNothing(Duration.ofMillis(500))).isTrue();
        }
    }

    @Test
    void disconnectingOnePeerNotifiesTheOther() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            PairedPeers peers = pair(desktop, phone);

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));
            String sessionId = (String) desktop.await("sessionStarted").get("sessionId");
            phone.await("sessionStarted");

            desktop.close();

            assertThat(phone.await("peerDisconnected")).containsEntry("sessionId", sessionId);
        }
    }

    @Test
    void endSessionNotifiesTheOtherPeer() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            PairedPeers peers = pair(desktop, phone);

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));
            String sessionId = (String) desktop.await("sessionStarted").get("sessionId");
            phone.await("sessionStarted");

            phone.send("endSession", Map.of("sessionId", sessionId));

            assertThat(desktop.await("peerDisconnected")).containsEntry("sessionId", sessionId);
        }
    }

    @Test
    void heartbeatIsAcknowledged() throws Exception {
        try (TestSignalingClient phone = connect()) {
            register(phone, "phone", "Beating Phone");

            phone.send("heartbeat");

            assertThat(phone.await("heartbeatAck").get("serverTime")).isNotNull();
        }
    }

    @Test
    void malformedJsonGetsAnErrorRatherThanADroppedConnection() throws Exception {
        try (TestSignalingClient client = connect()) {
            client.send("thisTypeDoesNotExist", Map.of("nonsense", true));

            assertThat(client.await("error")).containsEntry("code", "malformedMessage");
            assertThat(client.isOpen()).isTrue();
        }
    }

    @Test
    void reconnectingTheSameDeviceDisplacesTheOlderConnection() throws Exception {
        Map<String, Object> registered;
        try (TestSignalingClient first = connect();
                TestSignalingClient second = connect()) {
            registered = register(first, "phone", "Twice Connected");

            second.send(
                    "authenticate",
                    Map.of("deviceId", registered.get("deviceId"), "credential", registered.get("credential")));
            second.await("authenticated");

            // One connection per device: the stale one is closed rather than left half-alive.
            Awaitility.await().atMost(Duration.ofSeconds(5)).until(() -> !first.isOpen());
            assertThat(second.isOpen()).isTrue();
        }
    }

    @Test
    void authenticatingTwiceOnOneConnectionIsRejected() throws Exception {
        try (TestSignalingClient client = connect()) {
            Map<String, Object> registered = register(client, "phone", "Eager Phone");

            client.send(
                    "authenticate",
                    Map.of("deviceId", registered.get("deviceId"), "credential", registered.get("credential")));

            // Identity binds once per connection. Rebinding would let a socket change who it is
            // mid-session, and every relay and session check downstream assumes it cannot.
            assertThat(client.await("error")).containsEntry("code", "alreadyAuthenticated");
        }
    }

    @Test
    void onlyADesktopIssuesCodesAndOnlyAPhoneSubmitsThem() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            register(desktop, "desktop", "Strict Desktop");
            register(phone, "phone", "Strict Phone");

            phone.send("pairCodeRequest");
            assertThat(phone.await("error")).containsEntry("code", "wrongDeviceType");

            desktop.send("pairCodeRequest");
            String code = (String) desktop.await("pairCodeIssued").get("code");

            desktop.send("pairCodeSubmit", Map.of("code", code));
            assertThat(desktop.await("error")).containsEntry("code", "wrongDeviceType");
        }
    }

    @Test
    void aRedeemedPairingCodeCannotBeReplayed() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect();
                TestSignalingClient eavesdropper = connect()) {
            register(desktop, "desktop", "One Shot Desktop");
            register(phone, "phone", "First Phone");
            register(eavesdropper, "phone", "Second Phone");

            desktop.send("pairCodeRequest");
            String code = (String) desktop.await("pairCodeIssued").get("code");

            phone.send("pairCodeSubmit", Map.of("code", code));
            phone.await("pairedConfirmed");
            desktop.await("pairedConfirmed");

            // Single use: a code seen over someone's shoulder is already spent, and is
            // indistinguishable from one that never existed.
            eavesdropper.send("pairCodeSubmit", Map.of("code", code));

            assertThat(eavesdropper.await("error")).containsEntry("code", "invalidPairCode");
        }
    }

    @Test
    void aSecondConnectRequestDuringALiveSessionIsRejected() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            PairedPeers peers = pair(desktop, phone);

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));
            desktop.await("sessionStarted");
            phone.await("sessionStarted");

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));

            // Rejected rather than silently replacing the session, so a stale phone tab
            // cannot knock a working stream off its desktop.
            assertThat(phone.await("connectRejected")).containsEntry("reason", "alreadyInSession");
        }
    }

    @Test
    void endingASessionFreesBothDevicesForANewOne() throws Exception {
        try (TestSignalingClient desktop = connect();
                TestSignalingClient phone = connect()) {
            PairedPeers peers = pair(desktop, phone);

            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));
            String first = (String) desktop.await("sessionStarted").get("sessionId");
            phone.await("sessionStarted");

            phone.send("endSession", Map.of("sessionId", first));
            desktop.await("peerDisconnected");

            // The busy-device index has to be cleared on teardown, or a dropped session
            // would strand both devices until a restart.
            phone.send("connectRequest", Map.of("targetDeviceId", peers.desktopId()));
            String second = (String) desktop.await("sessionStarted").get("sessionId");
            phone.await("sessionStarted");

            assertThat(second).isNotNull().isNotEqualTo(first);
        }
    }
}
