import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { Screen, Spacer } from '../components/Screen'
import styles from './pairing.module.css'

const POINTS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'shield',
    title: 'Video never touches our servers',
    body: 'Peer-to-peer, end-to-end encrypted by WebRTC.',
  },
  {
    icon: 'zap',
    title: 'Direct on the same Wi-Fi',
    body: 'ICE picks the local path automatically when there is one.',
  },
]

export function Welcome() {
  const navigate = useNavigate()

  return (
    <Screen
      footer={
        <>
          <Button label="Pair a computer" full onClick={() => navigate('/pair/code')} />
          <Button
            label="What is this?"
            variant="ghost"
            full
            onClick={() => navigate('/landing')}
          />
          <span className={styles.fine}>You will need the code shown in the desktop app.</span>
        </>
      }
    >
      <Spacer />
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Your desktop,
          <br />
          on this screen.
        </h1>
        <p className={styles.heroBody}>
          Pair once with a computer running the RemoteHost app. After that it reconnects on its own —
          no codes, no accounts.
        </p>
      </div>

      <div className={styles.points}>
        {POINTS.map((point) => (
          <div key={point.title} className={styles.point}>
            <span className={styles.pointIcon}>
              <Icon name={point.icon} size={18} />
            </span>
            <span className={styles.pointText}>
              <span className={styles.pointTitle}>{point.title}</span>
              <span className={styles.pointBody}>{point.body}</span>
            </span>
          </div>
        ))}
      </div>
      <Spacer />
    </Screen>
  )
}
