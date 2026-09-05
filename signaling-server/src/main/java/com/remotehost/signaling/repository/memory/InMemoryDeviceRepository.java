package com.remotehost.signaling.repository.memory;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Repository;

import com.remotehost.signaling.domain.Device;
import com.remotehost.signaling.repository.DeviceRepository;

/**
 * In-memory device store.
 *
 * <p>
 * This is the durable store's stand-in until Neon Postgres is provisioned; the schema it will
 * become is already committed as a Flyway migration. Devices do not survive a restart here, which
 * is fine for development and wrong for production — swapping in the JPA adapter is the only change
 * needed, since nothing above this class knows the difference.
 */
@Repository
public class InMemoryDeviceRepository implements DeviceRepository {

    private final Map<UUID, Device> devices = new ConcurrentHashMap<>();

    @Override
    public Device save(Device device) {
        devices.put(device.id(), device);
        return device;
    }

    @Override
    public Optional<Device> findById(UUID id) {
        return Optional.ofNullable(devices.get(id));
    }

    @Override
    public long count() {
        return devices.size();
    }
}
