import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { SessionProvider } from './session/SessionProvider'

export default function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
