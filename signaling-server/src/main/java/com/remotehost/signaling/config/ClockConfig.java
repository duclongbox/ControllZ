package com.remotehost.signaling.config;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * A single injectable {@link Clock}.
 *
 * <p>
 * Everything with a deadline — pairing-code expiry, session start times, last-seen stamps — reads
 * time through this bean, so tests can advance time instead of sleeping.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
