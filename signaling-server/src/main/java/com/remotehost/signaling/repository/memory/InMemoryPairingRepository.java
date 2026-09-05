package com.remotehost.signaling.repository.memory;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Repository;

import com.remotehost.signaling.domain.Pairing;
import com.remotehost.signaling.repository.PairingRepository;

/**
 * In-memory pairing store. See {@link InMemoryDeviceRepository} for the durability caveat.
 *
 * <p>
 * The uniqueness rule enforced by {@code pairings_active_uniq} in the Postgres schema — at most one
 * active pairing per (desktop, phone) — is enforced here in {@link #save}, so both adapters behave
 * the same way.
 */
@Repository
public class InMemoryPairingRepository implements PairingRepository {

    private final Map<UUID, Pairing> pairings = new ConcurrentHashMap<>();

    @Override
    public Pairing save(Pairing pairing) {
        pairings.put(pairing.id(), pairing);
        return pairing;
    }

    @Override
    public Optional<Pairing> findById(UUID id) {
        return Optional.ofNullable(pairings.get(id));
    }

    @Override
    public Optional<Pairing> findActiveBetween(UUID desktopDeviceId, UUID phoneDeviceId) {
        return pairings.values().stream()
                .filter(Pairing::isActive)
                .filter(p -> p.desktopDeviceId().equals(desktopDeviceId)
                        && p.phoneDeviceId().equals(phoneDeviceId))
                .findFirst();
    }

    @Override
    public List<Pairing> findActiveForDevice(UUID deviceId) {
        return pairings.values().stream()
                .filter(Pairing::isActive)
                .filter(p -> p.desktopDeviceId().equals(deviceId) || p.phoneDeviceId().equals(deviceId))
                .sorted(java.util.Comparator.comparing(Pairing::createdAt))
                .toList();
    }

    @Override
    public long count() {
        return pairings.size();
    }
}
