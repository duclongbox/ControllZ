import { useSyncExternalStore } from 'react'
import type { Device, Transport } from '../session/types'

/* The paired computers this phone knows about.
 *
 * `wsClient` already keeps the two secrets — this phone's device id and its
 * credential — in localStorage. This is the other half: which desktops that
 * credential is good for, and what the user called them. Without it a real
 * pairing vanishes the moment the screen navigates, and `/device/:id` resolves
 * to nothing.
 *
 * `presence` is deliberately NOT stored. Whether a desktop is awake right now
 * is the server's answer (`authenticated` carries it, per system-design), and
 * a remembered "online" would be a lie the moment the phone is reopened. Every
 * record therefore reads `offline` until presence arrives, and the list copy
 * says "last connected", never "offline since".
 */

const KEY = 'remotehost.devices'

/** What we can actually know locally. The server fills the rest at M3. */
export interface DeviceRecord {
  id: string
  name: string
  pairedAt: string
  lastConnectedAt: string | null
  lastTransport: Transport | null
}

const listeners = new Set<() => void>()
let cache: readonly Device[] | null = null

function parse(raw: string | null): DeviceRecord[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    // Hand-validated rather than trusted: this is user-writable storage, and a
    // half-written record must not take the device list down.
    return value.filter(
      (item): item is DeviceRecord =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as DeviceRecord).id === 'string' &&
        typeof (item as DeviceRecord).name === 'string',
    )
  } catch {
    return []
  }
}

function read(): DeviceRecord[] {
  try {
    return parse(localStorage.getItem(KEY))
  } catch {
    // Private mode, or storage disabled: the app still works, it just forgets.
    return []
  }
}

function write(records: DeviceRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records))
  } catch {
    /* ignore — see read() */
  }
  cache = null
  for (const listener of listeners) listener()
}

/** A stored record widened to the shape every screen renders. */
function toDevice(record: DeviceRecord): Device {
  return {
    id: record.id,
    name: record.name,
    presence: 'offline',
    transport: record.lastTransport ?? 'direct',
    pairedAt: record.pairedAt,
    lastConnectedAt: record.lastConnectedAt,
    displays: [],
  }
}

export function listDevices(): readonly Device[] {
  if (cache === null) cache = read().map(toDevice)
  return cache
}

export function getDevice(id: string): Device | null {
  return listDevices().find((device) => device.id === id) ?? null
}

/** Upserts after a successful pairing. Re-pairing keeps the original date. */
export function rememberDevice(id: string, name: string): void {
  const records = read()
  const existing = records.find((record) => record.id === id)
  if (existing) {
    existing.name = name || existing.name
    write(records)
    return
  }
  records.push({
    id,
    name: name || 'Computer',
    pairedAt: new Date().toISOString(),
    lastConnectedAt: null,
    lastTransport: null,
  })
  write(records)
}

export function renameDevice(id: string, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const records = read()
  const record = records.find((item) => item.id === id)
  if (!record) return
  record.name = trimmed
  write(records)
}

export function forgetDevice(id: string): void {
  write(read().filter((record) => record.id !== id))
}

/** Called once media is flowing, so the list can say when it last worked. */
export function markConnected(id: string, transport: Transport): void {
  const records = read()
  const record = records.find((item) => item.id === id)
  if (!record) return
  record.lastConnectedAt = new Date().toISOString()
  record.lastTransport = transport
  write(records)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-renders on every write, including writes from another tab. */
export function useDevices(): readonly Device[] {
  return useSyncExternalStore(subscribe, listDevices, listDevices)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return
    cache = null
    for (const listener of listeners) listener()
  })
}

/** Tests only — localStorage persists between cases otherwise. */
export function resetDevicesForTest(): void {
  write([])
}
