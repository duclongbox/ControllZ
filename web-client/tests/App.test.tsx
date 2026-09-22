import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { Devices } from '../src/screens/Devices'
import { routes } from '../src/routes'
import { createMockClient } from '../src/session/mockClient'
import { SessionProvider } from '../src/session/SessionProvider'
import { DEVICES } from '../src/mock/devices'
import { listDevices, rememberDevice, resetDevicesForTest } from '../src/store/devices'
import { resetPrefsForTest } from '../src/store/prefs'

/** The real route table, driven from memory so a test can start anywhere. */
function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <SessionProvider client={createMockClient({ frozen: true })}>
      <RouterProvider router={router} />
    </SessionProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetDevicesForTest()
  resetPrefsForTest()
})

describe('Devices', () => {
  it('lists the paired computers with their presence', () => {
    render(
      <SessionProvider client={createMockClient({ frozen: true })}>
        {/* Fixtures, not this phone's storage — the gallery renders it this way too. */}
        <MemoryDevices />
      </SessionProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Computers' })).toBeInTheDocument()
    expect(screen.getByText('Studio Mac')).toBeInTheDocument()
    expect(screen.getByText('Online · same network')).toBeInTheDocument()
    expect(screen.getByText('Online · via relay')).toBeInTheDocument()
  })

  it('lists what the store holds, and says when each last worked', () => {
    rememberDevice('dev-1', 'Studio Mac')
    renderApp('/')
    expect(screen.getByText('Studio Mac')).toBeInTheDocument()
    expect(screen.getByText('Paired · not connected yet')).toBeInTheDocument()
  })

  it('offers pairing instead of an empty list when nothing is paired', () => {
    render(
      <SessionProvider client={createMockClient({ frozen: true })}>
        <MemoryDevices empty />
      </SessionProvider>,
    )
    expect(screen.getByText('No computers yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pair a computer' })).toBeInTheDocument()
  })
})

describe('routing', () => {
  it('sends a phone with no pairings to the first-run screen', async () => {
    renderApp('/')
    // `/` is not a screen of its own: with nothing paired there is no list to
    // show, so it resolves to onboarding.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pair a computer' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/Pair once with a computer/)).toBeInTheDocument()
  })

  it('answers an unknown path with a 404 rather than a silent redirect', () => {
    renderApp('/nope')
    expect(screen.getByText('No such page')).toBeInTheDocument()
    expect(screen.getByText('/nope')).toBeInTheDocument()
  })

  it('reaches the landing page from onboarding', async () => {
    const user = userEvent.setup()
    renderApp('/welcome')
    await user.click(screen.getByRole('button', { name: 'What is this?' }))
    await waitFor(() => expect(screen.getByText(/Three steps, then never again/)).toBeInTheDocument())
  })

  it('opens the install guide from the empty device list', async () => {
    const user = userEvent.setup()
    renderApp('/welcome')
    await user.click(screen.getByRole('button', { name: 'Pair a computer' }))
    await waitFor(() => expect(screen.getByText('Enter the code')).toBeInTheDocument())
  })
})

describe('removing a pairing', () => {
  it('asks first, and only forgets the device on confirmation', async () => {
    const user = userEvent.setup()
    rememberDevice('dev-1', 'Studio Mac')
    renderApp('/device/dev-1')

    await user.click(screen.getByRole('button', { name: /Remove this pairing/ }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    // Backing out leaves it alone — this is the one action with no undo.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(listDevices()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /Remove this pairing/ }))
    await user.click(screen.getByRole('button', { name: 'Remove pairing' }))
    await waitFor(() => expect(listDevices()).toHaveLength(0))
  })
})

describe('pairing hand-off', () => {
  it('remembers the computer it just paired with', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [
        { pathname: '/pair/done', state: { deviceId: 'dev-9', displayName: 'Studio Mac' } },
      ],
    })
    render(
      <SessionProvider client={createMockClient({ frozen: true })}>
        <RouterProvider router={router} />
      </SessionProvider>,
    )
    expect(await screen.findByText('Paired')).toBeInTheDocument()

    // The record exists before the user presses anything: closing the tab here
    // must not lose a pairing the server already made.
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Computer name'))
    await user.type(screen.getByLabelText('Computer name'), 'Desk Mac')
    await user.click(screen.getByRole('button', { name: 'Later' }))
    await waitFor(() => expect(screen.getByText('Desk Mac')).toBeInTheDocument())
  })
})

/* Devices takes its list as a prop so the gallery and these tests can render a
 * fixed one; without the prop it reads this phone's storage. */
function MemoryDevices({ empty = false }: { empty?: boolean }) {
  const router = createMemoryRouter(
    [{ path: '/', element: <Devices devices={empty ? [] : DEVICES} /> }],
    { initialEntries: ['/'] },
  )
  return <RouterProvider router={router} />
}
