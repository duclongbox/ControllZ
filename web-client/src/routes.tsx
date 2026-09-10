import { Navigate, createBrowserRouter } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { ConnectRejected } from './screens/ConnectRejected'
import { DevGallery, DevState } from './screens/DevGallery'
import { DeviceDetail } from './screens/DeviceDetail'
import { Devices } from './screens/Devices'
import { JoinRoom } from './screens/JoinRoom'
import { Landing } from './screens/Landing'
import { PairCode } from './screens/PairCode'
import { PairScan } from './screens/PairScan'
import { PairSuccess } from './screens/PairSuccess'
import { Settings } from './screens/Settings'
import { Viewer } from './screens/Viewer'
import { Welcome } from './screens/Welcome'

/* Routes match docs/ui-spec.md §2. Session state lives in the session client,
 * not the URL, so `/session/:deviceId` is one route covering every viewer
 * state — reloading it reconnects rather than restoring a stale overlay. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Devices /> },
      { path: '/welcome', element: <Welcome /> },
      { path: '/pair/scan', element: <PairScan /> },
      { path: '/pair/code', element: <PairCode /> },
      { path: '/pair/done', element: <PairSuccess /> },
      { path: '/device/:deviceId', element: <DeviceDetail /> },
      { path: '/session/:deviceId', element: <Viewer /> },
      { path: '/join', element: <JoinRoom /> },
      { path: '/settings', element: <Settings /> },
      { path: '/landing', element: <Landing /> },
      { path: '/not-paired', element: <ConnectRejected reason="notPaired" /> },
      { path: '/dev', element: <DevGallery /> },
      { path: '/dev/:stateId', element: <DevState /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
