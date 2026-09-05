package com.remotehost.signaling.repository;

import java.util.Optional;
import java.util.UUID;

import com.remotehost.signaling.domain.Device;

/**
 * Port for the durable device store.
 *
 * <p>
 * Deliberately not a Spring Data interface: the JPA/Postgres adapter arrives when Neon is
 * provisioned, and keeping the port hand-written means the services never learn about JPA.
 */
public interface DeviceRepository {

    Device save(Device device);

    Optional<Device> findById(UUID id);

    long count();
}
