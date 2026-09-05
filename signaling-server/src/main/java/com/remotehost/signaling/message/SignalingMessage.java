package com.remotehost.signaling.message;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.remotehost.signaling.domain.DeviceType;

/**
 * The complete signaling message catalog.
 * <p>
 * Every message on the wire is a JSON object discriminated by a {@code type} property, with
 * camelCase fields so TypeScript and Jackson both map them without remapping annotations. Jackson
 * writes and consumes {@code type} itself, so the records below carry payload fields only.
 * <p>
 * One hierarchy covers both directions: {@code sdpOffer}, {@code sdpAnswer}, {@code
 * iceCandidate} and {@code echo} genuinely travel both ways. A client that sends a server-only
 * message simply falls through to the handler's rejection path.
 * <p>
 * The server never inspects the {@code sdp} or {@code candidate} strings — they are opaque blobs
 * relayed verbatim, which is what keeps media off our infrastructure (CLAUDE.md).
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "type")
@JsonSubTypes({
        // client -> server
        @JsonSubTypes.Type(value = SignalingMessage.Register.class, name = "register"),
        @JsonSubTypes.Type(value = SignalingMessage.Authenticate.class, name = "authenticate"),
        @JsonSubTypes.Type(value = SignalingMessage.PairCodeRequest.class, name = "pairCodeRequest"),
        @JsonSubTypes.Type(value = SignalingMessage.PairCodeSubmit.class, name = "pairCodeSubmit"),
        @JsonSubTypes.Type(value = SignalingMessage.ConnectRequest.class, name = "connectRequest"),
        @JsonSubTypes.Type(value = SignalingMessage.EndSession.class, name = "endSession"),
        @JsonSubTypes.Type(value = SignalingMessage.Heartbeat.class, name = "heartbeat"),
        // server -> client
        @JsonSubTypes.Type(value = SignalingMessage.Registered.class, name = "registered"),
        @JsonSubTypes.Type(value = SignalingMessage.Authenticated.class, name = "authenticated"),
        @JsonSubTypes.Type(value = SignalingMessage.PairCodeIssued.class, name = "pairCodeIssued"),
        @JsonSubTypes.Type(value = SignalingMessage.PairedConfirmed.class, name = "pairedConfirmed"),
        @JsonSubTypes.Type(value = SignalingMessage.ConnectRejected.class, name = "connectRejected"),
        @JsonSubTypes.Type(value = SignalingMessage.SessionStarted.class, name = "sessionStarted"),
        @JsonSubTypes.Type(value = SignalingMessage.PeerDisconnected.class, name = "peerDisconnected"),
        @JsonSubTypes.Type(value = SignalingMessage.HeartbeatAck.class, name = "heartbeatAck"),
        @JsonSubTypes.Type(value = SignalingMessage.ErrorMessage.class, name = "error"),
        // both directions
        @JsonSubTypes.Type(value = SignalingMessage.SdpOffer.class, name = "sdpOffer"),
        @JsonSubTypes.Type(value = SignalingMessage.SdpAnswer.class, name = "sdpAnswer"),
        @JsonSubTypes.Type(value = SignalingMessage.IceCandidate.class, name = "iceCandidate"),
        @JsonSubTypes.Type(value = SignalingMessage.Echo.class, name = "echo"),
})
public sealed interface SignalingMessage {

    // ---------------------------------------------------------------- client -> server

    /** Enrollment. Issued once per physical device; the reply carries the only copy of the secret. */
    record Register(DeviceType deviceType, String displayName) implements SignalingMessage {
    }

    /** Every subsequent connection proves identity with the stored credential. */
    record Authenticate(UUID deviceId, String credential) implements SignalingMessage {
    }

    /** Desktop asks for a 6-digit code to display for first-time pairing. */
    record PairCodeRequest() implements SignalingMessage {
    }

    /** Phone redeems a code it was shown on the desktop. */
    record PairCodeSubmit(String code) implements SignalingMessage {
    }

    /** Phone asks to start a session with a desktop it is already paired with. */
    record ConnectRequest(UUID targetDeviceId) implements SignalingMessage {
    }

    /** Either peer tears the session down deliberately. */
    record EndSession(UUID sessionId) implements SignalingMessage {
    }

    /** Liveness. Refreshes the presence entry. */
    record Heartbeat() implements SignalingMessage {
    }

    // ---------------------------------------------------------------- server -> client

    /** Reply to {@code register}. {@code credential} is never retrievable again. */
    record Registered(UUID deviceId, String credential, DeviceType deviceType)
            implements
                SignalingMessage {
    }

    record Authenticated(UUID deviceId, DeviceType deviceType) implements SignalingMessage {
    }

    record PairCodeIssued(String code, Instant expiresAt) implements SignalingMessage {
    }

    /** Sent to both sides once a pairing record exists. */
    record PairedConfirmed(UUID pairingId, UUID peerDeviceId, String peerDisplayName)
            implements
                SignalingMessage {
    }

    /**
     * Uniform rejection. {@code reason} is {@code notPaired} for unknown, unpaired and revoked alike —
     * distinguishing them would let a caller enumerate which device IDs exist.
     */
    record ConnectRejected(String reason) implements SignalingMessage {
    }

    /** Both peers receive this; {@code role} tells each one which side it is. */
    record SessionStarted(UUID sessionId, UUID peerDeviceId, DeviceType role)
            implements
                SignalingMessage {
    }

    record PeerDisconnected(UUID sessionId) implements SignalingMessage {
    }

    record HeartbeatAck(Instant serverTime) implements SignalingMessage {
    }

    record ErrorMessage(String code, String message) implements SignalingMessage {
    }

    // ---------------------------------------------------------------- both directions

    record SdpOffer(UUID sessionId, String sdp) implements SignalingMessage {
    }

    record SdpAnswer(UUID sessionId, String sdp) implements SignalingMessage {
    }

    record IceCandidate(UUID sessionId, String candidate, String sdpMid, Integer sdpMLineIndex)
            implements
                SignalingMessage {
    }

    /** Connectivity probe: the server returns the payload unchanged. */
    record Echo(String payload) implements SignalingMessage {
    }
}
