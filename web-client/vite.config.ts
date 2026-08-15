import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Phone testing needs two things the defaults don't give us:
//  - server.host: bind on the LAN, not just localhost, so the phone can reach it.
//  - HTTPS: RTCPeerConnection (and later Wake Lock / PWA install) are restricted
//    to secure contexts. localhost counts as secure; http://192.168.x.x does not.
// HTTPS is opt-in via `HTTPS=1 npm run dev` because the self-signed cert means
// tapping through a warning on the phone. Swap for mkcert if that gets old.
const useHttps = process.env.HTTPS === '1'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // e2e/ is Playwright's; Vitest must not try to run those specs.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
