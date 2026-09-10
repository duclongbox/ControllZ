import { useContext, useEffect, useState } from 'react'
import type { SessionClient } from './client'
import { SessionContext } from './context'
import type { SessionState } from './types'

export function useSessionClient(): SessionClient {
  const client = useContext(SessionContext)
  if (!client) throw new Error('useSessionClient must be used inside a SessionProvider')
  return client
}

/** Subscribe to session state. Re-renders on every driver update. */
export function useSession(): SessionState {
  const client = useSessionClient()
  const [state, setState] = useState<SessionState>(() => client.getState())

  useEffect(() => client.subscribe(setState), [client])

  return state
}
