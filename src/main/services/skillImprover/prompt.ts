import { REPORT_SENTINEL } from '@shared/skillImprover'

// Re-export so existing importers (run service, prompt tests) keep importing the
// token from here. Single source of truth lives in @shared/skillImprover.
export { REPORT_SENTINEL }

export interface ImproverPromptArgs {
  skillCreatorPath: string // absolute path to skill-creator's SKILL.md
  skillPath: string // absolute path to the skill dir being improved
  skillName: string
  workspace: string // temp dir the agent must confine all working files to
  reportPath: string // where the agent writes the final report JSON
}

// The wrapper prompt that drives an interactive skill-creator session inside
// Atlas. It keeps the agent autonomous on tooling (bypassPermissions) but in the
// loop with the user for substantive questions, redirects the browser-based eval
// viewer to a JSON report we render natively, and confines temp files so we can
// clean them up afterward.
export function buildImproverPrompt(args: ImproverPromptArgs): string {
  return `You are improving an existing Claude Code skill, running inside the Atlas desktop app (not a normal terminal). Follow the skill-creator process described in this file — read it first:

  ${args.skillCreatorPath}

The skill you are improving is at:

  ${args.skillPath}

(name: ${args.skillName})

## How this environment differs from normal skill-creator usage

1. There is NO browser and NO display. DO NOT open browser viewers. Specifically, do NOT run eval-viewer/generate_review.py or open any HTML. Where the skill-creator process tells you to open the viewer, instead write the benchmark data as JSON into the workspace and post a short plain-text summary into the chat for me to read.

2. Talk to me directly in the chat. When the skill-creator process says to ask the user something (intent, test cases, which baseline, whether results look good), just ask me here in plain text and wait for my reply. Keep questions concise.

3. Confine ALL working files (workspace, iterations, eval outputs, snapshots, benchmark.json) to this directory:

  ${args.workspace}

  Do NOT create a sibling <skill-name>-workspace next to the skill. Use the path above instead.

4. You MAY edit the real SKILL.md at ${args.skillPath} in place as your final improved version — its original has already been backed up by the app, so it is safe to overwrite. Apply your best final version there.

## Running the A/B comparison

Do real A/B runs as the skill-creator process describes (spawn subagents for with-skill vs baseline, grade them, aggregate). Run successive improvement iterations until you are satisfied or I tell you to stop. The baseline (n=0) is the original version of the skill.

## Finishing: the report

When you are done, write a final report as a single JSON file to:

  ${args.reportPath}

It MUST match this shape exactly (extra fields are ignored, but use these keys):

{
  "skillName": "${args.skillName}",
  "iterations": [
    { "n": 0, "passRate": 0.0, "tokens": 0, "durationMs": 0,
      "perEval": [ { "name": "what the eval checks", "passed": false, "notes": "..." } ] },
    { "n": 1, "passRate": 0.0, "tokens": 0, "durationMs": 0, "perEval": [] }
  ],
  "beforeDescription": "the original frontmatter description",
  "afterDescription": "the improved frontmatter description",
  "diffSummary": "human-readable summary of what changed in SKILL.md and why",
  "analystSummary": "why the new version is better, with the key evidence"
}

n=0 is the baseline; n=1, n=2, ... are your successive improved iterations. passRate is 0..1. Include one perEval entry per test case per iteration where you have data.

IMMEDIATELY after the file is written, output EXACTLY this line on its own, with nothing else on the line:

${REPORT_SENTINEL}

Then stop and wait. I will review the report in the app and either accept or reject your changes.

Begin by reading the skill-creator file and the target skill, then tell me your plan and ask any questions you need.`
}
