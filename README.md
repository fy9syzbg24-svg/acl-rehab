# Project Juicy Ass

ACL rehab tracker.

A local web app for Reuben's bilateral ACL reconstruction rehab. Tracks the
6-month goal-based protocol, the Melbourne ACL guide, daily training, and every
measurement — clinic tests, VALD Dynamo, VALD force plates and your own numbers.

No dependencies. Pure Python standard library + plain ES modules.

## Run it

Double-click **`start.command`**, or:

```bash
python3 "/Users/reuben/Desktop/Reuben's Claude Master Workspace/acl-rehab/server.py"
```

Then open <http://localhost:8757>. Ctrl-C stops it.

## Using it on your phone

The terminal also prints a `http://192.168.x.x:8757` address. Open that on your
phone and you can log sets from the gym floor.

**This only works at home.** That address is a home-network address — it does
not exist outside your Wi-Fi. To use the app on your phone you need all three of:

1. the Mac **awake**,
2. the server **running**,
3. the phone on the **same Wi-Fi** as the Mac.

Being online is not the requirement; the Mac being awake and on the same network
is. If the Mac sleeps mid-session the app stops responding on your phone. To stop
that, launch it with:

```bash
caffeinate -s python3 "/Users/reuben/Desktop/Reuben's Claude Master Workspace/acl-rehab/server.py"
```

`caffeinate -s` keeps the Mac awake for as long as the server runs, and lets it
sleep normally again once you Ctrl-C.

If you later want this to work away from home — on tour, or back in the States —
there are two routes: a private link to the Mac (Tailscale), or converting the
app so it runs standalone on the phone with no Mac at all. Neither is built yet.

## Tabs

**Everything you enter goes in on the Today tab.** The other four tabs are
read-only views of it.

| Tab | What it is for |
| --- | --- |
| **Today** | The whole session on one page. Knee check-in and tests sit collapsed side by side at the top; below that, four tabs — Rehab program, Open chain, Anything else, Completed today |
| **My Program** | Elise's program with pictures, full instructions, prescriptions, Theraband colour and where you are on each progression. Plus your working resistance for the gym lifts |
| **6-Month Plan** | The six months, their goals/markers, focus items and weekly targets. Progress bars fill from your recorded measurements |
| **Melbourne** | Phase criteria and outcome measures, plus a working MRSS 2.0 scorer (ACL-RSI, IKDC, TSK-11 all included) |
| **Progress** | Four panels: This week · History (streaks, heatmap, pain trend, timeline) · Tests & VALD (baselines, PRs, every result) · Clinical notes |

### Colour

Every exercise row carries a 3px edge in its category's colour (strength
orange, balance teal, aerobic blue, impact violet…), so a session list reads as
a rhythm of colour rather than a wall of white. Done rows switch their edge to
green. The month board header is a blue→violet gradient banner; progress bars,
the journey fill and section-title kickers pick up the same ramp. All of it is
built from the theme variables, so dark mode gets the same treatment free.

### The journey road

A strip at the top of Today: the six months as nodes on a road, the three
Melbourne phases tinted underneath, a pulsing dot where you are, and each
month's markers-met count under its node. A month that met all its markers gets
a ✓. Click any node to open that month in the 6-Month Plan tab. It is plain
HTML positioned by percentage, so the type stays crisp at any window width.

### Insights

Up to three cards under the month board, computed fresh from your data — a
logging streak, a new personal best this week (with what it was before), a
measured test that climbed, or pain trending down (or up, in amber) across two
weeks. Rules live in `app/js/insights.js`; an insight without data simply
doesn't appear, and nothing is ever invented.

Marking a loaded exercise done also checks it against your history — beat your
previous best and a toast slides up with the old and new numbers.

The collapsed "How the knees are" header carries a 14-day pain sparkline once
there are at least three check-ins to draw.

### The month board

The top of Today carries **This month** — the 6-month plan, surfaced where you
will actually see it. Collapsible, but open by default. Four parts:

- **Markers** — this month's measurable goals with a progress bar, your current
  best, and an **on pace / behind pace** read. Pace is blunt: it compares how far
  through the goal you are against how far through the month you are, with a
  little slack. It is a nudge, not a prediction.
  Each marker has a **＋ in its corner**: on a measurable one it opens the
  measurement sheet already set to the right test and date, so you can update it
  without scrolling anywhere; on a qualitative one it toggles done.
