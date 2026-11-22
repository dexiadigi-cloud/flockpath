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
// Nov 11, 2026, v52, Phase 2 member mode: a member's
// journey ends at saving and printing, never at approval
// or sharing, so the last two stages are "Save my study"
// and "Print" for a member. The strip takes an optional
// member flag; pastor pages are unchanged.
// Nov 12, 2026, v55: rendered as step pills (mockup
// Design 2): numbered circles, done steps green with a
// check, the current step gold, later steps muted.
const PASTOR_STAGES = [
  { key: "start", label: "Start a pack" },
  { key: "building", label: "Building" },
  { key: "review", label: "Review" },
  { key: "approve", label: "Approve and lock" },
  { key: "share", label: "Share" },
];

const MEMBER_STAGES = [
  { key: "start", label: "Start a pack" },
  { key: "building", label: "Building" },
  { key: "review", label: "Review" },
  { key: "save", label: "Save my study" },
  { key: "print", label: "Print" },
];

// Nov 20, 2026, v62 (item 1): the strip takes optional translated
// labels (journey.* keys). Callers that know the app language pass
// them; callers that do not keep the English defaults.
export default function JourneyStrip({ stage, member, labels }) {
  const STAGES = (member ? MEMBER_STAGES : PASTOR_STAGES).map((s) => ({
    ...s,
    label: labels?.[s.key] ?? s.label,
  }));
  const current = Math.max(0, STAGES.findIndex((s) => s.key === stage));
  return (
    <div className="fp-steps" aria-label="Pack journey">
      {STAGES.map((s, i) => (
        <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className={`fp-step-pill${i < current ? " fp-step-pill-done" : i === current ? " fp-step-pill-current" : ""}`}>
            <span className="fp-step-num">{i < current ? "\u2713" : i + 1}</span>
            {s.label}
          </span>
          {i < STAGES.length - 1 ? <span className="fp-step-sep" aria-hidden="true">&rsaquo;</span> : null}
        </span>
      ))}
    </div>
  );
}
