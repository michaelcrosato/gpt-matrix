# GPT Hub

A local experiment workbench for running a prompt across Codex and Claude Code models, reasoning efforts, and arbitrary variables. The supplied game prompt is already imported, including all five testing constraints.

## Start

Requires Node.js 22.13 or newer and the CLIs you want to use on your PATH.

```sh
git clone https://github.com/michaelcrosato/gpt-matrix.git
cd gpt-matrix
npm install
npm run build
npm start
```

Open **http://localhost:4310**. Development mode is `npm run dev` and uses the same address. The server listens on loopback only. Keep the server running; closing the browser does not stop the queue. Windows can access the WSL localhost address. No hosted deployment or public tunnel is needed.

Sign in with `codex login` and/or `claude auth login` in your terminal. The app uses those CLI accounts and their existing configuration, hooks, instructions, tools, and limits. It does not store API keys or call a model API directly.

Optional environment variables:

| Variable        | Default                  | Purpose                            |
| --------------- | ------------------------ | ---------------------------------- |
| `PORT`          | `4310`                   | Workbench port                     |
| `ARTIFACT_PORT` | `PORT + 1`               | Separate origin for generated HTML |
| `HUB_DATA_DIR`  | `./data` in this project | SQLite, prompts, logs, outputs     |

## Run a study

