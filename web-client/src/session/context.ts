import { createContext } from 'react'
import type { SessionClient } from './client'

/** Split from SessionProvider so that file exports components only. */
export const SessionContext = createContext<SessionClient | null>(null)
