import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

const pad = (n: number): string => String(n).padStart(2, '0')

// Parse into a Date without timezone surprises: a bare 'YYYY-MM-DD' string is
// read as local midnight (new Date('YYYY-MM-DD') would be UTC and can shift a
// day). Anything else (Date, epoch ms, ISO datetime) goes through new Date().
function toDate(d: Date | string | number | null | undefined): Date | null {
  if (d == null || d === '') return null
  let date: Date
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    date = new Date(y, m - 1, day)
  } else {
    date = new Date(d)
  }
  return Number.isNaN(date.getTime()) ? null : date
}

// DD/MM/YYYY — the system-wide date format. null/invalid → '—'.
export function formatDate(d: Date | string | number | null | undefined): string {
  const date = toDate(d)
  if (!date) return '—'
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

// DD/MM/YYYY HH:MM:SS for timestamp fields. null/invalid → '—'.
export function formatDateTime(d: Date | string | number | null | undefined): string {
  const date = toDate(d)
  if (!date) return '—'
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// DD/MM from a 'YYYY-MM-DD' key — compact day/month order for dense chart axes.
export function formatDayMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}` : iso
}
