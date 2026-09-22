import { getPrefs, resetPrefsForTest, setPref } from '../src/store/prefs'

describe('prefs store', () => {
  beforeEach(() => {
    localStorage.clear()
    resetPrefsForTest()
  })

  it('starts from the defaults', () => {
    expect(getPrefs().wakeLock).toBe(true)
    expect(getPrefs().hideChromeAfterMs).toBe(3000)
  })

  it('writes a change through to storage', () => {
    setPref('haptics', false)
    expect(JSON.parse(localStorage.getItem('remotehost.prefs') ?? '{}').haptics).toBe(false)
    expect(getPrefs().haptics).toBe(false)
  })

  it('falls back per field when storage holds nonsense', () => {
    localStorage.setItem(
      'remotehost.prefs',
      JSON.stringify({ wakeLock: 'yes', hideChromeAfterMs: 999999, haptics: false }),
    )
    // What another tab writing the same key looks like from here.
    window.dispatchEvent(new StorageEvent('storage', { key: 'remotehost.prefs' }))
    const prefs = getPrefs()
    expect(prefs.wakeLock).toBe(true) // bad type → default
    expect(prefs.hideChromeAfterMs).toBe(3000) // not one of the offered delays → default
    expect(prefs.haptics).toBe(false) // valid → kept
  })
})
