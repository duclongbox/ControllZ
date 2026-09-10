/* The icon set — 24×24 grid, 1.75 stroke, identical geometry to the Figma
 * `Icon/*` components. Stroke is `currentColor` so an icon always inherits the
 * colour of the control holding it; no icon ever sets its own colour. */

const PATHS = {
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  stats: 'M3 12h4l3-9 4 18 3-9h4',
  keyboard:
    'M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2z M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9.5 13h5',
  quality: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  fullscreen:
    'M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M16 21h3a2 2 0 002-2v-3M8 21H5a2 2 0 01-2-2v-3',
  power: 'M12 2v10M18.4 6.6a9 9 0 11-12.8 0',
  monitor: 'M2 5a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2z M8 21h8M12 17v4',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
  qr: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3v3h-3z M19 19h2v2h-2z',
  camera:
    'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M16 13a4 4 0 11-8 0 4 4 0 018 0z',
  settings:
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  alert: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z M12 9v4M12 17h.01',
  wifi: 'M1.4 8.8a15 15 0 0121.2 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 20h.01',
  trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 018 0v4',
  pointer: 'M5 3l13.5 6.5-6 1.8-1.8 6z',
  hand: 'M18 11V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v7M10 10.5V6a2 2 0 00-4 0v9M18 11a2 2 0 014 0v3a8 8 0 01-8 8h-2a8 8 0 01-8-8v-1a2 2 0 014 0',
  shield: 'M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6z',
  zap: 'M13 2L3 14h8l-1 8 10-12h-8z',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  rotate: 'M23 4v6h-6M20.5 15a9 9 0 11-2.1-9.4L23 10',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'arrow-down': 'M12 5v14M5 12l7 7 7-7',
  phone: 'M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z M11 18h2',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01M8 17h.01',
  globe: 'M12 2a10 10 0 100 20 10 10 0 000-20z M2 12h20 M12 2a15 15 0 010 20 15 15 0 010-20z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ display: 'block', flex: 'none' }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
