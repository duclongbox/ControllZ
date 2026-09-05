-- Durable store for device identity and pairings.
--
-- NOT YET ACTIVE: the server currently runs against in-memory repository adapters, so no
-- datasource is configured and Flyway does not run. This migration is committed now so the schema
-- is version-controlled from the start and the JPA adapter has a target to map to. Activating it
-- means adding spring-boot-starter-data-jpa, postgresql and flyway-core, pointing
-- spring.datasource.url at Neon, and swapping the InMemory* repositories for JPA ones.
--
-- Only durable data lives here. Pairing codes (5-minute TTL), presence and in-flight sessions are
-- deliberately in-process: see PairingCodeStore, PresenceRegistry and SessionRegistry.

CREATE TYPE device_type AS ENUM ('desktop', 'phone');

CREATE TABLE devices (
    id              uuid        PRIMARY KEY,
    device_type     device_type NOT NULL,
    -- Salted SHA-256 as "<saltHex>:<hashHex>". Credentials are 256-bit random values, not
    -- user-chosen passwords, so a slow KDF buys nothing here. Switch to Argon2id if that changes.
    credential_hash text        NOT NULL,
    display_name    text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz
);

CREATE TABLE pairings (
    id                uuid        PRIMARY KEY,
    desktop_device_id uuid        NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    phone_device_id   uuid        NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- Revocation is a tombstone, not a delete: it has to stay auditable, and verify_pairing reads
    -- the same row either way.
    revoked_at        timestamptz,
    CONSTRAINT pairings_distinct_devices CHECK (desktop_device_id <> phone_device_id)
);

-- At most one *active* pairing per (desktop, phone). Partial, so revoke-then-re-pair still works.
CREATE UNIQUE INDEX pairings_active_uniq
    ON pairings (desktop_device_id, phone_device_id)
    WHERE revoked_at IS NULL;

-- The hot path: every connectRequest runs verify_pairing.
CREATE INDEX pairings_lookup
    ON pairings (phone_device_id, desktop_device_id)
    WHERE revoked_at IS NULL;

-- Listing "which devices am I paired with" hits the desktop side too.
CREATE INDEX pairings_by_desktop
    ON pairings (desktop_device_id)
    WHERE revoked_at IS NULL;
