import type { Device } from '../session/types'

/* Fixtures standing in for the paired-device list.
 *
 * At M3 this comes from `authenticate` → the pairing records on the server,
 * with presence from the in-memory registry. Until then these are the shapes
 * the screens render. */

export const DEVICES: readonly Device[] = [
  {
    id: 'dev_studio_mac',
    name: 'Studio Mac',
    presence: 'online',
    transport: 'direct',
    pairedAt: '2026-08-04T09:12:00Z',
    lastConnectedAt: '2026-09-05T14:31:00Z',
    displays: [
      { id: 'disp_builtin', name: 'Built-in Retina', width: 3024, height: 1964 },
      { id: 'disp_ultrafine', name: 'LG UltraFine', width: 3840, height: 2160 },
    ],
  },
  {
    id: 'dev_work_pc',
    name: 'Work PC',
    presence: 'online',
    transport: 'relayed',
    pairedAt: '2026-07-22T17:40:00Z',
    lastConnectedAt: '2026-09-04T08:02:00Z',
    displays: [{ id: 'disp_dell', name: 'Dell U2720Q', width: 3840, height: 2160 }],
  },
  {
    id: 'dev_living_room',
    name: 'Living room mini',
    presence: 'offline',
    transport: 'direct',
    pairedAt: '2026-03-03T12:00:00Z',
    lastConnectedAt: '2026-09-05T12:44:00Z',
    displays: [{ id: 'disp_tv', name: 'Living room TV', width: 1920, height: 1080 }],
  },
]

export function findDevice(id: string): Device | null {
  return DEVICES.find((d) => d.id === id) ?? null
}
