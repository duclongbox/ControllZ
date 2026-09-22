import { createBrowserRouter } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { RouteErrorScreen } from './app/ErrorBoundary'
import { DeviceDetail } from './screens/DeviceDetail'
import { Home } from './screens/Home'
import { NotFound } from './screens/NotFound'
import { PairCode } from './screens/PairCode'
import { PairScan } from './screens/PairScan'
import { PairSuccess } from './screens/PairSuccess'
import { Settings } from './screens/Settings'
import { Viewer } from './screens/Viewer'
import { Welcome } from './screens/Welcome'

/* Routes match docs/ui-spec.md §2. Session state lives in the session client,
 * not the URL, so `/session/:deviceId` is one route covering every viewer
 * state — reloading it reconnects rather than restoring a stale overlay. */

/* The prose pages and the marketing page are split out of the bundle: a phone
 * that already has a pairing opens the device list and the viewer, and should
 * not be made to download a page about installing the desktop app to get
 * there. */
const landing: RouteObject = {
  path: '/landing',
  lazy: async () => ({ Component: (await import('./screens/Landing')).Landing }),
}

const docs: RouteObject[] = [
  {
    path: '/install',
    lazy: async () => ({ Component: (await import('./screens/Install')).Install }),
  },
  {
    path: '/privacy',
    lazy: async () => ({ Component: (await import('./screens/Legal')).Privacy }),
  },
  {
    path: '/security',
    lazy: async () => ({ Component: (await import('./screens/Legal')).Security }),
  },
]

/* The gallery exists because several states have no server to produce them. It
 * is development-only, and `import.meta.env.DEV` is statically false in a
 * production build, so the whole branch — and the mock driver it drags in — is
 * dropped by the bundler rather than merely hidden. */
const devOnly: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev',
        lazy: async () => ({ Component: (await import('./screens/DevGallery')).DevGallery }),
      },
      {
        path: '/dev/:stateId',
        lazy: async () => ({ Component: (await import('./screens/DevGallery')).DevState }),
      },
    ]
  : []

/* Exported as data, not just as a router: the tests drive the same list
 * through a memory router, so what they exercise is the real route table
 * rather than a second copy of it that can drift. */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorScreen />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/welcome', element: <Welcome /> },
      { path: '/pair/scan', element: <PairScan /> },
      { path: '/pair/code', element: <PairCode /> },
      { path: '/pair/done', element: <PairSuccess /> },
      { path: '/device/:deviceId', element: <DeviceDetail /> },
      { path: '/session/:deviceId', element: <Viewer /> },
      { path: '/settings', element: <Settings /> },
      landing,
      ...docs,
      ...devOnly,
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
