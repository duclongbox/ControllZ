package com.remotehost.signaling.ws;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.ObjectMapper;

/**
 * A minimal WebSocket client for tests: sends message maps, queues what comes back, and lets a test
 * block for the next message rather than sleeping and hoping.
 */
public class TestSignalingClient extends TextWebSocketHandler implements AutoCloseable {

    private static final Duration TIMEOUT = Duration.ofSeconds(5);

    private final BlockingQueue<Map<String, Object>> inbound = new LinkedBlockingQueue<>();
    private final ObjectMapper objectMapper;
    private final WebSocketSession session;

    public TestSignalingClient(String url, ObjectMapper objectMapper) throws Exception {
        this.objectMapper = objectMapper;
        this.session = new StandardWebSocketClient()
                .execute(this, url)
                .get(TIMEOUT.toSeconds(), TimeUnit.SECONDS);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        inbound.add(objectMapper.readValue(message.getPayload(), Map.class));
    }

    /** Sends {@code {"type": type, ...fields}}. */
    public void send(String type, Map<String, Object> fields) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.putAll(fields);
        try {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(payload)));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to send " + type, e);
        }
    }

    public void send(String type) {
        send(type, Map.of());
    }

    /** Blocks for the next message, failing the test rather than hanging forever. */
    public Map<String, Object> await() {
        try {
            Map<String, Object> message = inbound.poll(TIMEOUT.toSeconds(), TimeUnit.SECONDS);
            if (message == null) {
                throw new AssertionError("Timed out waiting for a message after " + TIMEOUT);
            }
            return message;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while waiting for a message", e);
        }
    }

    /** Blocks for the next message and asserts its type. */
    public Map<String, Object> await(String expectedType) {
        Map<String, Object> message = await();
        if (!expectedType.equals(message.get("type"))) {
            throw new AssertionError("Expected a '" + expectedType + "' message but got: " + message);
        }
        return message;
    }

    /** True when nothing arrived within a short grace period. */
    public boolean receivedNothing(Duration grace) {
        try {
            return inbound.poll(grace.toMillis(), TimeUnit.MILLISECONDS) == null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    public boolean isOpen() {
        return session.isOpen();
    }

    @Override
    public void close() throws Exception {
        if (session.isOpen()) {
            session.close(CloseStatus.NORMAL);
        }
    }
}
