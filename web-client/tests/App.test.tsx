import { render, screen } from '@testing-library/react'
import App from '../src/App'

describe('App', () => {
  it('renders the package version', () => {
    render(<App />)
    expect(screen.getByText(/web-client/)).toBeInTheDocument()
  })
})
