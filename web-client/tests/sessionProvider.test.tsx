import { render, screen } from '@testing-library/react'
import { StrictMode, useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../src/session/SessionProvider'
import { useSession, useSessionClient } from '../src/session/useSession'

/* The provider owns the client's lifetime, and StrictMode deliberately mounts,
 * cleans up and mounts again. A client disposed by that cleanup keeps working
 * at the socket level but stops emitting state, so every screen freezes on its
 * first render while video arrives behind it — invisible in production, fatal
 * in development, which is where this gets tested by hand. */

function Probe() {
  const client = useSessionClient()
  const state = useSession()
  const [live, setLive] = useState(false)

  useEffect(() => {
    // Subscribing must deliver updates; a disposed client drops them.
    const stop = client.subscribe(() => setLive(true))
    return stop
  }, [client])

  return (
    <div>
      <span data-testid="phase">{state.phase}</span>
      <span data-testid="live">{live ? 'subscribed' : 'silent'}</span>
    </div>
  )
}

describe('SessionProvider', () => {
  it('hands the tree a live client after a StrictMode remount', () => {
    // No WebSocket in jsdom; the client is only constructed here, never opened.
    vi.stubGlobal(
      'WebSocket',
      class {
        static readonly OPEN = 1
        readyState = 0
        send() {}
        close() {}
      },
    )

    render(
      <StrictMode>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </StrictMode>,
    )

    expect(screen.getByTestId('phase')).toHaveTextContent('idle')
    expect(screen.getByTestId('live')).toHaveTextContent('subscribed')
  })
})
