import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Devices } from '../src/screens/Devices'
import { SessionProvider } from '../src/session/SessionProvider'

function renderAt(ui: React.ReactElement) {
  return render(
    <SessionProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </SessionProvider>,
  )
}

describe('Devices', () => {
  it('lists the paired computers with their presence', () => {
    renderAt(<Devices />)
    expect(screen.getByRole('heading', { name: 'Computers' })).toBeInTheDocument()
    expect(screen.getByText('Studio Mac')).toBeInTheDocument()
    expect(screen.getByText('Online · same network')).toBeInTheDocument()
    expect(screen.getByText('Online · via relay')).toBeInTheDocument()
    expect(screen.getByText(/^Offline ·/)).toBeInTheDocument()
  })

  it('offers pairing instead of an empty list when nothing is paired', () => {
    renderAt(<Devices devices={[]} />)
    expect(screen.getByText('No computers yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pair a computer' })).toBeInTheDocument()
  })
})
