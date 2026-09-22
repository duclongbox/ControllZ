import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { StatChip } from '../components/StatChip'
import { DesktopFrame } from '../mock/DesktopFrame'
import { cn } from '../lib/cn'
import styles from './Landing.module.css'

const STEPS = [
  [
    '1',
    'Install on your computer',
    'A normal app you launch — not a service, not a background daemon. It runs while you are there, and quits when you close it.',
  ],
  [
    '2',
    'Pair once with a code',
    'The desktop shows six digits. Type them on your phone. That is the last time you will ever need one.',
  ],
  [
    '3',
    'Open it on your phone',
    'Your computers are listed, with whichever ones are awake marked live. Tap one and the screen is there — no code, no account.',
  ],
] as const

const CLAIMS: Array<[IconName, string, string]> = [
  [
    'zap',
    '1080p at 60 fps',
    'Captured on the GPU and encoded by dedicated silicon — VideoToolbox on Mac, Media Foundation on Windows. Frames never make a round trip through main memory.',
  ],
  [
    'shield',
    'Peer-to-peer, always',
    'Video and touches go straight between your two devices, encrypted by WebRTC. Our server brokers the handshake and then has nothing to look at.',
  ],
  [
    'globe',
    'Same Wi-Fi or the other side of the world',
    'One connection path, not two. ICE picks the local route whenever there is one, with nothing for you to switch. Relay fallback, for networks that allow no direct route at all, is designed and not yet built.',
  ],
  [
    'pointer',
    'Touch that lands where you meant',
    'Coordinates travel as fractions of the frame, so changing your desktop resolution mid-session does not move the cursor by a pixel.',
  ],
]

function HeroDevice() {
  return (
    <div className={styles.device}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <DesktopFrame />
      </div>
      <div className={styles.deviceChromeTop}>
        <span className={styles.deviceDot} />
        <span className={styles.deviceName}>Studio Mac</span>
        <span className={styles.devicePill}>
          <span className={styles.devicePillDot} />
          Live
        </span>
        <span className={styles.deviceRtt}>38 ms</span>
      </div>
      <div className={styles.deviceChromeBottom}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={styles.deviceDot} />
        ))}
        <span className={styles.grow} />
        <span className={cn(styles.deviceDot, styles.deviceDanger)} />
      </div>
    </div>
  )
}

