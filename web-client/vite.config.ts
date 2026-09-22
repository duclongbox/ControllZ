import { createRequire } from 'node:module'
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

// `TUNNEL=1 npm run dev` serves the same dev server through a public tunnel,
// which is how the phone is tested from a different network (cellular) while
// the desktop host and signalling server stay on localhost. The tunnel
// terminates TLS on 443, so the HMR socket has to be told that — left to
// itself the client would dial wss://<tunnel-host>:5173, which is not open.
const tunnel = process.env.TUNNEL === '1'

// The Settings screen shows a version. Reading it from package.json keeps that
// one string from drifting into fiction the way a hand-typed one does.
const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

// Shared by `vite` and `vite preview`. Vite refuses a Host header it does not
// recognise; a leading dot matches subdomains, which is what the free tunnels
// hand out per run.
const allowedHosts = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io']

// The phone loads this page over https, and a secure page may not open a plain
// ws:// socket. Proxying keeps signalling on the page's own origin, so it is
// covered by the same certificate and the server itself can stay bound to
// localhost.
const proxy = {
  '/ws': { target: 'ws://localhost:8080', ws: true },
}

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts,
    ...(tunnel ? { hmr: { protocol: 'wss' as const, clientPort: 443 } } : {}),
    proxy,
  },
  // `npm run build && npm run preview` serves the bundled app instead of the
  // dev server's module-per-request firehose. That matters through a tunnel:
  // one dev-mode page load costs hundreds of requests, and ngrok's free tier
  // allows 20k a month, so a long phone session is far cheaper against a
  // build. It needs its own proxy — `server.proxy` does not apply to preview,
  // so without this signalling would 404 here.
  preview: {
    host: true,
    port: 4173,
    allowedHosts,
    proxy,
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
