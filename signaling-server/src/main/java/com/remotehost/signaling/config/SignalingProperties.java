package com.remotehost.signaling.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Tunables for the signaling server.
 *
 * @param allowedOrigins
 *            origin patterns permitted to open a WebSocket or call the REST API. The default is
 *            permissive so a phone on the LAN can connect during development; lock this down to the
 *            deployed web-client origin before this is reachable from the internet.
 */
@ConfigurationProperties(prefix = "signaling")
public record SignalingProperties(List<String> allowedOrigins) {

    public SignalingProperties {
        if (allowedOrigins == null || allowedOrigins.isEmpty()) {
            allowedOrigins = List.of("*");
        }
    }
}
