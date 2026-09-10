import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { SessionClient } from './client'
import { createMockClient } from './mockClient'
import { SessionContext } from './context'

/* The one place the app decides which SessionClient it is running.
 *
 * M1 changes exactly this line — `createMockClient()` becomes
 * `createWsClient({ url })` — and nothing else in the app moves. */
function createDefaultClient(): SessionClient {
  return createMockClient()
}

export function SessionProvider({
  children,
  client,
}: {
  children: ReactNode
  /** Injected by the dev gallery to render a specific moment. */
  client?: SessionClient
}) {
  const fallback = useMemo(() => (client ? null : createDefaultClient()), [client])
  const active = client ?? fallback!

  useEffect(() => {
    // Only dispose a client we own; an injected one belongs to its owner.
    return () => fallback?.dispose()
  }, [fallback])

  return <SessionContext.Provider value={active}>{children}</SessionContext.Provider>
}