- **Days left** and a ring showing markers met.
- **This week** — one row of pips per category from the plan's weekly session
  targets, sorted worst first, with a "light on …" flag on the weakest.
- **The month's focus** — every focus bullet from the plan as a tile that
  **ticks itself** from what you log, with a day count. No self-assessment.
- **Still outstanding** — any marker from an earlier month that was never met
  carries forward in an amber callout until you hit it.

The 55 focus bullets across the six months are each mapped to the exercises that
satisfy them, in `app/data/plan.js` (`ex: [...]` or `cat: '…'`). 50 of 55 tick
automatically; the remaining 5 are judgement calls like "soft, controlled
landings", which stay manual and sit behind a disclosure. The 6-Month Plan tab
shows the same auto-ticks with a per-month count.

### The two panels at the top

**How the knees are** and **Measurements & tests** are collapsed by default and
sit side by side, because neither is needed most of the time. Each header carries
a live summary — "pain L 3 · R 1 · swelling Trace · yesterday: same", or
"nothing recorded today" — so you can see the state without opening either.
Click a header to expand it; they toggle independently.

### Green means done

A row has three states. Clicking the row body expands it for input and does
**not** mark it done. Collapsing it again keeps your numbers and leaves it grey.
It only turns green when you tick the checkbox or press **Log it**. Ticking the
checkbox never expands the row.

**Tabs in Today's session**: Rehab program · Open chain · **By goal** ·
Anything else · Completed today.

**By goal** is generated from the plan, not hardcoded. It lists whatever weekly
targets the month you are in actually asks for, worst-first, with the one you
are furthest behind on already open. Month 1 gives you Aerobic, Balance and
Strength; Month 2 swaps in Interval conditioning and Impact-prep; Month 4 brings
Plyometric, Agility, Jogging intervals, Dance-specific and Kneeling. Open a group
and every exercise of that kind is there to tick — this month's picks first,
"Show all N" for the rest — each with its week dots.

**Holds are logged in seconds.** Balance work, wall sits, side bridges, calf
pulses and stretches show a **Secs** field instead of Min. Any exercise that
feeds a month marker also carries a small **↗ test** button: it opens the record
sheet with your number already filled in, so 18 seconds of juggling on foam
becomes a test result and turns that marker green without retyping anything.
The record sheet shows the exercise photo at the top.

**Completed today** is a tab in Today's session: everything currently
green, gathered from the other three tabs. Untick one there to send it back.
The other tabs are just browsing filters — a green exercise shows in both.

"Repeat last session" and "Back In Motion program" drop their rows in **grey**.
Nothing counts as done until you tick it.

### Weekly cadence

Elise's program specifies sets, reps and holds — **it does not say how often to
do anything**. So each exercise inherits the weekly *session* count that its
category has in the 6-month plan, for whichever month the date falls in. In
Month 1 that means strength exercises get 3/week, balance exercises 4/week.
Move into Month 6 and strength drops to 2/week, because the plan says so.

Where the plan has no target for a category that month — impact work in
Month 1, for instance — the exercise reads `0/–` and "not this month" rather
than inventing a number.

Hover any target to see where it came from. `from plan` means the number is
written in your protocol; `my number` means I chose it. Type over any target to
fix it to your own; clear the box to fall back to the plan again.

Every exercise row in Today shows seven dots, Monday to Sunday, filled on the
days you logged it, with `2/3` beside them. The count turns amber when there are
no longer enough days left in the week to reach the target, and green when you
hit it. Progress → This week has the same thing as a full grid: every exercise
down the side, the seven days across, and "2 to go". Tap any cell to open that
day. Change a target in the grid and it applies everywhere.

Dots count the exercise, not the program row — so it still counts if you logged
it under Anything else.

### No duplicates, ever

An exercise can only appear once per side per day. Adding something already
logged jumps to the existing row and flashes it rather than stacking a second
copy — edit the reps there. "Repeat last session" and "Back In Motion program"
both skip anything already on the day, so pressing them twice does nothing.

Each segment has a **Clear** button (and "Clear all N" under Anything else) so
you never have to delete rows one at a time.

Two rows for the same exercise are normal when it is a single-leg movement —
that is the left row and the right row, so the sides can carry different loads.

### Photos

Every exercise in the program has a picture. Fifteen came out of Elise's
PhysiApp export; **exercise 4, the butterfly gluteal bridge, uses four frames
Reuben supplied** because the PhysiApp export had a close-up of a light ring
there instead. Exercise 17 borrows the photo from exercise 14, which is the same
set-up on a step.

