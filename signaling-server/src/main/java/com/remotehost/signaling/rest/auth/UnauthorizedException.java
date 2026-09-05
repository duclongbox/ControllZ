package com.remotehost.signaling.rest.auth;

/** Missing, malformed, or rejected device credentials on a REST call. */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}