export function Landing() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <nav className={styles.nav}>
          <span className={styles.brand}>
            <span className={styles.mark}>
              <Icon name="monitor" size={16} />
            </span>
            <span className={styles.wordmark}>RemoteHost</span>
          </span>
          <span className={styles.navLinks}>
            {/* Real anchors, not styled spans: they have to work with a
              * middle-click, and the sections they point at carry the ids. */}
            <a className={styles.navLink} href="#how-it-works">
              How it works
            </a>
            <a className={styles.navLink} href="#security">
              Security
            </a>
            <a className={styles.navLink} href="#requirements">
              Requirements
            </a>
            <Link to="/">
              <Button label="Open the app" variant="secondary" />
            </Link>
          </span>
        </nav>

        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.badge}>
              <span className={styles.badgeDot} />
              Pre-release · macOS first, Windows designed
            </span>
            <h1 className={styles.h1}>
              Your desktop,
              <br />
              on the glass
              <br />
              in your hand.
            </h1>
            <p className={styles.lede}>
              Full control of your Mac or PC from a phone browser. The screen streams straight from
              your computer to your phone — peer-to-peer, hardware-encoded, and smooth enough to
              actually work in.
            </p>
            {/* There is no packaged build to download yet, so these go to the
              * page that says so and gives the build steps, rather than to a
              * file that does not exist. */}
            <div className={styles.ctaRow}>
              <Link to="/install">
                <Button label="Get it for macOS" icon="download" />
              </Link>
              <Link to="/install">
                <Button label="Get it for Windows" variant="secondary" />
              </Link>
            </div>
            <span className={styles.fine}>
              Nothing to install on the phone — it runs in the browser and can be added to your home
              screen.
            </span>
          </div>
          <div className={styles.heroDevice}>
            <HeroDevice />
          </div>
        </header>

        <div className={styles.strip}>
          <StatChip caption="RESOLUTION" value="1080p60" />
          <StatChip caption="LATENCY TARGET" value="≤150 ms" tone="good" />
          <StatChip caption="CODEC" value="H.264 HW" />
          <StatChip caption="SERVER SEES" value="0 bytes" tone="good" />
          <span className={styles.stripNote}>
            Design targets, not benchmarks — the first three are what the pipeline is built to hit,
            and the app shows you its own numbers live while a session runs. The last one is
            structural: there is no path through our servers for a frame to take.
          </span>
        </div>

        <section className={styles.section} id="how-it-works">
          <div>
            <span className={styles.eyebrow}>How it works</span>
            <h2 className={styles.h2}>Three steps, then never again.</h2>
          </div>
          <div className={styles.steps}>
            {STEPS.map(([n, title, body]) => (
              <div key={n} className={styles.step}>
                <span className={styles.stepNum}>{n}</span>
                <span className={styles.stepTitle}>{title}</span>
                <span className={styles.stepBody}>{body}</span>
              </div>
            ))}
          </div>
          <div className={styles.claims}>
            {CLAIMS.map(([icon, title, body]) => (
              <div key={title} className={styles.claim}>
                <span className={styles.claimIcon}>
                  <Icon name={icon} size={20} />
                </span>
                <span className={styles.claimTitle}>{title}</span>
                <span className={styles.claimBody}>{body}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={cn(styles.section, styles.tinted)} id="security">
          <div className={styles.split}>
            <div className={styles.splitCol}>
              <span className={styles.eyebrow}>Security</span>
              <h2 className={styles.h2}>Your screen never touches our servers.</h2>
              <p className={styles.lede}>
                We broker the introduction and then step out of the way. Once your phone and your
                computer have found each other, every frame and every touch goes directly between
                them, encrypted end to end. There is no point in the middle where a recording could
                be made, because there is no point in the middle.
              </p>
              <div className={styles.checks}>
                {[
                  'Pairing codes are single-use and expire in five minutes',
                  'Reconnection uses a per-device credential, stored hashed on our side',
                  'Revoke a phone and it is refused on its very next attempt',
                ].map((line) => (
                  <span key={line} className={styles.check}>
                    <Icon name="check" size={17} strokeWidth={2.2} className={styles.checkIcon} />
                    {line}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.splitCol}>
              <div className={styles.diagram}>
                <span className={styles.node}>
                  <span className={styles.nodeIcon}>
                    <Icon name="phone" size={24} />
                  </span>
                  <span className={styles.nodeLabel}>Your phone</span>
                </span>
                <span className={styles.wire}>
                  <span className={styles.wireLabel}>video + input</span>
                  <span className={styles.wireLine} />
                  <span className={styles.wireNote}>encrypted, direct</span>
                </span>
                <span className={styles.node}>
                  <span className={styles.nodeIcon}>
                    <Icon name="monitor" size={24} />
                  </span>
                  <span className={styles.nodeLabel}>Your computer</span>
                </span>
              </div>
              <div className={styles.serverCard}>
                <span className={styles.claimIcon}>
                  <Icon name="server" size={20} />
                </span>
                <span className={styles.stack}>
                  <span className={styles.nodeLabel}>Our signalling server</span>
                  <span className={styles.claimBody}>
                    Sees who wants to talk to whom. Never the screen, never a keystroke.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} id="requirements">
          <div className={styles.split}>
            <div className={styles.splitCol}>
              <span className={styles.eyebrow}>Requirements</span>
              <div className={styles.reqGrid}>
                <div>
                  <div className={styles.reqTitle}>On your computer</div>
                  <div className={styles.reqItem}>macOS 13 or later</div>
                  <div className={styles.reqItem}>Windows 10 version 1903 or later</div>
                  <div className={styles.reqItem}>A GPU from the last decade</div>
                </div>
                <div>
                  <div className={styles.reqTitle}>On your phone</div>
                  <div className={styles.reqItem}>iOS 16 Safari or later</div>
                  <div className={styles.reqItem}>Android Chrome 110 or later</div>
                  <div className={styles.reqItem}>No app store, no install</div>
                </div>
              </div>
            </div>
            <div className={styles.getStarted}>
              <span className={styles.claimTitle}>Get started</span>
              <span className={styles.claimBody}>
                Install on the computer you want to reach. The phone side is just a link.
              </span>
              <Link to="/install">
                <Button label="Get it for macOS" icon="download" full />
              </Link>
              <Link to="/pair/code">
                <Button label="I already have the code" variant="secondary" full />
              </Link>
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          <span className={styles.footerText}>RemoteHost</span>
          <span className={styles.footerLinks}>
            <Link className={styles.footerLink} to="/privacy">
              Privacy
            </Link>
            <Link className={styles.footerLink} to="/security">
              Security
            </Link>
            <Link className={styles.footerLink} to="/install">
              Install
            </Link>
          </span>
        </footer>
      </div>
    </div>
  )
}
