import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/Feedback'
import { Screen, Spacer } from '../components/Screen'

/**
 * The last line before a white screen.
 *
 * A render that throws anywhere under here — most plausibly the viewer, which
 * touches `RTCPeerConnection`, `getStats()` and a `MediaStream` whose shape
 * varies by browser — otherwise unmounts the whole tree and leaves nothing,
 * not even a way back to the device list.
 */
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry by design (see /privacy) — the console is the whole report.
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <Screen
        footer={
          <>
            <Button
              label="Back to my computers"
              full
              onClick={() => {
                // A full load, not a route change: the tree that threw is not
                // trustworthy enough to keep rendering around.
                window.location.assign('/')
              }}
            />
            <Button
              label="Reload"
              variant="ghost"
              full
              onClick={() => window.location.reload()}
            />
          </>
        }
      >
        <Spacer />
        <EmptyState icon="alert" tone="error" title="Something broke" code={error.message}>
          The app hit an error it could not recover from. Nothing was sent anywhere — this is a bug
          on this phone, not on your computer.
        </EmptyState>
        <Spacer />
      </Screen>
    )
  }
}

/**
 * The same screen, for errors the router catches first.
 *
 * `RouterProvider` intercepts a throw inside a route before any React error
 * boundary above it sees one, and renders its own developer-facing page unless
 * a route supplies this.
 */
export function RouteErrorScreen() {
  const error = useRouteError()
  const message =
    error instanceof Error
      ? error.message
      : isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : 'Unknown error'

  return (
    <Screen
      footer={
        <>
          <Button label="Back to my computers" full onClick={() => window.location.assign('/')} />
          <Button label="Reload" variant="ghost" full onClick={() => window.location.reload()} />
        </>
      }
    >
      <Spacer />
      <EmptyState icon="alert" tone="error" title="Something broke" code={message}>
        The app hit an error it could not recover from. Nothing was sent anywhere — this is a bug on
        this phone, not on your computer.
      </EmptyState>
      <Spacer />
    </Screen>
  )
}
