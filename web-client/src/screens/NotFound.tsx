import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import { Screen, Spacer } from '../components/Screen'

/**
 * A real 404 rather than a silent redirect home.
 *
 * The old `*` route sent every unknown path to `/`, which hid typos and made a
 * stale bookmark look like it had worked.
 */
export function NotFound() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <Screen
      footer={
        <>
          <Button label="Go to my computers" full onClick={() => navigate('/', { replace: true })} />
          <Button label="Install the desktop app" variant="ghost" full onClick={() => navigate('/install')} />
        </>
      }
    >
      <Spacer />
      <EmptyState icon="alert" tone="warn" title="No such page" code={pathname}>
        That address does not match anything in this app. It may have been a link from an older
        version.
      </EmptyState>
      <Spacer />
    </Screen>
  )
}
