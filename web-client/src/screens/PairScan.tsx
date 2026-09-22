import { useNavigate } from 'react-router-dom'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { NavBar } from '../components/Screen'
import styles from './pairing.module.css'

/**
 * QR viewfinder.
 *
 * The camera feed is not faked — at M1 a real `getUserMedia` stream fills this
 * region. What is designed here is everything around it: the reticle, the
 * permission explanation, and the always-available typed fallback.
 */
export function PairScan() {
  const navigate = useNavigate()

  return (
    <div className={styles.scanner}>
      <div className={styles.viewfinder}>
        <div className={styles.reticle}>
          <span className={`${styles.corner} ${styles.tl}`} />
          <span className={`${styles.corner} ${styles.tr}`} />
          <span className={`${styles.corner} ${styles.bl}`} />
          <span className={`${styles.corner} ${styles.br}`} />
          <span className={styles.sweep} />
        </div>
      </div>

      <div className={styles.scanNav}>
        <NavBar title="Scan a code" onBack={() => navigate('/pair/code')} />
      </div>

      <p className={styles.scanHint}>Point the camera at the code on your desktop screen.</p>

      <div className={styles.scanFooter}>
        <Banner tone="warn" title="Scanning is not wired up yet">
          The desktop app does not draw a QR code yet, so there is nothing to point this at. Type
          the six digits instead — it is the same pairing.
        </Banner>
        <Button label="Enter the code instead" full onClick={() => navigate('/pair/code')} />
      </div>
    </div>
  )
}
