---
description: Write a reusable checkpoint of this session (for heddle)
---

Write a checkpoint of THIS conversation so it can be reused later — quoted into a
future prompt, or used to seed a new session.

Use the Done / Currently working on / Next steps shape:

- **done** — what was completed and verified this session. Concrete outcomes, not
  narration of what you did step by step.
- **current** — the one thing in flight, naming the specific files, functions or
  components involved. Empty string if nothing is mid-flight.
- **next** — the ordered remaining work.

Write for someone with no memory of this conversation. One line per bullet, no
markdown formatting inside the strings.

Then save it as JSON to `~/.heddle/summaries/pending/<current-unix-ms>.json`,
creating the directory if needed:

```json
{
  "cwd": "<absolute path of your current working directory>",
  "title": "<short title, at most 60 characters>",
  "done": ["..."],
  "current": "...",
  "next": ["..."]
}
```

Nothing else in the file. Then confirm the path you wrote, in one line.
