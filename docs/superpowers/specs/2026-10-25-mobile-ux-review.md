# openGym UI/UX team review

Reviewed 2026-10-25. Three independent read-only reviews covered the daily workout flow, settings/library/scheduling, and the proposed Galaxy calendar integration. Findings were checked against the current local source and the web screens inspected during setup. This is not a physical-Galaxy usability test. No product code or live settings were changed for this review.

## Main finding

The interface exposes several valid but competing models—weekly routines, rotations, dated overrides and training progression—before the user's primary task: open today's booked activity, do it, and save it. The proposed calendar setup would add another configuration layer unless it replaces those competing choices in the normal flow.

## Prioritized findings

### P1: A dated schedule is presented as a recurring template

Plan's “This week” rows edit recurring weekdays, while specific dates live in a separate override sheet. The same Fixed Week/Rotation mode also appears in Settings. A person moving one Pilates booking can misunderstand the scope of a change.

Evidence: frontend/src/views/Plan.jsx:255–259,279–308,363; frontend/src/views/Settings.jsx:679; frontend/src/sheets.jsx:2437.

Recommendation: make the normal Schedule screen a dated agenda for this week/next week. When calendar sync is enabled, its bookings are the schedule source in the imported window. Keep weekly/rotation settings intact but out of the normal flow, under Advanced scheduling. On an empty calendar day, say “Nothing scheduled”; do not silently label a rotation suggestion as a booking. A separate Start an unscheduled workout action remains available.

### P1: Two scheduled activities can become one combined workout

Home and the central Start control pass all today's routine IDs to workout start. That suits some multi-routine training but is wrong for distinct Full Body and Pilates bookings.

Evidence: frontend/src/views/Home.jsx:32–34,99; frontend/src/components/TabBar.jsx:36–40.

Recommendation: one card per booking, in time order, each with its own action. Combining routines should be explicit and secondary. Calendar occurrence identity is retained independently of routine ID.

### P1: Variable Pilates classes are treated as exercise templates

The calendar design requires a second routine mapping even though the user reports variable classes of approximately 50 minutes. The existing Pilates template's 15 exercises are not evidence of what happens in any particular booked class.

Evidence: /private/tmp/opengym-galaxy-calendar-design.md, User flow and Synced representation sections; live account's existing Pilates template.

Recommendation: Pilates is a class booking by default. Show booked start and duration; offer Log class to confirm attendance and optionally adjust actual duration/add notes. Never infer that individual Pilates exercises were completed. Keep it in the same History experience with a class type rather than creating a separate destination. Association with an exercise routine is an optional later advanced feature.

### P1: Set logging competes with instructional and historical material

Default Cards/full-animation mode places media, tags, notes and history/progression ahead of the set table. The app already has a Compact mode and already hides many advanced shortcuts, so this can be simplified without a wholesale rewrite.

Evidence: frontend/src/store/useStore.js:106,115; frontend/src/views/Workout.jsx:634–690; frontend/src/lib/workout-controls.js.

Recommendation: prefer a compact daily view: exercise name, weight/reps, completed-set control and rest feedback. Expand “How to do it” for the GIF and muscle information, and “History” on demand. Keep the GIF easy to reach for unfamiliar exercises.

### P2: Routine editing starts with specialist settings

Progression/deload and explanatory text appear before exercises. Small move/link controls compete with basic editing.

Evidence: frontend/src/views/RoutineEdit.jsx:475–510,539–543.

Recommendation: name → exercise list → Add exercise. Put progression, deload, intensifiers and similar controls under Advanced. Keep an accessible Reorder action and adequate touch targets; do not rely only on long press.

### P2: Library and custom exercise creation are overexposed

Library stacks body part, training type and equipment filters before results, then exposes custom creation prominently. The custom-exercise promise mentions name/body part but save also requires equipment; all equipment/muscle/media controls appear together. A row action labelled “Plan” actually adds to a routine, which is easy to confuse with scheduling.

Evidence: frontend/src/views/Library.jsx:66,81–107; frontend/src/sheets.jsx:1222,1273–1280.

Recommendation: search plus Filters; “Add to routine” instead of “Plan”; compact custom creation with name, body area and equipment, then optional More details for anatomy/notes/media. Keep exercise discovery inside routine editing in the everyday navigation.

### P2: Finish actions have different paths

Header Finish opens a save/discard sheet; bottom Finish invokes a helper that saves immediately when all sets are done and confirms incomplete workouts.

Evidence: frontend/src/views/Workout.jsx:2019–2020,2174–2178; frontend/src/sheets.jsx:3509–3536.

Recommendation: one consistent Finish → summary → Save flow, with Discard in secondary options and appropriate confirmation.

## Recommended normal navigation

- Today: upcoming/active booking, a single clear Start or Resume action. Distinct cards for separate bookings.
- Schedule: current/next-week dated agenda; My workouts opens reusable routine templates from here.
- History: completed strength sessions and Pilates classes, with statistics behind a secondary control.
- Settings stays behind the gear. Library is reached from editing a workout rather than occupying a primary tab.

This is a proposed navigation change, not an implemented setting.

## Simplified Galaxy calendar setup

1. Connect calendar: one sentence explaining read-only access, then the Android permission prompt after the user's tap.
2. Pick the intended calendar; account context appears only where needed to distinguish names.
3. Confirm preview: “Strength → Usual Full Body” (Change), “Pilates → Class”, plus a count/list of recognized upcoming sessions. Tap Import workouts.

Normal defaults: this/next week, configured local timezone, Hebrew/English recognition, event times/durations, refresh on app open/resume, no background polling or calendar writes. Pilates 50 minutes and strength 60 minutes are fallback durations, not overrides of explicit bookings.

Connection settings show only calendar name, Updated time, Refresh and Disconnect. Permission repair appears only on failure. Ownership takeover appears only on a second importing phone. Advanced alias editing or unmatched-title review appears only when needed. Do not display technical event IDs, snapshot windows or reconciliation controls to the user.

## Suggested implementation order

1. Revise the calendar design around a three-step connection flow, calendar-led agenda, separate bookings and simple Pilates class logging.
2. Implement that scope and test current/next-week import plus moved/cancelled events, manual overrides, denial and offline reopening.
3. Reuse Compact workout logging and move routine/settings complexity behind Advanced; do not mix all navigation changes into the first calendar implementation.
4. After a physical-Galaxy task test, decide whether the proposed three-tab navigation merits a separate change.

## Limitations and non-findings

The review did not operate the Galaxy or measure actual task times. It identified concrete code-backed interaction problems and design risks. Apple Watch settings are already gated to iOS and are not Android clutter. Fresh profiles already disable pre-workout weighing. Advanced workout shortcut groups are already hidden by default. These were not counted as defects.
