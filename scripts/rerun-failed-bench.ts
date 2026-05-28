// scripts/rerun-failed-bench.ts
//
// One-off helper: re-run a SINGLE benchmark task and print the resulting row as
// JSON on stdout. A companion shell wrapper splices it into an existing batch
// in the SQLite DB via the `sqlite3` CLI (we can't load better-sqlite3 here —
// it's compiled for Electron's Node ABI, not the system node).
//
// Usage:
//   npx tsx scripts/rerun-failed-bench.ts <taskId> <model>
//
// Prints a single JSON line on stdout — everything else goes to stderr.

import { runBenchmarkTask } from '../src/main/services/benchmark/runner'
import { TASKS } from '../src/main/services/benchmark/tasks'

const [, , taskId, model] = process.argv
if (!taskId || !model) {
  console.error('usage: tsx scripts/rerun-failed-bench.ts <taskId> <model>')
  process.exit(2)
}

const task = TASKS.find((t) => t.id === taskId)
if (!task) {
  console.error(`unknown taskId: ${taskId}`)
  process.exit(2)
}

console.error(`re-running ${taskId} (model=${model})...`)
const result = await runBenchmarkTask(task, { model, repoRoot: process.cwd() })
console.error(
  `done: success=${result.success} failReason=${result.failReason} ` +
    `turns=${result.numTurns} dur=${result.durationMs}ms tokens_out=${result.tokensOut}`,
)
// Also dump the model's final text so we can debug assertion mismatches.
import { writeFileSync } from 'node:fs'
const dumpPath = `/tmp/rerun-${taskId}.txt`
writeFileSync(dumpPath, result.resultText ?? '')
console.error(`final-turn text dumped to ${dumpPath}`)
const { resultText: _ignore, ...metrics } = result
console.log(JSON.stringify(metrics))
