import { cn } from '../lib/cn'
import styles from './DesktopFrame.module.css'

/* The captured screen, faked in CSS.
 *
 * At M1 this is replaced by a real <video> carrying the remote track. It exists
 * so the viewer can be designed, measured and clicked through before the
 * desktop host can send a frame. */

const SIDEBAR = [70, 92, 56, 84, 64, 78]
const CODE: Array<[number, string | undefined]> = [
  [46, 'blue'],
  [71, undefined],
  [37, 'green'],
  [88, undefined],
  [54, undefined],
  [31, 'amber'],
  [79, undefined],
  [63, undefined],
  [42, 'purple'],
  [71, undefined],
  [50, undefined],
  [83, undefined],
]
const TERMINAL = [54, 37, 62, 29, 46]

export function DesktopFrame() {
  return (
    <div className={styles.frame} aria-hidden="true">
      <div className={styles.menubar}>
        {[2.8, 1.8, 2.1, 2.4].map((w, i) => (
          <span key={i} className={styles.menuItem} style={{ width: `${w}%` }} />
        ))}
        <span className={styles.grow} />
        <span className={styles.menuItem} style={{ width: '3.2%' }} />
      </div>

      <div className={cn(styles.window, styles.editor)}>
        <div className={styles.titlebar}>
          {['#f5484a', '#f5a524', '#2fcc8b'].map((c) => (
            <span key={c} className={styles.dot} style={{ background: c }} />
          ))}
        </div>
        <div className={styles.panes}>
          <div className={styles.sidebar}>
            {SIDEBAR.map((w, i) => (
              <span key={i} className={styles.line} style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className={styles.code}>
            {CODE.map(([w, tone], i) => (
              <span
                key={i}
                className={cn(styles.line, tone && styles[tone as keyof typeof styles])}
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className={cn(styles.window, styles.terminal)}>
        <div className={styles.titlebar} />
        <div className={styles.body}>
          {TERMINAL.map((w, i) => (
            <span key={i} className={styles.line} style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
