import {
  forgetDevice,
  getDevice,
  listDevices,
  markConnected,
  rememberDevice,
  renameDevice,
  resetDevicesForTest,
} from '../src/store/devices'

/* The device list is the one piece of state a real pairing leaves behind. If
 * it does not survive, the pairing may as well not have happened: nothing else
 * on this phone remembers which desktop the stored credential is good for. */

describe('device store', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDevicesForTest()
  })

  it('remembers a pairing and finds it again', () => {
    rememberDevice('dev-1', 'Studio Mac')
    expect(listDevices()).toHaveLength(1)
    expect(getDevice('dev-1')?.name).toBe('Studio Mac')
    // Nothing has streamed yet, so the list must not claim it ever connected.
    expect(getDevice('dev-1')?.lastConnectedAt).toBeNull()
  })

  it('survives a reload', () => {
    rememberDevice('dev-1', 'Studio Mac')
    // Drop the in-memory cache the way a fresh page load would.
    resetDevicesForTest()
    localStorage.setItem(
      'remotehost.devices',
      JSON.stringify([
        { id: 'dev-1', name: 'Studio Mac', pairedAt: '2026-01-01T00:00:00Z', lastConnectedAt: null, lastTransport: null },
      ]),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: 'remotehost.devices' }))
    expect(getDevice('dev-1')?.name).toBe('Studio Mac')
  })

  it('re-pairing keeps the original pairing date and the chosen name', () => {
    rememberDevice('dev-1', 'Studio Mac')
    const pairedAt = getDevice('dev-1')?.pairedAt
    renameDevice('dev-1', 'Desk Mac')
    rememberDevice('dev-1', 'Studio Mac')
    expect(getDevice('dev-1')?.pairedAt).toBe(pairedAt)
    expect(getDevice('dev-1')?.name).toBe('Studio Mac')
  })

  it('ignores a rename to nothing', () => {
    rememberDevice('dev-1', 'Studio Mac')
    renameDevice('dev-1', '   ')
    expect(getDevice('dev-1')?.name).toBe('Studio Mac')
  })

  it('records the transport a session actually used', () => {
    rememberDevice('dev-1', 'Studio Mac')
    markConnected('dev-1', 'relayed')
    expect(getDevice('dev-1')?.lastConnectedAt).not.toBeNull()
    expect(getDevice('dev-1')?.transport).toBe('relayed')
  })

  it('forgets one device without touching the others', () => {
    rememberDevice('dev-1', 'Studio Mac')
    rememberDevice('dev-2', 'Work PC')
    forgetDevice('dev-1')
    expect(listDevices().map((d) => d.id)).toEqual(['dev-2'])
  })

  it('treats corrupt storage as an empty list rather than throwing', () => {
    localStorage.setItem('remotehost.devices', '{not json')
    resetDevicesForTest()
    localStorage.setItem('remotehost.devices', '{not json')
    window.dispatchEvent(new StorageEvent('storage', { key: 'remotehost.devices' }))
    expect(listDevices()).toEqual([])
  })

  it('drops records that are missing the fields every screen reads', () => {
    localStorage.setItem('remotehost.devices', JSON.stringify([{ id: 'dev-1' }, null, 'nope']))
    window.dispatchEvent(new StorageEvent('storage', { key: 'remotehost.devices' }))
    expect(listDevices()).toEqual([])
  })
})
