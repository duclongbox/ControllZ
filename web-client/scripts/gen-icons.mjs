// Regenerates the PWA icons from public/favicon.svg.
//
//   node scripts/gen-icons.mjs
//
// Needs rsvg-convert (`brew install librsvg`). Run it only when the brand mark
// changes; the outputs are committed so a normal build and CI need neither the
// script nor librsvg.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public')

const source = readFileSync(`${publicDir}/favicon.svg`, 'utf8')
const inner = source
  .trim()
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>$/, '')

// The mark is drawn on a 48×46 grid. It sits at 62% of the canvas so it clears
// the 80% safe circle Android crops a maskable icon to.
const SCALE = (512 * 0.62) / 48
const width = 48 * SCALE
const height = 46 * SCALE
const tx = (512 - width) / 2
const ty = (512 - height) / 2

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <!-- Generated from favicon.svg by scripts/gen-icons.mjs. The background is
       full-bleed because a maskable icon is cropped to a circle, and a
       transparent one would be cropped to nothing on Android. -->
  <rect width="512" height="512" fill="#0B0C0E"/>
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${SCALE.toFixed(4)})">${inner}</g>
</svg>
`

writeFileSync(`${publicDir}/icon.svg`, icon)

// 192 and 512 are what the manifest needs; 180 is the apple-touch-icon, which
// iOS uses instead of the manifest icons.
for (const size of [192, 512, 180]) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), `${publicDir}/icon.svg`, '-o', `${publicDir}/icon-${size}.png`])
}

console.log('wrote icon.svg, icon-192.png, icon-512.png, icon-180.png')
