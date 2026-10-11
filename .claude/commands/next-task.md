---
description: Work the next unchecked task in the current phase of docs/ROADMAP.md
---
1. Read `docs/ROADMAP.md`; find the current phase (line "Current phase:") and its first unchecked task.
2. Read the relevant design doc section (`docs/PLAN.md`, `docs/EDHREC.md`, or `docs/SIMULATION.md`).
3. Briefly state the task and your approach, then implement it with tests (pure logic test-first).
4. Run `npm run check`.
5. Tick the task in `docs/ROADMAP.md`, add notes to `docs/phases/phase-N.md` (verified facts, surprises),
   and update any design doc that turned out wrong.
6. Commit as `phase-N: <what changed>`.
Stop after one task and summarise what's next. If the task is the last one in the phase, run the gate check
and report the result instead of starting the next phase.