Elsewhere in the app, movements that were never photographed borrow the closest
picture from that set — shown slightly faded, with a tooltip naming the exercise
it is actually a photo of.

Everything still left over gets a **drawn pictogram** from `app/data/icons.js`:
37 line glyphs, tinted to the exercise's category colour. They are drawn in that
file rather than sourced, so the set is visually consistent and there is no
licensing question. Nothing in the app is ever a blank tile. To change one, edit
its entry in `ICONS`; to point an exercise at a different glyph, edit `ICON_FOR`.

To replace a picture: drop the new image in `app/img/program/`, point `img` and
`thumb` at it in `app/data/program.js`, and add a `photoNote` if it needs one.

### Logging a session

Open **Today**, tick the exercises you did. Sets, reps, load and band colour
fill in from the last time you did that exercise, so most sessions are a few
taps. Single-leg exercises create a left row and a right row so the two sides
can carry different loads. **Tick everything** drops the whole rehab program in
at once.

Under **Open chain**, each lift shows your heaviest ever load per side and a
bar for your top load in each of the last twelve sessions — so you can see where
to start before you load the bar. Record a load and the board moves immediately.

## PhysiApp sync

PhysiApp (Physitrack's patient app) has no export and no patient API — `/program.json`
looks like one but only 401s because the auth filter runs before Rails resolves the
format; once signed in it 404s. Their real API is a clinic-side enterprise integration.

So `physiapp.py` signs in the way the website does — program code plus year of birth,
CSRF token, session cookie good for 14 days — and reads the pages it serves. It is
strictly **read-only**: it never posts feedback and never marks anything complete on
their side.

**The rule that matters.** An exercise you have *not* logged still renders a fully
populated results form, prefilled with Elise's prescription. Reading those numbers
would invent a session you never did. A genuine log is identifiable two ways and the
parser requires both:

```html
<form class="simple_form feedback-form recorded" id="edit_exercise_action_559940440">
                                    ^^^^^^^^                ^^^^^^^^^^^^^^^^^^^^^^^^
```

Anything missing either one is treated as not done, whatever the selects say.

**How a sync walks.** `GET /program/YYYY-MM-DD` gives the day's tiles; completed ones
carry a `done` class. Only those get a detail fetch, so an untouched day costs a single
request and a fully completed one costs 17.

A date with no tiles at all is normal, not a failure — any day before the program
started on 4 Aug 2026, or one their calendar has no program day for. `fetch_day`
returns `hasProgram: False` for those and the run carries on. Only when *every* date in
the range comes back empty does the sync raise, because that means the markup changed.
(Getting this wrong made "Sync the last 7 days" abort outright while "Sync today"
worked, since the 7-day range reaches back before the program existed.)

**It runs itself.** Enter the program code and year of birth once in Settings and the
app syncs on every open — today and yesterday, so a late tick in PhysiApp still lands.
The session cookie is cached in memory and reused (signing in on every sync would be
waste), an auto-sync inside ten minutes of the last one is skipped, and the whole thing
is silent unless it actually finds something. There is a checkbox to turn it off, and
*Sync today* / *Sync the last 7 days* buttons for doing it by hand.

Failures are classified so the automatic run knows when to speak. Offline or their
server hiccuping is transient and stays quiet; a rejected code, a signed-out session or
changed markup raises a warning, because otherwise syncing would die silently and the
log would go stale without anyone noticing.

**What lands.** Real reps, sets, hold, weight and feedback text. Rows come in with side
`B`: PhysiApp records one figure per exercise with no left/right split, so splitting it
across two rows would be a guess. Entries are stamped `via: "physiapp"` — re-syncing
updates those in place and never duplicates, and a row you logged by hand is never
touched (the sync reports it as kept). Exercises it cannot map are reported by name
rather than guessed.

Corrections you make here stick. Each synced row carries a snapshot of what PhysiApp
last reported; if the row no longer matches it, you edited it and the sync leaves it
alone. Without that, an auto-sync on every app open would quietly undo every correction
you ever made.

Credentials live in `settings.physiapp` inside `data/rehab-data.json` on this Mac.

**The catch, stated plainly:** PhysiApp only knows what you tap. As of 7 Aug 2026 the
program had one exercise ticked across four days (average adherence 2.08%), so the sync
is only as useful as your ticking discipline over there. Your own log here holds more
than PhysiApp has fields for — load, band colour, seconds, cardio.

## Log once, count twice

Some exercises *are* the test the 6-month plan measures. Logging single-leg
balance on foam and then re-typing the same seconds on the Measures tab was
double entry, so logging now records the test as well.

Eleven exercises qualify — every one whose measure is counted in **seconds** or
**reps**, the only two quantities a training row genuinely holds:

    seconds   single-leg stance (eyes open / eyes closed), on foam with a task,
              side bridge
    reps      single-leg calf raises (both variants), single-leg bridge (both),
              lateral step-ups, single-leg rise, repeated hops

All of those tests are per-leg, so one number cannot honestly become two
results. How the row asks for them depends on the unit:

- **seconds** — the Secs box splits into **L** and **R**. The seconds you hold
  *are* the test, and nothing else writes to `secs`, so there is no conflict.
- **reps** — the Reps box is left alone and two **Best L / Best R** boxes are
  added beside it. Reps are deliberately *not* split, for two reasons: PhysiApp
  syncs into `reps`, so replacing it with empty boxes hid the number that had
  actually come across; and the reps you grind out in a working set are not a
  max-effort test. 2×8 as training with a best of 14 is a normal day, and the
  log now records both truthfully.

Deliberately excluded: one-rep-max squat and leg press (weight), star excursion
(cm), show run-through (per cent and minutes). A working set is not a 1RM and
reps are not centimetres, so those keep the manual **↗ test** button.

Three guards, because a wrong test result moves a month marker:

- nothing is written unless you actually typed a number
- never a second result for the same test, leg and day — re-logging or editing
  cannot stack duplicates, and a test you recorded properly is never overwritten
- a both-sides row for a per-leg test is skipped rather than guessed

## Where your data lives

`data/rehab-data.json` — one human-readable file, rewritten atomically on every
change. Backups are kept in `data/backups/` — the last 300 saves, and nothing under
7 days old is ever deleted. Settings → **Download a
backup** gives you a copy, and **Export training log (CSV)** gives you a
spreadsheet of every set.

## Things worth knowing

- **The clinician program is Elise McMahon's PhysiApp program**, "Ankle & Core
  & pelvis program", updated 5 Aug 2026 — 16 exercises with their own pictures,
  wording and prescriptions. Videos are at au.physiapp.com, code `dhxbmmbs`.
  Two items from your typed list that PhysiApp does not cover are included and
  tagged `typed list`. Theraband colours come from the typed list; PhysiApp does
  not specify a colour.
- **Two clinics, one exercise.** Back In Motion's "single-leg inner-range quads"
  and Performance Medicine's "single-leg knee extension, end of range" are
  treated as the same exercise, so your 4.3 kg / 9 kg history flows into the
  gym board. Same for full-range quads. Split them in `app/data/exercises.js`
  if that is wrong.
- **Dates.** Left ACL reconstruction 20 Feb 2026 (quad autograft + medial
  meniscus repair, 6 weeks non-weight bearing). Right 8 May 2026 (quad autograft
  + meniscus trim, immediate weight bearing). Both are editable in Settings.
- **Seeded rows carry an orange dot.** Those came from `Clinical_Notes.pdf` or
  the VALD report, not from you. Edit or delete them freely.
- **`from plan` vs `my default`.** Anything tagged `from plan` is a number
  written in your protocol. Anything tagged `my default` is a starting frequency
  I chose because the document names the activity but not how often — change
  those to whatever you and your physio agree.
- **LSI is de-emphasised.** With two reconstructed knees a limb symmetry index
  can read 100% while both legs are weak. The absolute hurdles are what count.
- **Asymmetry figures from VALD are stored verbatim**, not recomputed, so they
  match the report exactly. Anything the app computes itself is greyed out.

## Layout

```
server.py            stdlib HTTP server + JSON persistence
start.command        double-click launcher
app/
  index.html
  styles.css
  img/program/       the 16 exercise photos + thumbnails, from program.pdf
  data/              protocol content: plan, melbourne, program, exercises,
                     measurements, questionnaires, icons, clinical history
  js/
    store.js         state, load/save, seeding
    util.js          dates, units, formatting
    components.js    modal, exercise picker, measurement entry, charts
    views/           one module per tab and per Progress panel
data/
  rehab-data.json    your data
  backups/           rolling auto-backups
```

Not medical advice — every threshold in it is copied from your own documents.
