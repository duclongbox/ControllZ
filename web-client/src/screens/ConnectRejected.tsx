import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import type { IconName } from '../components/Icon'
import { NavBar, Screen, Spacer } from '../components/Screen'
import type { RejectReason } from '../protocol/types'
import { rejectReasonBody, rejectReasonTitle } from '../protocol/types'

const PRESENTATION: Record<
  RejectReason,
  { icon: IconName; tone: 'error' | 'warn' | 'neutral'; retryable: boolean }
> = {
  // `notPaired` covers unknown, never-paired and revoked alike. The UI must not
  // try to tell them apart — that distinction is deliberately not on the wire.
  notPaired: { icon: 'lock', tone: 'error', retryable: false },
  // Both of these clear on their own — the desktop wakes up, or the other
  // phone hangs up — so the useful action is to ask again. Asking is manual:
  // nothing pushes presence to this phone yet, so a screen claiming to watch
  // for it would be watching nothing.
  desktopOffline: { icon: 'monitor', tone: 'neutral', retryable: true },
  alreadyInSession: { icon: 'phone', tone: 'warn', retryable: true },
}

/**
 * The three ways `connectRequest` can be refused, in one screen.
 *
 * Each says what happened, offers the one action that helps, and quietly prints
 * the wire reason for anyone who wants it.
 */
export function ConnectRejected({
  reason,
  deviceName = 'That computer',
}: {
  reason: RejectReason
  deviceName?: string
}) {
  const navigate = useNavigate()
  const { icon, tone, retryable } = PRESENTATION[reason]

  return (
    <Screen
      compact
      footer={
        <>
          {reason === 'notPaired' ? (
            <Button label="Pair again" full onClick={() => navigate('/pair/code')} />
          ) : null}
          {retryable ? (
            // navigate(0) reloads this route, which remounts the viewer and so
            // starts a fresh connectRequest.
            <Button label="Try again" icon="refresh" full onClick={() => navigate(0)} />
          ) : null}
          <Button
            label="Back to computers"
            variant={reason === 'notPaired' || retryable ? 'ghost' : 'secondary'}
            full
            onClick={() => navigate('/')}
          />
        </>
      }
    >
      <NavBar title={deviceName} onBack={() => navigate('/')} />
      <Spacer />
      {/* The wire reason rides on EmptyState's own `code` slot rather than a
        * hand-styled span in the footer — same information, one less place
        * that has to know what small-and-quiet looks like. */}
      <EmptyState
        icon={icon}
        tone={tone}
        title={rejectReasonTitle(reason)}
        code={`connectRejected · ${reason}`}
      >
        {rejectReasonBody(reason)}
      </EmptyState>
      <Spacer />
    </Screen>
  )
}
