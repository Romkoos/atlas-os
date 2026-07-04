// Shared motion vocabulary (spec §5). CSS twins live in index.css (--dur-*, --ease-*).
export const springSnappy = { type: 'spring', stiffness: 380, damping: 30 } as const
export const easeOut = [0.23, 1, 0.32, 1] as const
export const DUR = { fast: 0.12, base: 0.18, slow: 0.24, ambient: 0.45 } as const
