package com.remotehost.signaling.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import com.remotehost.signaling.ws.SignalingWebSocketHandler;

/**
 * Registers the signaling endpoint.
 *
 * <p>
 * Raw WebSocket, not STOMP: the protocol is a handful of small JSON messages between exactly two
 * peers, and a broker abstraction would add a dependency and a frame format for nothing.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final SignalingWebSocketHandler handler;
    private final SignalingProperties properties;

    public WebSocketConfig(SignalingWebSocketHandler handler, SignalingProperties properties) {
        this.handler = handler;
        this.properties = properties;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws")
                .setAllowedOriginPatterns(properties.allowedOrigins().toArray(String[]::new));
    }
}
