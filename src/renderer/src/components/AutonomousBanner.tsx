// Persistent indicator shown at the top of a worker chat whenever the session
// was started in autonomous mode. Combines the always-on ⚡ AUTONOMOUS badge
// with an explanatory line spelling out what the mode authorizes, since it
// permits real production-affecting actions (commit/push/merge/deploy) with no
// further confirmation. Renders nothing when the session is not autonomous.
export function AutonomousBanner({ autonomous }: { autonomous: boolean }) {
  if (!autonomous) return null
  return (
    <div className="autonomous-banner" role="status">
      <span className="autonomous-badge">⚡ AUTONOMOUS</span>
      <span className="autonomous-banner-text">
        This session may commit, push, merge to main, and deploy without asking.
      </span>
    </div>
  )
}
