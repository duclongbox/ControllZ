import { defineConfig, devices } from '@playwright/test'

// M1 e2e runs the viewer against a fake media source and a stub signaling
// server, so it needs no desktop-host and no real screen capture.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            // Lets getUserMedia/decoders work headless without a camera or
            // a cert prompt, and gives WebRTC a synthetic frame source.
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            // The two peers in the e2e run are pages in this same browser, so
            // they must meet over host candidates. Chromium otherwise hides
            // local IPs behind mDNS (.local) candidates, which do not resolve
            // here, and ICE fails with no route.
            '--disable-features=WebRtcHideLocalIpsWithMdns',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
