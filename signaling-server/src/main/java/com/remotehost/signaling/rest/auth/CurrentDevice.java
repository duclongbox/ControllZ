package com.remotehost.signaling.rest.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Injects the calling device, resolved from the {@code Authorization} header, into a controller
 * method. A request without valid credentials never reaches the method body.
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentDevice {
}
