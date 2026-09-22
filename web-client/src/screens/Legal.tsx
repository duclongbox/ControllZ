import { Banner } from '../components/Banner'
import { Bullets, Code, DocPage, FootNote, P, Section } from './DocPage'

/* Privacy and security, written against what the app actually does today.
 *
 * Both pages are linked from the landing page's footer and from Settings, and
 * both are deliberately specific: "peer-to-peer" is a claim, and a claim needs
 * the exceptions printed next to it. Where something is designed but not yet
 * built, it says so rather than using the future tense and hoping.
 */

const PRERELEASE = 'This is pre-release software and has not been independently reviewed.'

export function Privacy() {
  return (
    <DocPage
      navTitle="Privacy"
      title="What this app knows about you"
      lede="No accounts, no analytics, no cookies, and no third-party scripts. What follows is the whole of it."
    >
      <Banner tone="info" icon="lock" title="Pre-release">
        {PRERELEASE}
      </Banner>

      <Section heading="Stored on this phone">
        <P>Four keys in this browser's local storage, and nothing else:</P>
        <Code>{`remotehost.deviceId     this phone's id, issued at registration
remotehost.credential   the secret that reconnects without a code
remotehost.devices      the computers you paired, and the names you gave them
remotehost.prefs        your settings on this screen`}</Code>
        <P>
          Clearing this site's data removes all four. The pairing is then gone from this phone and a
          fresh code is needed.
        </P>
      </Section>

      <Section heading="What the signalling server sees">
        <Bullets
          items={[
            'That a phone and a computer want to talk, and when.',
            'The connection handshake between them — SDP and ICE candidates, which include the local and public IP addresses of both devices.',
            'Pairing records: which phone may connect to which computer.',
          ]}
        />
        <P>
          It does not see the screen, the keystrokes or the touches. Those go directly between the
          two devices and are encrypted by WebRTC — there is no copy in the middle to keep.
        </P>
      </Section>

      <Section heading="What else the phone contacts">
        <P>
          A public STUN server (<code>stun.l.google.com</code>) is asked what this phone's public
          address looks like from outside. That request necessarily reveals this phone's IP address
          to that server. It carries nothing else, and no relay is used yet, so when no direct path
          can be found the session simply fails rather than routing through anyone.
        </P>
      </Section>

      <Section heading="What is not here">
        <Bullets
          items={[
            'No analytics, telemetry or crash reporting.',
            'No cookies. Local storage only, and only the four keys above.',
            'No advertising, and nothing shared with anyone.',
          ]}
        />
      </Section>

      <FootNote>Last reviewed with the pre-release build. Behaviour, not policy — it is what the code does.</FootNote>
    </DocPage>
  )
}

export function Security() {
  return (
    <DocPage
      navTitle="Security"
      title="How a session is protected"
      lede="One encrypted path between two devices, and a pairing that can be undone."
    >
      <Banner tone="warn" title="Pre-release">
        {PRERELEASE} Treat it as you would any early build: use it on machines you own.
      </Banner>

      <Section heading="The media path">
        <P>
          Video and input travel over WebRTC, which encrypts every packet — DTLS for the handshake,
          SRTP for the frames, and the same keys for the data channel that carries your touches. The
          signalling server brokers the handshake and never holds the keys.
        </P>
      </Section>

      <Section heading="Pairing">
        <Bullets
          items={[
            'The six-digit code is shown only on the computer, is good for one use, and expires five minutes after it appears.',
            'Repeated wrong codes are refused and then rate-limited, so a code cannot be guessed at speed.',
            'A successful pairing gives this phone a credential. Later sessions use that, so a code is never reused or re-shown.',
          ]}
        />
      </Section>

      <Section heading="What the credential is worth">
        <P>
          It is a bearer secret held in this browser's local storage. Anyone who can unlock this
          phone and open this page can start a session with a paired computer. Lock your phone; that
          is the lock on this too.
        </P>
      </Section>

      <Section heading="Undoing a pairing">
        <P>
          Removing a computer in the app deletes it from this phone, including its credential. The
          matching server-side revocation — so a phone is refused on its very next attempt even if
          its storage is intact — is designed and not yet built.
        </P>
      </Section>

      <Section heading="Reporting something">
        <P>
          If you find a weakness, please report it privately in the repository's security advisories
          rather than opening a public issue.
        </P>
      </Section>
    </DocPage>
  )
}
