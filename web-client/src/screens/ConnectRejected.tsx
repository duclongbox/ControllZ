import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState, InlineWait } from '../components/Feedback'
import type { IconName } from '../components/Icon'
import { NavBar, Screen, Spacer } from '../components/Screen'
import type { RejectReason } from '../protocol/types'
import { rejectReasonBody, rejectReasonTitle } from '../protocol/types'

const PRESENTATION: Record<
  RejectReason,
  { icon: IconName; tone: 'error' | 'warn' | 'neutral'; watching: boolean }
> = {
  // `notPaired` covers unknown, never-paired and revoked alike. The UI must not
  // try to tell them apart — that distinction is deliberately not on the wire.
  notPaired: { icon: 'lock', tone: 'error', watching: false },
  desktopOffline: { icon: 'monitor', tone: 'neutral', watching: true },
  alreadyInSession: { icon: 'phone', tone: 'warn', watching: false },
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
  const { icon, tone, watching } = PRESENTATION[reason]

  return (
    <Screen
      compact
      footer={
        <>
          {reason === 'notPaired' ? (
            <Button label="Pair again" full onClick={() => navigate('/pair/scan')} />
          ) : null}
          <Button
            label="Back to computers"
            variant={reason === 'notPaired' ? 'ghost' : 'secondary'}
            full
            onClick={() => navigate('/')}
          />
          <span
            style={{
              fontSize: 'var(--type-size-2xs)',
              lineHeight: '16px',
              color: 'var(--color-text-disabled)',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
            }}
          >
            connectRejected · reason: {reason}
          </span>
        </>
      }
    >
      <NavBar title={deviceName} onBack={() => navigate('/')} />
      <Spacer />
      <EmptyState icon={icon} tone={tone} title={rejectReasonTitle(reason)}>
        {rejectReasonBody(reason)}
      </EmptyState>
      {watching ? <InlineWait>Watching for it to come online</InlineWait> : null}
      <Spacer />
    </Screen>
  )
}
