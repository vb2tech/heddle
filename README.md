# heddle

A local control plane for every Claude Code session running on this machine. It
reads the state Claude already writes to `~/.claude` and renders it as one live
dashboard, so you can hold several streams of work in your head at once.

> On a loom, the *heddle* is the piece that keeps each thread separate and lets
> you raise them one at a time. This does the same for the threads the UI shows:
> every session visible at once, any one of them pulled forward on demand.

### Installing `/wrap`

Optional but recommended — it is what produces the good checkpoints:

```
cp commands/wrap.md ~/.claude/commands/
```

Then run `/wrap` in any session before you close it.

### Requirements

- **Node 20.19+** (Vite 6). No other runtime dependencies.
- Any package manager — a `pnpm-lock.yaml` is committed, but `npm install`
  works too.
- Claude Code having been run at least once, so `~/.claude` exists. If it
  doesn't, the dashboard simply shows nothing rather than failing.

### Run it

```
npm install
npm run dev          # API on :4317, UI on :5317 (hot reload)
```

Then open **http://localhost:5317**.

Or build once and run a single process:

```
npm run build && npm start     # everything on http://localhost:4317
```

### Configuration

All optional, all environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4317` | API port. The Vite dev proxy reads this too, so the pair stays in sync. |
| `UI_PORT` | `5317` | Vite dev-server port. |
| `POLL_MS` | `1000` | How often `~/.claude` is re-scanned. |
| `CLAUDE_DIR` | `~/.claude` | Where to read state from. Handy for pointing at a fixture. |

The server binds **loopback only** (both IPv4 and IPv6), so nothing is exposed
beyond the machine.

## Layout

```
┌──────────────────────────┬──────────────────────────┐
│ INSPECTOR                │ THREADS                  │
│ the selected thread,     │ every live session,      │
│ in depth                 │ click one to inspect it  │
│                          ├──────────────────────────┤
│ summary │ chat │ files   │ PARKING LOT              │
│ tasks │ agents           │ parking │ ready │ jobs   │
└──────────────────────────┴──────────────────────────┘
```

The split is **one thread on the left, everything at a glance on the right**.
Selecting a session in `THREADS` drives the inspector.

All three splitters drag, and the proportions persist to `localStorage`.

### Inspector — the selected thread

The terminal already shows you the transcript, so the inspector earns its space
on the tabs that the terminal can't easily give you:

| Tab | What it shows |
| --- | --- |
| `summary` | **Default.** A plain-English reading of the session (see below). |
| `chat` | The raw transcript, tailed live, with thinking and tool noise toggleable. |
| `files` | Every file the session touched, split into **edited** and **read only**, with write/read counts. Derived from the tool calls in the transcript. |
| `tasks` | This session's own dependency graph, with `⛒ blocked-by` / `→ unblocks`. |
| `agents` | Subagent threads spawned by this session, with each one's latest output. |

### Summary — plain English, without a model

The default inspector tab reads the session back in prose. It is deliberately
**not** model-generated, for two reasons:

1. Summarising every session on a timer would cost roughly a million tokens an
   hour to narrate work you are already paying to do.
2. It is unnecessary. The transcript *already* contains plain English — Claude's
   own prose. What makes the raw view unskimmable is that the prose sits between
   tool calls and large result blobs.

So the summary keeps Claude's prose verbatim and **renders** its markdown —
headings, bullet and numbered lists, bold, inline code, fenced code, tables and
quotes — through a small dependency-free renderer. An earlier version stripped
the markup instead, which destroyed the structure that makes prose skimmable:
lists collapsed into run-on sentences and headings became indistinguishable from
body text. The markup was never the problem; flattening it was.

Around the prose, each run of tool activity folds into one line — *ran ×3*,
*edited 4 files* — with shell commands trimmed of their `cd …` scaffolding and
home paths shortened to `~`. Failures are surfaced in place, and the digest
closes with whether the session is still working (with a live marker) or how
long it has been waiting on you.

Free, instant, offline. The `steps` toggle hides the tool lines entirely, and
`chat` is always one click away when you need the raw output.

### The activity feed (retired)

An earlier version derived a cross-session event feed by diffing snapshots. It
is no longer shown — it mostly narrated a session you were already watching —
but the derivation is intact and still served at `GET /api/feed` if it turns out
to be wanted.

### Across sessions

Nothing on disk records *what happened* — only current state. The feed is built
by diffing consecutive snapshots and tailing each transcript for failures, which
makes it the one view no single terminal can produce, because it spans
processes. It answers "what changed while I was heads-down in another window."

| Event | Severity |
| --- | --- |
| `turn_done` — a session finished and wants you, captioned with what it actually said | **attn** |
| `tool_error` — a tool call failed | **warn** |
| `ctx_high` — context crossed 80% | **warn** |
| `compacted`, `task_done`, `task_started`, `agent_spawn`, `session_start/end` | info |

`notable only` filters to the attn/warn rows. Clicking any row inspects that
session. The feed starts empty on server start — it seeks to the end of each
transcript rather than replaying history as if it just happened.

### Parking lot — your ideas, not Claude's tasks

There are two task systems on screen, and the distinction matters:

- **Claude's tasks** (`ready`, and the inspector's `tasks` tab) are generated by
  a session for itself, dependency-aware, and die with the plan that made them.
- **Your parked ideas** (bottom right) are durable, yours, span projects, and
  outlive every session.

Park an idea with `⌘⏎`. Ideas group by project and drag to reorder; the status
dot cycles open → doing → done.

The connective piece is **launch**: it opens a new terminal running `claude`
seeded with the idea's text, then binds it to whichever session appears. The
session id cannot be known at launch time — the process has not started yet — so
the server adopts the first session to register in that directory within five
minutes. A bound idea shows that session's live attention state and clicks
through to it; `unlink` breaks the binding, and nothing is adopted if you never
launched anything.

### Wrapping a thread up for reuse

Finished sessions are worth keeping, but only if you can *use* them again. The
`wrapped` tab lists recently finished threads as reusable material: **copy** puts
the checkpoint on your clipboard, **copy as prompt** phrases it as a handoff, and
**seed new session** opens a terminal in that directory already carrying the
context.

Two things produce a checkpoint, and they are not equally good:

| | How | Quality |
| --- | --- | --- |
| `/wrap` | You run it in a session before closing. The model has the whole conversation in context, so this costs about one cache-warm turn. | Real synthesis: *Done / In flight / Next*. |
| automatic | heddle notices a session vanish from the registry and extracts from its transcript. | Facts only: what was asked, files changed, commands run, errors hit. |

The automatic one deliberately leaves *Done* and *Next* empty. An earlier version
tried to synthesise them from turn-closing prose and produced nonsense — the
opening line of a reply is a lead-in, not a conclusion. Extraction can tell you
reliably what happened; it cannot tell you what it meant. Model-written
checkpoints are marked `wrapped`; extracted ones are marked `facts`.

`/wrap` cannot know its own session id, so it writes a file tagged with the
working directory into `~/.heddle/summaries/pending/` and heddle adopts it,
merging the synthesis over the extracted facts. Same adoption pattern as a
launched parked idea.

Past sessions that ended before heddle was watching can be summarised on demand
from the `resumable` tab.

### Ready queue

`ready` merges every task list on the machine — live sessions and ended ones —
into **in progress** / **ready to start**, answering "what do I point a session
at next". Blocked tasks collapse into a disclosure with their full per-session
DAGs.

### Naming sessions

Claude derives a name like `the-hunt-3`. Click it in the threads roster or the
inspector header to rename it (`auth refactor`, `flaky CI`). Enter commits,
Escape reverts. Each session carries a colour too, auto-assigned and overridable
from the swatches on hover.

Names live in `data/labels.json`. The AI-generated title is shown separately as
the session's subject — it's a good sentence but a bad identifier, since it
truncates to mush in a header.

### Attention routing

A Claude process goes `idle` the instant it finishes a turn and stays idle until
you type. So idle is not "done", it's **"waiting on you"**.

| State | Meaning |
| --- | --- |
| `working` | Busy right now. Leave it alone. |
| `waiting Nm` | Finished a turn and wants input. **The actionable one.** |
| `parked` | Idle more than 20 minutes. Not urgent, just open. |

The top bar counts **waiting on you** separately from **working**, and waiting
sessions get an accent stripe in the roster.

## Using it

### The three loops it is built for

**Triage — "who needs me?"**
Watch `waiting on you` in the top bar. Those sessions have finished a turn and
are sitting at a prompt doing nothing until you type. Click one in `THREADS`,
read what it ended on in the inspector, then go answer it in its terminal.
`working` sessions need nothing from you; leave them alone.

**Dispatch — "what should I start next?"**
Two halves of the same question. `ready` is what *Claude* already planned and is
unblocked. The `parking lot` is what *you* decided mattered. Launching a parked
idea hands it to a fresh session and keeps the link, so the list shows what is
in flight rather than going quiet the moment work starts.

**Catch-up — "what did I miss?"**
Select the session and read the `summary` tab. It is the session in plain
English: what you asked, what Claude said back, what it actually did, what
failed, and whether it is still working or waiting on you.

### Every interaction

| Where | Gesture | What happens |
| --- | --- | --- |
| `THREADS` | click a card | Inspect that session on the left |
| anywhere | click a session name | Rename it — `Enter` commits, `Esc` reverts |
| anywhere | hover a session name | Colour swatches appear; click one to recolour |
| inspector | `chat` / `files` / `tasks` / `agents` | Switch what you see about this session |
| inspector | `thinking` / `tools` | Show or hide reasoning and tool calls in the chat |
| `ready` | click a task | Inspect the session that owns it |
| `ready` | expand *still blocked* | See the full dependency graphs behind the queue |
| inspector | `steps` | Hide the collapsed tool lines, leaving only prose |
| `PARKING LOT` | `⌘↵` in the box | Park an idea against the selected project |
| `PARKING LOT` | click the status dot | Cycle open → doing → done |
| `PARKING LOT` | drag a row | Reorder; the stored order is the list order |
| `PARKING LOT` | `launch` | Open a new terminal running `claude` seeded with it, and bind the session that starts |
| `PARKING LOT` | click the bound session | Inspect the session running that idea |
| `PARKING LOT` | `unlink` | Break an idea's binding to its session |
| `PARKING LOT` | `done` | Show or hide completed ideas |
| `PARKING LOT` | `past prompts` → `park` | Promote anything you have ever typed |
| top bar | `pinned · unfollow` | Stop pinning a session and resume following whichever is busy |
| top bar | `☾` / `☀` | Switch theme |
| between panes | drag | Resize; proportions persist |

### Troubleshooting

**A session is missing.** Sessions register themselves at `~/.claude/sessions/<pid>.json`
on start. heddle hides any whose pid is no longer alive, so a crashed session
disappears even though its file remains. If a *running* session is missing,
confirm it is a CLI session — the Claude desktop app stores state elsewhere and
is not covered.

**Context reads higher than expected.** The window is inferred: a session under
200k tokens is measured against the 200k window because nothing in the
transcript distinguishes a 1M-context model. It errs toward warning early.

**Everything is empty.** Point `CLAUDE_DIR` at the right place, or confirm
`~/.claude` exists — it is created the first time you run Claude Code.

## Themes

Two, toggled with ☾/☀ in the top right and persisted to `localStorage`. Until
you pick one explicitly, it follows `prefers-color-scheme`; after that it stays
where you put it.

- **dark** — the default slate.
- **coffee** — steamed milk panes, espresso ink. Status colours are earth tones
  (caramel busy, sage ok, sienna blocked, brick error), so interactive state
  keeps one cool hue — teal — to stay legible against them.

Both themes are pure CSS custom properties on `:root` / `:root[data-theme]`.
Nothing hardcodes a colour, including the alpha tints used for hover, active
rows, and hairline dividers — those are tokens too (`--hover`, `--accent-soft`,
`--hairline`), since an alpha that works on slate is invisible on cream. A small
inline script in `index.html` sets the theme before first paint so the light
theme never flashes dark.

## What it reads

Everything comes from files Claude Code maintains. Nothing is instrumented and
no process is attached to.

| Source | What it gives you |
| --- | --- |
| `~/.claude/sessions/<pid>.json` | The live process list — pid, cwd, `busy`/`idle`, session name. Entries whose pid is dead are filtered out. |
| `~/.claude/projects/<slug>/<id>.jsonl` | The transcript. Tailed by byte offset, so polling is cheap regardless of file size (these reach 10MB+). |
| `.../<id>/subagents/agent-*.jsonl` | Each subagent's own transcript — the fan-out threads under a session. |
| `~/.claude/tasks/<id>/N.json` | Task lists, including `blocks` / `blockedBy` — a real dependency graph. |
| `~/.claude/jobs/<id>/` | Daemon background jobs: state, detail, token spend, timeline. |
| `~/.claude/history.jsonl` | Every prompt ever typed, with its project. |
| tool calls within a transcript | Which files a session edited or read (the `files` tab). |
| `~/.claude/ide/<pid>.lock` | Connected IDE instances. |
| `~/.heddle/summaries/` | Session checkpoints, written by `/wrap` or extracted on session end. |

The server polls every second, diffs the snapshot, and only pushes over SSE when
something actually changed. The focused transcript is tailed separately at
600ms.

Two things accumulate incrementally rather than re-reading, because transcripts
routinely pass 10MB: the **feed** keeps a byte offset per session and scans only
appended bytes, and **file activity** scans each transcript once in full (~30ms)
then only the tail. A fixed read window would silently miss every edit made
earlier in a long session — which it did, in the first version.

## Signals worth watching

- **`ctx`** — context consumed as a share of a 200k window, per session and in
  aggregate. This is the number that tells you which session is about to need a
  `/compact`.
- **⛒ / →** on tasks — what a task is blocked by and what it unblocks. Anything
  marked `ready` is unblocked and unclaimed, which is usually where you should
  point the next session.
- **Task lists from ended sessions** still appear, greyed out, under `WORK`.
  Unfinished work outlives the process that planned it.

## Writes

This tool is read-only against `~/.claude` with two exceptions, both explicit:

- Parked ideas live in `data/parking.json` and session names in
  `data/labels.json`, both owned entirely by this app. Session checkpoints live
  in `~/.heddle/summaries/`, outside the repo so they survive a re-clone. Neither is ever written
  back into `~/.claude`.
- The **launch** action opens a *new* Terminal window running `claude`, seeded
  with the parked idea's text as the initial prompt.

The per-session "+ session here" button was removed as noise — spawning a
sibling session in a directory you already have open is rarely what you want.
The capability is intact behind `POST /api/spawn` (and `spawnSession()` in
`src/api.ts`) if it turns out to be wanted again.

There is deliberately no write path into a *running* session. The daemon's
dispatch directory is undocumented and empty in practice, and there is no tmux
here to `send-keys` into, so anything else would be guesswork against a live
process. Launching a new session is the honest boundary.

## Known limits

- **macOS only** for spawning (`osascript` + Terminal.app). Everything else is
  cross-platform.
- **The Claude desktop app is not covered.** It keeps its state under
  `~/Library/Application Support/Claude`, not `~/.claude`. Only CLI sessions
  appear.
- **Context percentage infers its window.** The transcript records
  `claude-opus-5` whether or not the 1M-context variant is in use, so the model
  string cannot tell us which window applies. The only reliable signal is
  exceeding 200k — you cannot hold 275k tokens in a 200k window. A 1M session
  still under 200k is therefore measured against the small window and reads
  high, which errs toward warning early rather than late.
- **A context reading of 0 means "unknown"**, not empty: it means no assistant
  turn with usage data appeared in the slice of transcript that was read. The
  feed ignores those rather than reporting a phantom compaction.
