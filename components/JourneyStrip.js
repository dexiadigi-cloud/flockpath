// Nov 5, 2026, guided whole-app flow (round-2 notes):
// the pastor's journey through the app, in order, on
// every pastor page: Start a pack, Building, Review,
// Approve and lock, Share. Earlier steps show a checkmark,
// the current step is bold, later steps are muted. This
// replaces the old 3-step FlowSteps indicator, which
// named only start/review/lock and never showed the
// building or share stages, so a pastor mid-build had
// no map. Pure display, no state. The strip itself is
// orientation, never a task: the tasks below it always
// run strictly top to bottom, never top, then bottom,
// then top again.
const STAGES = [
  { key: "start", label: "Start a pack" },
  { key: "building", label: "Building" },
  { key: "review", label: "Review" },
  { key: "approve", label: "Approve and lock" },
  { key: "share", label: "Share" },
];

export default function JourneyStrip({ stage }) {
  const current = Math.max(0, STAGES.findIndex((s) => s.key === stage));
  return (
    <div className="fp-steps" aria-label="Pack journey">
      {STAGES.map((s, i) => (
        <span key={s.key}>
          <span className={i === current ? "fp-step-current" : "fp-step"}>
            {i < current ? "✓ " : `${i + 1}. `}{s.label}
          </span>
          {i < STAGES.length - 1 ? <span aria-hidden="true"> → </span> : null}
        </span>
      ))}
    </div>
  );
}
