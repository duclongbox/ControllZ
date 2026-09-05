package com.remotehost.signaling.config;

import java.util.List;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.remotehost.signaling.rest.auth.CurrentDeviceArgumentResolver;

/** Wires device credential resolution and CORS for the REST API. */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final CurrentDeviceArgumentResolver currentDeviceArgumentResolver;
    private final SignalingProperties properties;

    public WebMvcConfig(
            CurrentDeviceArgumentResolver currentDeviceArgumentResolver, SignalingProperties properties) {
        this.currentDeviceArgumentResolver = currentDeviceArgumentResolver;
        this.properties = properties;
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(currentDeviceArgumentResolver);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // The phone client is served from a different origin than this API in every environment,
        // including dev (Vite on :5173, server on :8080).
        registry.addMapping("/api/**")
                .allowedOriginPatterns(properties.allowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }
}
