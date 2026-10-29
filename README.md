# agy-insights

**English** · [Español](README.es.md)

Shows which context you are sending to **Antigravity** repeatedly or needlessly, based on the history Antigravity CLI keeps on your machine. You decide what to do about it.

- Runs only on your machine and sends nothing anywhere.
- Changes nothing: it tells you what to paste and where, and you do it if you want.
- Only proposes official Antigravity mechanisms.
- Works with any editor, on Windows, macOS and Linux.

```sh
npx agy-insights@latest         # HTML report in the browser
npx agy-insights@latest --text  # summary in the terminal
```

All you need is Node.js 20 or later and to have used Antigravity CLI (`agy`) on this machine. The output is in English or Spanish, following your system language; force it with `--lang en` or `--lang es`.

## Why

Every file the agent reads and every command output enters the context and is resent on the following turns of the conversation. Quota is a shared pool, so every unnecessary read spends it for everyone. This tool shows you where that context goes: re-reads, build folders, huge test outputs and sessions that run too long.

## Requirements

- **Node.js 20 or later** (`node --version`).
- Having used **Antigravity CLI** (`agy`) on this machine. The history lives in `~/.gemini/antigravity-cli/conversations` (on Windows, `%USERPROFILE%\.gemini\antigravity-cli\conversations`).

## Install

It has no dependencies. Pick one:

**With `npx`, nothing to install:**

```sh
npx agy-insights
npx agy-insights@latest --text
```

`@latest` makes npx check for the newest version every time. Without it, a copy installed globally (`npm install -g`) or in the current project takes precedence and is never updated. To pin a version instead: `npx agy-insights@0.7.3`.

**Globally:**

```sh
npm install -g agy-insights
agy-insights
```

To update it: `npm install -g agy-insights@latest`.

**From the repository:**

```sh
git clone https://github.com/migohe14/agy-insights.git
```

Then run it with `node agy-insights/agy-insights.js` instead of `npx agy-insights@latest`. To update: `git pull` inside the folder.

## Usage

```sh
npx agy-insights
```

Analyzes your whole history (every conversation agy has kept, with no date limit), saves an HTML report in the temp folder and opens it in the browser. In the report you can switch between the whole history and the last 90, 30 or 7 days: totals, chart, findings and tables all follow the selected period.

| To… | Run |
|---|---|
| See only one project | `npx agy-insights@latest --project C:\dev\my-project` |
| See the project in the current folder | `npx agy-insights@latest --project .` |
| Get a summary in the terminal | `npx agy-insights@latest --text` |
| Get the summary with paths and exclusions | `npx agy-insights@latest --text --paths` |
| Get a project map to paste into `AGENTS.md` (folders, large files, generated folders; ~20 lines even for a large repo) | `npx agy-insights@latest --map --project <folder>` |
| Only a custom period (the report then has no period selector) | `npx agy-insights@latest --since 2026-10-01` or `--days 14` |
| Choose the language (English or Spanish) | `npx agy-insights@latest --lang es` |
| Save the report somewhere else | `npx agy-insights@latest --out report.html --no-open` |
| See all options | `npx agy-insights@latest --help` |

The report gives two figures:

- **Real usage**: the tokens Antigravity records in each conversation's log (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`), subagents included. It is shown with and without cache, because it is unknown whether the quota counts cache the same way. This is the figure to compare between teammates.
- **"~tokens"**: estimated from the stored size of each step. Useful to compare which files, folders or commands weigh the most, but they fall short of real usage, because every model call resends the accumulated context.

## Reading the report

At the top, the period selector and the totals. Then a chart of **token usage per day** (per week when the history spans more than ~4 months), to see how usage evolves; hover a column for its figures, or open "View as table". Next, **Models and effort**: calls and real tokens per model and effort level (for example Gemini 3.8 Flash · High), including tokens per call, so you can see what a higher effort costs. Below, **What's happening** lists the findings; at the end, the details by project, file type, folder, file, tool and command. The project of each file is detected through its `.git` folder.

