import { useEffect, useState } from 'react'

let booted = false
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Cinematic boot overlay: real environment data, <1.5s, once per launch,
 * pointer-events:none so it can never block input (or e2e clicks). */
export function BootSequence() {
  const [gone, setGone] = useState(booted || reduced)
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (gone) return
    booted = true
    const dial = getComputedStyle(document.documentElement).getPropertyValue('--fx-boot').trim()
    if (dial === '0') {
      setGone(true)
      return
    }
    const ticker = setInterval(() => setStep((s) => s + 1), 140)
    const done = setTimeout(() => setGone(true), 1450)
    const skip = () => setGone(true)
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      clearInterval(ticker)
      clearTimeout(done)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [gone])
  if (gone) return null
  const ua = navigator.userAgent
  const electronV = /Electron\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const chromeV = /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? '—'
  const lines = [
    'atlas.os // boot',
    `electron ${electronV} · chromium ${chromeV}`,
    `renderer ready · ${new Date().toISOString().slice(0, 19)}Z`,
    'linking backend…',
  ]
  return (
    <div className="fx-boot" aria-hidden>
      <div className="fx-boot-brand">ATLAS.OS</div>
      <div className="fx-boot-log">
        {lines.slice(0, step + 1).map((l) => (
          <div key={l}>▸ {l}</div>
        ))}
      </div>
    </div>
  )
}
