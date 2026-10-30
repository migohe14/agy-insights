# How it works

For whoever maintains or extends agy-insights.

## Principles

Every change must respect them:

1. **Read-only.** Nothing is written to `~/.gemini` or to the developer's projects. The history is copied to a temp folder before opening it, because `agy` keeps those databases open. The only thing written is the report.
2. **The developer decides.** The tool proposes text to paste; it never applies it.
3. **Only official Antigravity mechanisms** for exclusions: permissions (`read_file` in `permissions.deny`), `.antigravityignore` and rules in `AGENTS.md`. No hooks, plugins, `.gitignore` or `.ignore`.
4. **Fail visibly.** If the history format changes, the report must say so instead of showing wrong data.
5. **Nothing to install.** Only Node 20 or later; SQLite ships in `vendor/`.

## Layout

```
agy-insights.js       command: options, configuration, writes the report and opens the browser
lib/history.js        reads the history and aggregates reads, commands, projects and sessions
lib/findings.js       turns the analysis into findings (the 5 detectors)
lib/fixes.js          builds the text of each exclusion; writes nothing
lib/map.js            project map for AGENTS.md (--map); writes nothing
lib/i18n.js           every user-facing message, in English and Spanish, and language detection
lib/report.js         HTML report (static, copy buttons only) and text summary
vendor/sql.js/        SQLite in WebAssembly (version in VERSION, MIT license in LICENSE)
test/fake-history.js  generates fake histories in the same format as real ones
test/*.test.js        tests (node --test)
```

## The Antigravity CLI history

It is undocumented; this is what has been observed in `agy` 1.4.x.

- One SQLite database per conversation: `~/.gemini/antigravity-cli/conversations/<uuid>.db`, in WAL mode. The editor and the VS Code extension keep the same layout under `~/.gemini/antigravity/` (`conversations/`, `brain/`, `conversation_summaries.db`); both folders are read by default. The editor's summaries also list CLI conversations, sometimes with only a preview, so the first folder's titles win. Conversations stored there as `.pb` files are not read.
- Table `steps`: one row per step. `step_payload` is a protobuf message. Tool calls store the name (`view_file`, `run_command`, `grep_search`…) followed by their JSON arguments, for example `{"AbsolutePath":"C:\\dev\\...\\X.cs","StartLine":301,"EndLine":380}`, preceded by a `call_NNN` id.
- Each call takes two steps with the same id: the model response that requests it (`step_type` 15) and the result (`step_type` 132), which repeats name and arguments and adds the file content or command output. `lib/history.js` counts the call once per id and adds the size of both steps, which approximates what entered the context.
- Table `gen_metadata`: one row per model call, in the same order as the transcript's `PLANNER_RESPONSE` lines. Each row holds the model's display name with the effort level in brackets (`Gemini 3.8 Flash (High)`) and its id (`gemini-3.8-flash-high`). `modelOf()` takes the model and effort from whole strings only, so prose in the system prompt that mentions a model is ignored, and the n-th row is matched to the n-th call to get tokens per model and effort. That pairing is only trusted when the counts match. Otherwise each call takes the model selected in the transcript (`USER_INPUT` lines carry "changed setting `Model Selection` from X to Y"), or the conversation's only model; what is left is "unknown". `modelKey()` merges the two spellings (`Gemini 3.8 Flash` / `gemini-3.8-flash`, `High` / `high`). `--debug-models` prints, per conversation, how many calls got their model from each source: counts only, safe to paste into an issue.
- Next to the history, `../brain/<id>/.system_generated/logs/transcript.jsonl`: one JSON line per step. `PLANNER_RESPONSE` lines are model calls and carry `input_tokens`, `cache_read_tokens` and `output_tokens`; failed steps have `status: "ERROR"`. Subagents have their own conversation and transcript. `realUsage()` in `lib/history.js` adds those figures up (it only reads the file). The total printed by `agy -p --output-format json` does not include subagents; this one does. Some logs (seen with the VS Code plugin) have `PLANNER_RESPONSE` lines without any token field; those are not counted as 0 tokens. The same figures are also in each `gen_metadata` row, at protobuf field 1 › 4 (2 = input, 3 = output, 5 = cache read; the model's display name is at 1 › 21). When the transcript has no counts, or there is no transcript, `usageFromMeta()` takes real usage from there, keeping the day and selected model of the transcript's n-th call when there is one.

Each `transcript.jsonl` line also has `created_at` (ISO time). A conversation is dated by the first and last of those; without a transcript, by the `.db` file's last write. `--since` / `--days` keep a conversation when its last activity falls inside the period, and skip the rest before opening them. `../conversation_summaries.db` has one row per conversation: its short `title` (or `preview` in older ones) names each session in the report instead of its id; `last_modified_time` is not used. If the file is missing, sessions are shown by id. Each model call's `created_at` also puts its tokens on a local day (`r.daily`), which feeds the usage chart.

The HTML report holds one view per period (whole history, last 90 and 30 days, this week since Monday): `agy-insights.js` runs `analyze()` and `findings()` once per period and `report.htmlViews()` renders them all, so switching in the browser needs no analysis code in the page and every number agrees with its period. The chart is inline SVG; its color (`--series`) is checked for contrast, chroma and lightness against both surfaces.

`lib/history.js` does not depend on a protobuf schema. It walks the message, collects every string, and treats as a tool call any JSON preceded (within 3 strings) by a `snake_case` name. That way it survives minor format changes. If there are more than 50 steps and no recognized call, it sets `formatUnrecognized` and the report warns about it.

### SQLite

- With Node 22.13 or later, `node:sqlite` is used, which also reads the `-wal` file.
- With earlier versions, `sql.js` from `vendor/` is used. It doesn't read the `-wal`, so the last steps of an open conversation may be missing.

To update `sql.js`: copy `dist/sql-wasm.js`, `dist/sql-wasm.wasm` and `LICENSE` from the new version of the npm package and update `VERSION`.

### Projects

The project of each file is detected by walking up its path until a folder with `.git` is found, if the path exists on the machine. With `--project`, that folder is used directly. Windows paths (`C:\...`) are normalized to `/` internally and returned with `\` in exclusions, because `agy` matches permission paths literally.

## Languages

All user-facing text lives in `lib/i18n.js`, in an `en` and an `es` table with the same keys (a test checks it). Modules read it through `t`, which always points at the current language. The language comes from `--lang`, then the `lang` config key, then the system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`, `LANGUAGE`, or `Intl`): Spanish if it starts with `es`, English otherwise. Numbers follow it too (`en-US` / `es-ES`).

