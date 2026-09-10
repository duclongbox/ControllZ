import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Button } from '../src/components/Button'
import { CodeInput } from '../src/components/CodeInput'
import { DeviceRow } from '../src/components/DeviceRow'
import { StatusPill } from '../src/components/StatusPill'
import { Toggle } from '../src/components/Toggle'

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button label="Start session" onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is inert while loading', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button label="Pair" loading onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'Pair' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('StatusPill', () => {
  it('announces the connection state', () => {
    render(<StatusPill status="relayed" label="Relayed" />)
    expect(screen.getByRole('status')).toHaveTextContent('Relayed')
  })
})

describe('Toggle', () => {
  it('exposes switch semantics and reports the next value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle on={false} onChange={onChange} label="Keep the screen awake" />)
    const toggle = screen.getByRole('switch', { name: 'Keep the screen awake' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('DeviceRow', () => {
  it('navigates even when the device is offline', async () => {
    // The next screen explains why it cannot connect; a dead row would not.
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <MemoryRouter>
        <DeviceRow name="Living room mini" meta="Offline" presence="offline" onClick={onClick} />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /Living room mini/ }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

function CodeHarness({ onComplete }: { onComplete: (code: string) => void }) {
  const [value, setValue] = useState('')
  return <CodeInput value={value} onChange={setValue} onComplete={onComplete} />
}

describe('CodeInput', () => {
  it('submits automatically on the sixth digit', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<CodeHarness onComplete={onComplete} />)

    const input = screen.getByLabelText('Pairing code')
    await user.type(input, '41890')
    expect(onComplete).not.toHaveBeenCalled()

    await user.type(input, '2')
    expect(onComplete).toHaveBeenCalledWith('418902')
  })

  it('ignores non-digits and never exceeds six characters', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<CodeHarness onComplete={onComplete} />)

    const input = screen.getByLabelText('Pairing code')
    await user.type(input, 'a4b1c8')
    expect(input).toHaveValue('418')

    await user.type(input, '902999')
    expect(input).toHaveValue('418902')
    expect(onComplete).toHaveBeenCalledWith('418902')
  })
})
