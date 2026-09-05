package com.remotehost.signaling.ws;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import com.remotehost.signaling.service.AttemptLimiter;

import tools.jackson.databind.ObjectMapper;

/**
 * The attempt limiter as actually wired into the pairing path.
 *
 * <p>
 * Separate from {@link SignalingFlowIntegrationTest} because proving the limiter works means
 * spending its entire budget, and the budget is keyed on source address — every test in this JVM
 * connects from loopback, so an exhausted limiter left behind in the shared application context
 * would break every other test that submits a pairing code. Clearing the loopback keys either side
 * of the test keeps that state from leaking in both directions.
 *
 * <p>
 * {@link AttemptLimiterTest} pins the window semantics; what this test adds is that the handler
 * actually consults the limiter before touching the code, and maps a refusal to {@code rateLimited}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PairingRateLimitIntegrationTest {

    /** Both spellings of loopback, since which one shows up depends on the stack in use. */
    private static final List<String> LOOPBACK = List.of("127.0.0.1", "0:0:0:0:0:0:0:1", "unknown");

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    AttemptLimiter limiter;

    @BeforeEach
    @AfterEach
    void clearLimiter() {
        LOOPBACK.forEach(limiter::reset);
    }

    @Test
    void pairingSubmissionsFromOneSourceAreCutOffOnceTheBudgetIsSpent() throws Exception {
        try (TestSignalingClient phone = new TestSignalingClient("ws://localhost:" + port + "/ws", objectMapper)) {
            phone.send("register", Map.of("deviceType", "phone", "displayName", "Guessing Phone"));
            phone.await("registered");

            List<String> codes = new ArrayList<>();
            for (int attempt = 1; attempt <= AttemptLimiter.MAX_ATTEMPTS + 1; attempt++) {
                phone.send("pairCodeSubmit", Map.of("code", "000000"));
                codes.add((String) phone.await("error").get("code"));
            }

            // Every attempt inside the budget is judged on the code itself; the one past it
            // is refused without the code being looked at at all.
            assertThat(codes.subList(0, AttemptLimiter.MAX_ATTEMPTS))
                    .as("attempts within the budget")
                    .containsOnly("invalidPairCode");
            assertThat(codes.getLast()).isEqualTo("rateLimited");
        }
    }

    @Test
    void aThrottledSourceCannotRedeemEvenACorrectCode() throws Exception {
        try (TestSignalingClient desktop = new TestSignalingClient("ws://localhost:" + port + "/ws", objectMapper);
                TestSignalingClient phone = new TestSignalingClient("ws://localhost:" + port + "/ws", objectMapper)) {
            desktop.send("register", Map.of("deviceType", "desktop", "displayName", "Throttled Desktop"));
            desktop.await("registered");
            phone.send("register", Map.of("deviceType", "phone", "displayName", "Throttled Phone"));
            phone.await("registered");

            desktop.send("pairCodeRequest");
            String code = (String) desktop.await("pairCodeIssued").get("code");

            for (int attempt = 1; attempt <= AttemptLimiter.MAX_ATTEMPTS; attempt++) {
                phone.send("pairCodeSubmit", Map.of("code", "000000"));
                phone.await("error");
            }

            phone.send("pairCodeSubmit", Map.of("code", code));

            // The limiter is checked before the code is, so being throttled blocks the
            // legitimate redemption too. That is the intended trade: it is what stops an
            // attacker from sweeping the space, and it is why a success resets the counter.
            assertThat(phone.await("error")).containsEntry("code", "rateLimited");
        }
    }
}
