import { RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from './app/ErrorBoundary'
import { router } from './routes'
import { SessionProvider } from './session/SessionProvider'

export default function App() {
  return (
    // Outside the router: the router's own errorElement covers a throw inside
    // a route, and this covers everything above one — the session client being
    // constructed, and the router itself.
    <ErrorBoundary>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ErrorBoundary>
  )
}
