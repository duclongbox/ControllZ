package com.remotehost.signaling;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

import com.remotehost.signaling.config.SignalingProperties;

@SpringBootApplication
@ConfigurationPropertiesScan(basePackageClasses = SignalingProperties.class)
public class SignalingServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(SignalingServerApplication.class, args);
    }

}
