import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { NavBar } from '../components/Screen'
import styles from './doc.module.css'

/**
 * The frame every prose page shares.
 *
 * These are ordinary routed screens rather than overlays: they are
 * destinations you can link someone to, and Back has to work from them.
 */
export function DocPage({
  title,
  lede,
  navTitle,
  children,
}: {
  title: string
  lede?: ReactNode
  navTitle: string
  children: ReactNode
}) {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <NavBar title={navTitle} onBack={() => navigate(-1)} />
        <h1 className={styles.title}>{title}</h1>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
        {children}
      </div>
    </div>
  )
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <h2 className={styles.h2}>{heading}</h2>
      {children}
    </div>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className={styles.p}>{children}</p>
}

export function Steps({ items }: { items: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className={styles.list}>
      {items.map((item, index) => (
        <li key={item.title} className={styles.item}>
          <span className={styles.bullet}>{index + 1}</span>
          <span>
            <span className={styles.itemTitle}>{item.title}</span>
            {item.body}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={index} className={styles.item}>
          <span className={styles.bullet}>·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function Code({ children }: { children: string }) {
  return <pre className={styles.code}>{children}</pre>
}

export function FootNote({ children }: { children: ReactNode }) {
  return <span className={styles.footnote}>{children}</span>
}