1. Choose **New experiment**. Your provided prompt is preloaded. Edit it or import a `.txt`/`.md` file.
2. Choose a model from the dropdown, then select each reasoning effort to test. The list shows every choice without clearing a search field. Codex choices come from its local model cache; Claude has versioned Sonnet 5.5, Opus 5.5, Haiku 5.5, and Fable 5.1 choices, verified against [Claude's model catalog](https://platform.claude.com/docs/en/models/overview) and [CLI effort support](https://code.claude.com/docs/en/model-config#adjust-effort-level) on October 20, 2026. Choose **Enter a custom model ID…** for another model. Existing CLI aliases are explicitly labeled when loading old setups. Account availability is determined by the CLI.
3. Enter **Source game 1** or another option's **Prompt text** directly. That is the value sent to the agent, and it also names the option unless you explicitly enable a different display label. Empty selected values are rejected. **Paste a list** accepts one option per line, bulleted lists, spreadsheet columns, and comma-separated source names. It previews the parsed options and lets you **Replace** the current list (including the Doom default) or **Add** to it without duplicate values. Apply or clear a pasted list before saving. Use `label | prompt text` when a shorter display label is useful. Variable names and template keys live under **Variable settings**; extra axes use `{{UPPERCASE_KEYS}}`. Options for axes absent from the template are appended as additional instructions.
4. Choose repetitions, timeout, and run ordering. Inspect the complete matrix count and the rendered first prompt. The preview lists up to 80 combinations; the queue saves all of them, up to 5,000 per study.
5. Save a draft or start the queue. Eight simultaneous sessions is the default; change the shared limit in **Runners & settings**. Every run starts a fresh CLI session in its own folder.
6. Open a completed run's HTML. Save a human verdict, quality score, verified stack, notes, and issue checklist. Record “Clear” only when you checked; leave other issues “Not checked.”
7. Use **Patterns & tradeoffs** to compare models, efforts, testing constraints, requested/chosen stacks, prompt versions, or any custom axis. Inspect linked feedback, then **Duplicate & edit** an experiment for the next iteration.

**Pause queue** stops new starts; active sessions finish. **Stop all** terminates active process groups and cancels waiting runs. **Queue another attempt** makes a new run linked to its original, retaining the original prompt, output, review, time, and cost. If the experiment is paused/completed, resume it to start retries. No automatic retries consume additional usage. Account or usage-limit errors pause the remaining queue.

On **Experiments**, each card has **Cancel N queued**, and the page has **Cancel all N queued**. These controls affect only attempts still waiting when the server receives the request; active runs continue and completed results remain available. Cancelled attempts are retained in the run library. A draft whose attempts have all been cancelled is shown as Cancelled.

**Local rehearsal** is a deterministic fixture runner for learning the workflow without calling a model. Its outputs are labeled, its token usage is unknown, and its runs are excluded from analysis by default. Select it in the model runner field.

## Measurement and interpretation

- Each attempt stores its exact submitted prompt and SHA-256, the base prompt version, all option labels/text, requested model and effort, command arguments, repetition, session ID when available, and timestamps. CLI-reported resolved models appear separately when reported.
- Codex JSON events provide input, cached input, output, and any reported reasoning tokens. Claude's separate cache-read and cache-write input buckets are normalized into total input. Cache counts are included in input, not added again when showing total tokens. Raw logs remain available.
- Session time is wall time from process launch to exit. A successful CLI exit is an execution result, **not** proof of a good game. Human pass/fail is separate.
- Final usage is collected **after the agent exits**. The runner re-reads the terminal usage events and, for Codex, the matching session trace. It writes `hub-run-metrics.json`, adds final metrics to `hub-report.json`, stamps an HTML metadata comment and JSON block, and fills the game's About/Credits usage placeholder. No extra model call is made. Untouched originals remain in `runs/<id>/original-artifacts/`. Repeated finalization replaces totals rather than adding them again; manually edited output files are preserved and flagged. **Refresh final totals** repeats this local pass. Older finished runs are backfilled at startup.
- Missing usage remains unknown. Claude can report an API-equivalent cost even on a subscription; that is not an invoice. Published standard API token rates for GPT-6.1 Sol and GPT-6 Astra are included, verified October 20, 2026 with source links in settings. Custom per-model prices override them; rates are snapshotted for each run. These estimates account for cached input, cache writes, and each request's context tier, and exclude tool fees, service-tier and regional adjustments. An aggregate session token count is never treated as one long-context request. If request-level evidence is needed but unavailable, cost stays unknown. No model-generated cost guesses are used.
- Testing tool calls are identified by command keywords. Testing time is the union of their observed intervals, so overlapping calls are counted once. It excludes model thinking and may misclassify commands. It is shown as inferred; a manual run-level testing-time entry overrides it. Phase-specific token usage is not invented.
- Human checklist time measures your checking effort; fix time measures your recorded repair effort. These are separate from agent testing time. Issue frequency uses only “Clear” and “Found” observations. A zero count includes a 95% upper bound under independent-trial assumptions; it never means “impossible.”
- Averages exclude unknown measurements and show coverage. Total cost/time per human pass includes all started attempts, including retries and failures, and is only displayed when all those attempts have a human verdict and the relevant measurement. An unfinished attempt is not silently assigned zero time.
- Grouping is descriptive, not a causal estimate. Keep source games, repetitions, and other variables controlled before attributing a difference to model, effort, or testing policy.
- A structured report request can be enabled per experiment. It asks the agent to write `hub-report.json` with actual stack, art direction, animation, testing performed, engine feedback, prompt feedback, and issue tags. The added instruction is visible in each submitted prompt. Human corrections override agent feedback for analysis; unverified agent tags remain separate from human issue counts.

## Files and recovery

```text
data/
  hub.sqlite                 # experiments, run records, reviews, templates, settings
  runs/<run-id>/
    prompt.txt               # exact submitted prompt
    execution.json           # command, permissions, environment, price snapshot
    stdout.jsonl             # raw provider event stream
    stderr.log
    events.jsonl             # normalized activity with timestamps
    final-response.txt
    usage-evidence.json      # final token records, per-request evidence, price source
    finalization.json        # finalization status and original/published hashes
    original-artifacts/      # untouched outputs before metrics were stamped
    workspace/               # agent's development files and deliverables
      hub-report.json        # optional agent-written metadata
      hub-run-metrics.json   # authoritative runner measurements after exit
```

The database uses SQLite WAL. Stop the server before copying the entire data directory for a simple consistent backup. CSV exports are for analysis; JSON exports include configurations, prompts, reviews, and feedback. Artifact files are downloaded from the run page or copied from the data directory. Exports alone are not a complete artifact backup. Keep the original prompt in `prompts/original.txt` for reference.

One server owns a data directory at a time. On restart, incomplete runs are checked against actual process identity (PID, start time, and working directory on Linux). A live process is shown as orphaned and consumes a concurrency slot. Its experiment is paused and it is never silently replayed. Once the old process is stopped, the run becomes interrupted and can be retried. An interrupted process without a captured exit is never presented as successfully complete. Existing terminal records and completed reviews persist across restarts.

The dashboard and generated games use different origins. Generated HTML can run its scripts and use CDN dependencies without receiving dashboard write access. Download and preview paths reject traversal and escaping symlinks. This separation protects the dashboard; it is not an OS sandbox for an agent. Codex workspace mode uses its workspace sandbox with network access; Claude standard mode explicitly allows coding tools including Bash. Unrestricted mode disables the CLI's permission checks and may access the whole machine. Choose the mode appropriate to your development environment.

## Verification

```sh
npm test
npm run build
```

The automated tests cover matrix expansion, validation, usage/cost normalization, overlapping testing intervals, human review denominators, CSV safety, real child-process scheduling, pause/resume, stop/retry, persistence, path protection, and cross-origin writes. Test data uses temporary directories, not the workbench's real data.

Full browser flow (on this machine's installed Playwright):

```sh
PORT=4320 ARTIFACT_PORT=4321 HUB_DATA_DIR=/tmp/gpt-hub-qa npm run dev
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 /usr/bin/python3 scripts/browser-check.py
```

It creates labeled rehearsal studies in the QA directory and verifies matrix creation, process completion, interactive artifacts, saved reviews after reload, exact prompts, logs, and analysis in Chromium, WebKit, and Firefox. Screenshots go to `/tmp/gpt-hub-browser-qa`. WebKit is an automated approximation of Safari; it is not real iOS Safari.

`scripts/controls-check.py` tests the model dropdown, exact source substitution, bulk replace/add, unapplied-paste guard, and card/global queued cancellation in Chromium, WebKit, Firefox, and an iPhone profile. Run it against a separate QA server with `HUB_QA_URL`; it saves and cancels test drafts without starting a model. Screenshots go to `/tmp/gpt-hub-controls-check`.

Provider integration references: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude Code programmatic mode](https://code.claude.com/docs/en/headless). The installed CLIs' `--help` is authoritative for the flags used by this adapter.
