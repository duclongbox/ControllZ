package com.remotehost.signaling.domain;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Which side of a session a device can occupy. A session holds exactly one of each. */
public enum DeviceType {
    DESKTOP, PHONE;

    /** Wire form is lowercase per the shared schema convention: {@code "desktop"}, {@code "phone"}. */
    @JsonValue
    public String wireName() {
        return name().toLowerCase(Locale.ROOT);
    }

    @JsonCreator
    public static DeviceType fromWire(String value) {
        if (value == null) {
            return null;
        }
        return valueOf(value.toUpperCase(Locale.ROOT));
    }
}
