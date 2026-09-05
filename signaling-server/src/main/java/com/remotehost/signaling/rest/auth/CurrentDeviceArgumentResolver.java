package com.remotehost.signaling.rest.auth;

import java.util.UUID;

import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.service.DeviceService;

/**
 * Resolves {@code @CurrentDevice Device} parameters from the request's credentials.
 *
 * <p>
 * Scheme: {@code Authorization: Bearer <deviceId>:<credential>}. Deliberately not Spring Security —
 * there are no users, roles or sessions here, just one bearer secret per device, and a full
 * security filter chain would be more configuration than protection at this size.
 */
@Component
public class CurrentDeviceArgumentResolver implements HandlerMethodArgumentResolver {

    private static final String BEARER_PREFIX = "Bearer ";

    private final DeviceService deviceService;

    public CurrentDeviceArgumentResolver(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentDevice.class)
                && Device.class.isAssignableFrom(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer mavContainer,
            NativeWebRequest webRequest,
            WebDataBinderFactory binderFactory) {

        String header = webRequest.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            throw new UnauthorizedException("Expected 'Authorization: Bearer <deviceId>:<credential>'");
        }
        String token = header.substring(BEARER_PREFIX.length()).trim();
        int separator = token.indexOf(':');
        if (separator <= 0 || separator == token.length() - 1) {
            throw new UnauthorizedException("Malformed credentials");
        }

        UUID deviceId;
        try {
            deviceId = UUID.fromString(token.substring(0, separator));
        } catch (IllegalArgumentException e) {
            throw new UnauthorizedException("Malformed credentials");
        }
        String credential = token.substring(separator + 1);

        // One message for unknown device and wrong secret alike, so this endpoint cannot be used
        // to probe which device IDs exist.
        return deviceService
                .authenticate(deviceId, credential)
                .orElseThrow(() -> new UnauthorizedException("Unknown device or bad credential"));
    }
}
