import { Navigate } from 'react-router-dom'
import { useIsDesktop } from '../lib/hooks'
import { useDevices } from '../store/devices'
import { Devices } from './Devices'

/**
 * What `/` is, which depends on who is asking.
 *
 * Once anything is paired this is the device list and nothing else. Before
 * that there is no app to show, so the visitor is sent to whichever first-run
 * page they can act on: a phone can pair, so it gets `Welcome`; a desktop
 * cannot — the desktop is the thing being paired *to* — so it gets the
 * marketing page, which is where the downloads are.
 *
 * Both are redirects rather than renders so the URL always says which one you
 * are on, and Back out of pairing lands somewhere real.
 */
export function Home() {
  const devices = useDevices()
  const desktop = useIsDesktop()

  if (devices.length > 0) return <Devices devices={devices} />
  return <Navigate to={desktop ? '/landing' : '/welcome'} replace />
}
