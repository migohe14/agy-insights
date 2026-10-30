---
name: agy-insights
description: Measures the user's real Antigravity token usage from the local history (CLI, editor and VS Code extension) and finds context sent repeatedly or needlessly - re-reads, generated or build files, huge command outputs, sessions that run too long. Use when the user asks where their tokens or quota go, why usage is high, which files or folders the agent should stop reading, or wants a short project map for AGENTS.md.
license: MIT
---

# agy-insights

Analyzes the history Antigravity keeps on this machine and reports where the context goes. It runs locally, sends nothing anywhere and modifies nothing: it only reads the history (from a temporary copy).

## Run it

The CLI is `scripts/agy-insights.js`, relative to this skill's folder. Resolve it to an absolute path and run it with Node.js 20 or later:

```sh
node <skill folder>/scripts/agy-insights.js --text --lang en
```

- `--lang en` or `--lang es`: always pass the language the user is writing in.
- `--project <folder>`: only conversations that touched that project. Use the workspace path when the question is about the current project.
- `--paths`: adds file paths and the exact exclusion rules to propose. Use it when the user wants to know what to exclude; leave it out otherwise.
- `--session <id>`: only one conversation (the 8-character id the report shows next to its title), with its input per model call, how much of it is Antigravity's base per call versus what the conversation piled up, and what entered its context. Use it when the user asks why a conversation cost so much; you don't need to read the history files yourself.
- `--days <n>` or `--since <YYYY-MM-DD>`: only a recent period.
- `--map --project <folder>`: prints a ~20-line project map (folders, large files, generated folders) to paste into `AGENTS.md`.
- Without `--text`, it writes an HTML report and opens it in the browser. Offer this when the user wants charts or to browse the details.
- `--help` lists every option.

Run it once per question, with the options it needs; every run adds its output to the context.

The history lives outside the workspace, so Antigravity runs the command outside its sandbox and asks the user for permission the first time.

## Report back

The output is meant for you, not to be pasted whole: everything you repeat enters the context again. Summarize it:

1. Real usage (from Antigravity's own logs) and the sessions that use the most. The "~tokens" figures are estimates: use them to compare files, folders and commands, not as usage.
2. The findings, most costly first, each with its proposed action.
3. Offer `--paths` or the HTML report if the user wants the details.

## Applying a proposal

Only when the user asks, and after showing the exact change and getting their confirmation:

- **Deny reading a path** (the only real block):
  - Antigravity CLI: add the `read_file(<path>)` rule to `permissions.deny` in `~/.gemini/antigravity-cli/settings.json` (on Windows, `%USERPROFILE%\.gemini\antigravity-cli\settings.json`), creating the keys if missing and removing nothing. It takes effect after restarting `agy`. Denying reads also blocks writes, in every project.
  - Antigravity IDE, app or editor extension: there is no file to edit. Tell the user to add the rule as a deny rule in **Settings → Permission Grants**.
- **`.antigravityignore`** at the project root: hides files from `@` completion; it is not confirmed to stop reads.
- **A line in `AGENTS.md`**: an instruction, not a block, and it is sent with every request. Keep it short; the file usually lives in the team's repository, so the user should review it before pushing.

Never propose excluding anything under `~/.gemini` or Antigravity's editor extensions (Antigravity needs those files), nor files the agent re-reads in a session: those are needed, and the fix is shorter sessions or `/compact`.
