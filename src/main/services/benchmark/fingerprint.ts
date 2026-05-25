// src/main/services/benchmark/fingerprint.ts
import { createHash } from 'node:crypto'
import type { InfraState } from '@main/services/productivity/infra'

export function canonicalInfra(state: InfraState): string {
  const kv = (o: Record<string, boolean | number>): string[] =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${o[k]}`)
  return JSON.stringify({
    plugins: kv(state.plugins),
    skills: kv(state.skills),
    mcpActive: [...state.mcpActive].sort(),
    mcpDisabled: [...state.mcpDisabled].sort(),
  })
}

export function infraFingerprint(state: InfraState): string {
  return createHash('sha256').update(canonicalInfra(state)).digest('hex').slice(0, 12)
}