Folder names alone are not enough for build output: `build/webpack/` or `bin/` often hold sources. When the file's repo is on this machine, `repoFiles()` asks git for the files it does not ignore (`git ls-files --cached --others --exclude-standard`, once per repo), and a file in that list is never kind `build`. `--map` does the same, since it lists files through git. Without git, or for a repo that is not on this machine, the folder name decides.

Anything under `~/.gemini/` is kind `agent`: the agent's own brain (plans, artifacts, its logs) and skills. It is checked first and is not in `NON_SOURCE`, so those reads are never reported as generated files or proposed for exclusion, even when a path contains `out/` or ends in `.log`.

Built-in file kinds are stable ids (`build`, `logs`, `generated`, `code .cs`…) and are only turned into text when shown, with `kindLabel()`. Kinds from `customKinds` are shown as the user wrote them.

To add a message, add it to both tables. To add a language, add a table and teach `detect()` to pick it.

## Adding a file type

In `lib/history.js`, function `kind()`, returning a new id and its label in both tables of `lib/i18n.js`. If it is a type that rarely needs to be read, also add it to `NON_SOURCE`, and its `.antigravityignore` patterns to `KIND_PATTERNS` in `lib/findings.js`. Each developer can add their own types without touching the code with `customKinds` in their configuration.

## Adding a detector

In `lib/findings.js`. A finding is `{ id, level: 'info' | 'warn', title, why, suggestion, tokens, items }`, and each `item` is `{ label, tokens, detail, fixes }`. `fixes` are built with `lib/fixes.js`. Never propose excluding source code: the agent needs it.

Add a case to `test/fake-history.js` and a test.

## Tests

```sh
npm test
```

They cover the analysis with a fake history, the five detectors, the rule format, that excluding source code is never proposed, that the history is not changed, project detection through `.git`, the unknown-format warning, HTML escaping, the project map and the full command. CI runs them on Linux, Windows and macOS with Node 20 (sql.js) and Node 22 (node:sqlite).

To generate a sample history and try the report by hand:

```sh
node test/fake-history.js test/tmp/history
node agy-insights.js --dir test/tmp/history
```

## npm package

`package.json` defines the command (`bin`) and which files go into the package (`files`: the command, `lib/`, `vendor/`, `docs/` and the sample configuration; not the tests). It is published on the public npm registry as `agy-insights`. The package only contains the tool; the histories it analyzes stay on each user's machine.

- **Try the package locally**: `npm pack`, then `npx --yes --package=./agy-insights-<version>.tgz agy-insights --help`.
- **From the repository**, unpublished: `npx --yes github:migohe14/agy-insights`. With no dependencies and no build step, npm installs it straight from git.
- **Release a version**: see [Releasing](#releasing). npm is published by hand; `npm publish` runs the tests first (`prepublishOnly`).

## Antigravity plugin

The repository is also an Antigravity plugin: `.antigravity-plugin/plugin.json` is its manifest, the repository root is the plugin root, and `skills/agy-insights/` is its only component. The skill's `scripts/agy-insights.js` just loads the root `agy-insights.js`, so the plugin always runs the same code as the npm package. `assets/logo.svg` is its logo.

The plugin is installed from GitHub (`agy plugin install https://github.com/migohe14/agy-insights`), not from npm, and agy always takes `main`: it has no way to pin a tag. So **`main` is always the latest release**: work and open pull requests on branches, and don't push unreleased changes to `main`.

## Releasing

npm and the plugin are released together, with the same version:

```sh
git switch main && git merge <branch>   # the changes to release
agy plugin validate --strict .          # the plugin must pass with no warnings
npm version minor                       # or patch / major: bumps package.json and plugin.json, commits, tags v…
npm publish                             # runs the tests, then publishes to npm
git push --follow-tags                  # main (the plugin) and the tag
```

Publish to npm before pushing: if `npm publish` fails, `main` hasn't moved yet and the plugin doesn't get ahead of npm. A test fails if the two versions differ, and on the tag push `.github/workflows/release-check.yml` checks that the tag and both versions match and runs the tests on GitHub.

## To do

- Confirm with `agy` that a `read_file` `deny` rule blocks the read.
- Confirm that a deny rule added under Settings → Permission Grants blocks the read in the VS Code extension. Antigravity's own guide (`~/.gemini/antigravity/builtin/skills/antigravity_guide/references/app.md`) documents Permission Grants for the IDE and the app; `~/.gemini/antigravity/` has no `settings.json`, so `fixes.deny()` proposes the CLI's file only for paths the CLI read, and the Settings rule for paths the editor read (from each file's `origins`).
- Image reads are estimated from the image's pixel size (`imageTokens()`: 258 tokens up to 384×384 px, else 258 per 768 px tile, as Gemini documents), read from the file's header; when the file can't be read, as 4 tiles.
- Test with real histories from several developers (Windows and macOS).
- Also read the history of the Antigravity app and IDE, if they use the same format.
