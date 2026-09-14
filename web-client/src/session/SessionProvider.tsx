import { useEffect, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SessionClient } from './client'
import { createWsClient } from './wsClient'
import { SessionContext } from './context'

/* The one place the app decides which SessionClient it is running.
 *
 * The real client talks to the signalling server over `/ws` on this same
 * origin (the Vite dev server proxies it), so no URL is configured here. The
 * dev gallery still injects `createMockClient()` directly, which is why that
 * driver stays. */
function createDefaultClient(): SessionClient {
  return createWsClient()
}

export function SessionProvider({
  children,
  client,
}: {
  children: ReactNode
  /** Injected by the dev gallery to render a specific moment. */
  client?: SessionClient
}) {
  const owned = useRef<SessionClient | null>(null)
  const [, rebuild] = useReducer((n: number) => n + 1, 0)

  // Lazily on every render, so the tree is never handed a disposed client.
  if (!client && owned.current === null) owned.current = createDefaultClient()

  useEffect(() => {
    if (client) return // an injected client belongs to its owner

    // StrictMode runs this effect, its cleanup, then the effect again. The
    // cleanup disposes the client, and a disposed client goes quiet — it still
    // answers and still receives video, but it emits no state, so the viewer
    // sits on "Connecting" forever while frames pile up behind it. Build a
    // fresh one and re-render so the tree actually gets it.
    if (owned.current === null) {
      owned.current = createDefaultClient()
      rebuild()
    }
    return () => {
      owned.current?.dispose()
      owned.current = null
    }
  }, [client])

  return (
    <SessionContext.Provider value={client ?? owned.current!}>{children}</SessionContext.Provider>
  )
}