| Finding | What it means | What to do |
|---|---|---|
| The agent re-reads what it already had | It reads again a chunk of a file that was already in the conversation | Shorter sessions, one per task, or `/compact`. Don't exclude the file: the agent needs it. |
| Generated, build or dependency files are being read | Reads from `bin/`, `obj/`, `dist/`, `node_modules`, migrations, lockfiles or logs (Antigravity's own files in `~/.gemini`, such as its brain, never count; nor does a `build/` or `bin/` folder that git keeps in the repo, like a webpack config) | If they weren't needed, exclude them (see below) |
| The same files enter many sessions | A file is read in several different conversations | Normal for core code; if it is large, tell the agent which part to look at |
| Commands with very long output | The full output of tests or builds enters the context | Ask it to run only the affected test or project |
| Very long sessions | Everything accumulated is resent on every turn | A new conversation per task |

## Excluding something

Expand **How to exclude it** on a proposal. You'll see the exact file, where the text goes and a **Copy** button. There are three options, from strongest to weakest:

### 1. Deny reading it (Antigravity permission)

This is the only thing that actually stops the agent from reading a path. It uses the [official permissions](https://antigravity.google/docs/permissions).

1. Open `~/.gemini/antigravity-cli/settings.json` (on Windows, `%USERPROFILE%\.gemini\antigravity-cli\settings.json`).
2. Paste the rule inside `"permissions"` → `"deny"`. Create them if they don't exist; if they do, add the rule without removing anything:

   ```json
   {
     "model": "Gemini 3.8 Flash (Medium)",
     "permissions": {
       "deny": [
         "read_file(C:\\dev\\my-project\\src\\Infra\\obj)"
       ]
     }
   }
   ```

3. Save and restart `agy`.

Denying reads on a path also blocks writing to it, and the rule applies to all your projects. Use it for folders the agent should never touch, such as build output.

### 2. `.antigravityignore`

Antigravity's exclusion file, at the project root. Its effect is undocumented: it is confirmed to hide files from `@` completion, but not to stop the agent from reading them.

### 3. A rule in `AGENTS.md`

A line in the project's `AGENTS.md` asking the model not to read something or to limit an output. It is an instruction, not a block. Rules are sent with every request and cost tokens too, so keep them short. `AGENTS.md` usually lives in the team repository: review the change before pushing it.

## Configuration

Copy `agy-insights.example.json` to `~/.agy-insights.json` (or pass it with `--config`) and adjust it. It is your personal configuration:

| Key | What it does | Default |
|---|---|---|
| `lang` | Output language: `en` or `es` (`--lang` takes precedence) | the system's |
| `conversationsDir` | Another history folder | Antigravity CLI's |
| `customKinds` | Your own file types: `{ "regex": "label" }` | none |
| `crossSessionMin` | From how many conversations a repeated file is reported | 3 |
| `heavyOutputTokens` | From what average size a command is reported | 2000 |
| `longSessionTokens` | From what size a session is reported as long | 100000 |

## Privacy

- Everything is computed on your machine; nothing is sent.
- The history is read from a temporary copy and never modified.
- It does not write to `~/.gemini`, installs no hooks or plugins, and does not touch your `.gitignore` or your projects.
- The only thing it writes is the HTML report, in the temp folder or wherever `--out` says.
- The report contains paths from your projects. Review it before sharing.
- **Don't share the history `.db` files**: they contain the code the agent read.

## Undo

- **Permission**: remove the `read_file(…)` line from `"deny"` in `settings.json` and restart `agy`.
- **.antigravityignore and AGENTS.md**: remove the lines you added.

## Troubleshooting

**"No conversations"**. If you used `--project`, you may have worked with Antigravity from another folder: try without `--project`. If they still don't show up, check that the history folder exists.

**"The history format is not recognized"**. A new Antigravity version has probably changed how it stores conversations. Run `npx agy-insights@latest`; if it persists, [open an issue](https://github.com/migohe14/agy-insights/issues).

**I use the Antigravity app or IDE, not the CLI**. For now only the CLI history is read.

**Many calls under model "unknown"**. agy recorded no model for them. Run `npx agy-insights@latest --debug-models` and paste the output into an [issue](https://github.com/migohe14/agy-insights/issues): it only has counts and model names.

**The browser doesn't open**. The report path is printed in the terminal; open it manually.

## Status

Pilot version. Antigravity's history format is undocumented, so some data may break with new versions. If you see something odd, [open an issue](https://github.com/migohe14/agy-insights/issues). To contribute, see [docs/how-it-works.md](docs/how-it-works.md).

## License

[MIT](LICENSE)
