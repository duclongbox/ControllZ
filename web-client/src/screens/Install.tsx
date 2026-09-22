import { useNavigate } from 'react-router-dom'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Bullets, Code, DocPage, FootNote, P, Section, Steps } from './DocPage'
import styles from './doc.module.css'

/**
 * What to do on the computer, and how to get this page onto a home screen.
 *
 * There is nothing to download yet, and this page says so rather than
 * presenting a button that 404s. It is also where the iOS install path lives:
 * Safari never fires `beforeinstallprompt`, so the only honest answer there is
 * instructions.
 */
export function Install() {
  const navigate = useNavigate()

  return (
    <DocPage
      navTitle="Install"
      title="Getting the desktop app"
      lede="RemoteHost streams from an app that runs on the computer you want to reach. The phone side is this page — there is nothing to install here."
    >
      <Banner tone="info" icon="download" title="No packaged build yet">
        The desktop app is pre-release and is not signed or notarised, so there is no installer to
        download. For now it is built from source.
      </Banner>

      <Section heading="Build it on the computer">
        <P>
          macOS on Apple Silicon is the first supported platform. Windows is designed for and not
          yet built.
        </P>
        <Code>{`brew install cmake ninja pkg-config openssl@3
git clone <repo> && cd RemoteHost/desktop-host
cmake --preset debug && cmake --build --preset debug
./build/debug/desktop-host --help`}</Code>
        <FootNote>Full Xcode is required — the ScreenCaptureKit and VideoToolbox SDKs are not in the command line tools.</FootNote>
      </Section>

      <Section heading="Permissions macOS will ask for">
        <Bullets
          items={[
            <>
              <strong>Screen Recording</strong> — without it the capture is a black frame. Granting
              it requires quitting and reopening the app; macOS does not apply it live.
            </>,
            <>
              <strong>Accessibility</strong> — needed only for sending touches back. Video works
              without it; the cursor will not move.
            </>,
          ]}
        />
        <P>Windows needs neither.</P>
      </Section>

      <Section heading="Then pair, once">
        <Steps
          items={[
            {
              title: 'Open the desktop app',
              body: <>It shows a six-digit code. The code is single-use and lasts five minutes.</>,
            },
            {
              title: 'Type it here',
              body: <>Six digits on this phone. It submits itself on the last one.</>,
            },
            {
              title: 'Never again',
              body: (
                <>
                  The pairing is stored on both ends. Later sessions reconnect with no code and no
                  account.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section heading="Add this page to your home screen">
        <P>
          It then opens full screen, without browser chrome eating the top of the stream. Nothing is
          downloaded — it is the same page, launched like an app.
        </P>
        <Bullets
          items={[
            <>
              <strong>iPhone, Safari</strong> — Share, then “Add to Home Screen”. Safari has no
              install prompt; this is the only route.
            </>,
            <>
              <strong>Android, Chrome</strong> — the menu offers “Install app”, or accept the prompt
              when it appears.
            </>,
          ]}
        />
      </Section>

      <div className={styles.actions}>
        <Button label="Enter a pairing code" full onClick={() => navigate('/pair/code')} />
        <Button
          label="How it works"
          variant="secondary"
          full
          onClick={() => navigate('/landing')}
        />
      </div>
    </DocPage>
  )
}
