# Sofía's corpus, run from GitHub (`sofia-corpus.yml`)

Plays Sofía's S-47b test corpus, the Realtime spike, or the text model spike,
on a GitHub runner with the repository's `OPENAI_API_KEY` secret, so nobody has to hold
the key on a laptop. The run is manual only. It touches no database (every
tool is stubbed) and costs OpenAI money each time.

The repository is public, so anyone signed in to GitHub can read the run's log
and download its artifact. The log shows only `ok`/`FAIL` per item and the
counts. The transcripts are uploaded as ONE file sealed to the owner's
certificate, and only the owner's private key opens it.

Audience: danlo (dispatch, download, open, grade) and the orchestrator
(dispatch and watch).

## 1. Dispatch

GitHub only lists the workflow once `sofia-corpus.yml` is on `main`.

```
gh workflow run sofia-corpus.yml --ref main -f step=spike
gh workflow run sofia-corpus.yml --ref main -f step=spike -f realtime_model=gpt-realtime-2.1
gh workflow run sofia-corpus.yml --ref main -f step=model-spike
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=both
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=both -f realtime_model=gpt-realtime-2.1
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=events -f only=7
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=insurance-pc -f phone_engine=chat
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=both -f repeat=1
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=base
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=base -f realtime_model=gpt-realtime-2.1
```

| Input | Values | Default |
|---|---|---|
| `step` | `spike` (the Realtime model: text-only session, full config with each transcriber, spoken round trip), `corpus`, or `model-spike` (what gpt-6-luna accepts for each text task) | `spike` (the cheaper one) |
| `module` | `both` (the two trade modules: `insurance-pc`, then `events`), `insurance-pc`, `events`, or `base` (the live prompt with no trade module; section 1a) | `both` |
| `phone_engine` | `realtime` (phone items on the Realtime model, text only) or `chat` (phone items on gpt-4o) | `realtime` |
| `only` | one item number, `7` or `07`; empty plays every item | empty |
| `repeat` | 1 or 3: plays each item that many times; 3 writes NN-…-r1.md to -r3.md and a sheet with one column per run | 3 |
| `realtime_model` | `gpt-realtime` or `gpt-realtime-2.1`, for `spike` and `corpus` (a fixed choice, checked again in bash) | `gpt-realtime` |

`module`, `phone_engine`, `only` and `repeat` are read by `corpus` only.
`model-spike` reads no input: it names gpt-6-luna in its own code
(`apps/web/scripts/model-spike-lib.ts`).

`realtime_model` reaches the run as `REALTIME_MODEL`. Its default is the
code's default (`apps/web/src/lib/voice/session-config.ts`). If production's
Vercel `REALTIME_MODEL` names a different model, pick that one here, or the
run does not play the model that live calls use. The results sheet's header
names the model the run played.

### 1a. The base slice (`module=base`)

`insurance-pc` and `events` each play their trade module's rules, and both
modules are paused on every live account. `base` plays the prompt a live
call actually runs: no trade module (model switch plan G1, owner answer Q2,
2026-11-26). It is 12 phone items in
`apps/web/src/lib/voice/modules/corpus/base/`: six scenarios, each in English
(odd numbers) then Spanish (even numbers). The scenarios are leaving a
message, booking, business hours, a price question, asking for a person, and
a known caller moving their appointment.

- The business is the repository's synthetic Rio Roofing
  (`fixtures/rio-roofing.json`), bilingual, booking on for every item (a
  live profile's default). Hours and prices are in the facts text. There are
  no structured hours, no price list and no business status, so no item's
  words depend on the time the run starts.
- Item 09 (English) asks for a person on a line WITH a transfer number.
  Item 10 (Spanish) asks on a line WITHOUT one, so both live paths are played.
- Items 11 and 12 play `fixtures/rio-roofing-known-caller.json`, where one
  contact (Rosa Treviño) is on the caller's number. The live line never tells
  Sofía a caller's name. A known caller is recognised by caller ID through
  `find_my_booking`, which is the identity ladder the stub runs. So the rules
  check that she looks the appointment up first and never says a name the
  caller did not give.
- `both` still means the two trade modules. Play `base` as its own run, so
  its sheet and its grading stay separate from the modules'.

**Its pin.** A module's sheet is bound to its words by `SHA256_HISTORY`.
The base sheet is bound by `BASE_VERSION` and `BASE_SHA256_HISTORY` in
`apps/web/src/lib/voice/modules/pin.ts`. The hash covers what a base item's
session is sent, apart from the business's own data: the system prompt, the
tool list and the greeting instruction. It covers them over all 288 phone
contexts a base item can play. The prompt's date line is masked, so the hash
does not change with the day or the machine. Any change to the live phone
prompt's words (`system-prompt.ts`, its knowledge blocks, the tool
descriptions, the greeting) fails `pin.test.ts` until `BASE_VERSION` is
bumped and the new hash is APPENDED. A sheet graded on the old words keeps
its own entry.

Runs go one at a time, and a running one is never cancelled. A second
dispatch waits for the first. GitHub keeps only ONE waiting run, though: a
third dispatch made while the second is still waiting cancels the second.
That run never started, so it cost nothing. The third waits in its place.

## 2. Watch and read the log

```
gh run list --workflow sofia-corpus.yml --limit 3
gh run watch <run id>
gh run view <run id> --log
```

- **spike**: one JSON line per check, each with a `check` field. `why`
  names an OpenAI error by its code, type and param only, never its message.
  - `model`: the Realtime model the run used.
  - `text_only`, one per variant: `{variant, ok, why, events, textLength,
    nonEmpty}`. `events` counts each known event type, any other as `other`.
    The reply itself is never printed, only its length and whether it had
    text. `ok: true` on either variant means the model works text-only. The
    job's exit code follows these two lines only.
  - `session_config`, one per transcription candidate (`gpt-transcribe`,
    `gpt-live-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`): our FULL
    session config, audio block kept. `ok: true` means `session.updated`
    arrived; `echoed` is the transcriber the session reports back.
  - `speaker`, one per language: the model read a fixed English or Spanish
    sentence aloud (model audio; no person is recorded). `bytes` is the
    audio's size.
  - `round_trip`, one per candidate and language: that audio fed to a session
    on the full config with the candidate. `deltas` counts
    `conversation.item.input_audio_transcription.delta` events; `completed`
    says whether `.completed` arrived; `usage` is the usage object's type and
    key names; `transcript` is capped at 120 characters; `commit` is `vad`
    when turn detection ended the turn, `manual` when the spike had to.
    `ok: true` needs at least one delta and the completed event. A
    transcriber without both would leave calls with no caller transcript,
    and such calls are labelled spam.
- **model-spike**: a markdown summary in the log and in the run's job summary
  (the run page), printed a section at a time: the models list first, then
  each task as soon as it finishes, so a run the job kills still leaves what
  it measured. No call starts after 45 minutes (the job allows 60); a run cut
  short ends with "Stopped early at N calls". Each call waits at most 30 s,
  then shows `timeout`. For each of the five text tasks it tries V1 (today's row in
  `apps/web/src/lib/ai/tasks.ts`), V2 (`max_completion_tokens` instead of
  `max_tokens`; skipped where today's row sends no cap) and V3 (V2 plus
  `reasoning_effort` none, minimal and low). For the web chat it also tries
  the follow-up shape (`tool_choice: "none"`) on Chat Completions, and the
  first turn and the follow-up on `/v1/responses`. An accepted variant runs 5
  times, a refused one once. Each call shows its status, the error's
  code/type/param, finish reason, the three token counts, latency, and yes/no
  for empty content, JSON that parses and a tool call. It never shows a
  model's words. The models list shows what this key's project can see,
  filtered to `gpt-6*`, `gpt-realtime*`, `gpt-transcribe*` and `gpt-live*`.
  The job is red
  when a task had no accepted variant on either API. Every message is
  synthetic.
- **corpus**: `== insurance-pc ==` (or `== events ==`, `== base ==`), then `ok   NN-….md` or `FAIL NN-….md:
  <reason>` per item, then `N of M played`. The job is red when any item
  failed. The transcripts are still sealed and uploaded, because a failed
  item's transcript says what happened. The upload runs only when the seal
  step itself succeeded. If the seal refuses (a certificate that is not the
  pinned one, nothing to seal, a check after encryption that fails), it
  deletes what it wrote and nothing is uploaded. Read its one error line in
  the log.
- An `only` number that matches no item in a module (for example `26` in
  `events`) fails that module with `--only 26 selects no item in events`.
  It never counts as a green run of zero items.

## 3. Download

The artifact is named `sofia-corpus-<run id>-<attempt>`, where the attempt
is `1` unless the run was re-run. It is kept for **3 days**.

```
gh run download <run id> -n sofia-corpus-<run id>-1
```

This writes one file, `sofia-corpus-<run id>-1.cms`, into the current folder.

## 4. Open it (owner's machine only)

The private key is `C:\Users\danlo\.bis-corpus-key.pem`. It lives on the
owner's machine ONLY. It is never in the repository, never an Actions or
Vercel secret, and never pasted anywhere. Keep a backup somewhere private.
Without the key, an artifact cannot be opened. If the key is lost, see
section 6 and run the corpus again.

Open the file from `apps/web`. The archive holds `.sofia-corpus/<module>/<timestamp>/`,
which is the same gitignored folder a local run writes to.

**Git Bash:**

```
cd apps/web
openssl cms -decrypt -binary -inform DER -inkey 'C:\Users\danlo\.bis-corpus-key.pem' -in <path>/sofia-corpus-<run id>-1.cms | tar xz
```

**PowerShell.** Do not pipe here: Windows PowerShell can corrupt binary
data passed between two programs. Decrypt to a file, then unpack it with
Windows' own `tar`:

```
cd apps\web
& "C:\Program Files\Git\mingw64\bin\openssl.exe" cms -decrypt -binary -inform DER -inkey C:\Users\danlo\.bis-corpus-key.pem -in <path>\sofia-corpus-<run id>-1.cms -out $env:TEMP\sofia-corpus.tar.gz
tar -xzf $env:TEMP\sofia-corpus.tar.gz
Remove-Item $env:TEMP\sofia-corpus.tar.gz
```

Both forms were tested on 2026-10-22 against a dry run sealed with the
committed certificate. Each produced a folder identical to the original
(`diff -r`).

## 5. Grade

Every module's run folder holds one transcript per item and an ungraded
`results-sheet.md`. A person grades every rule (owner decision B5). Fill in
`docs/superpowers/results/_template-sofia-corpus.md` and commit the graded
sheet under `docs/superpowers/results/`. The transcripts themselves stay in
the gitignored `.sofia-corpus/` and are never committed.

Name a graded sheet `YYYY-MM-DD-<slug>-v<N>.md`, for example
`2026-12-04-base-v1.md`. `corpus.test.ts` reads that name and checks the
sheet's `Text SHA-256` line against `pin.ts`, for the base slice as for
the modules. For the paired model runs (model switch plan G1), both sheets
must print the same `Text SHA-256`. Two different hashes mean the two runs
played different words.

## 6. The certificate, its pin, and replacing them

`.github/sofia-corpus-recipient.pem` is the public half: an X.509
certificate, `CN=bis-sofia-corpus`, RSA 3072, valid until 2036-10-19, SHA-256
fingerprint `3A:6A:8F:8F:74:82:B0:F0:F0:B3:6E:12:ED:98:6F:95:C6:16:BC:D5:AC:76:78:9E:3F:5A:63:4E:32:61:7C:05`.

That fingerprint is PINNED. `sofia-corpus.yml` passes it to the seal script,
and the script refuses any certificate whose fingerprint differs. A
certificate swapped in by a PR therefore never receives the transcripts, even
one with the same CN. `apps/web/ci/sofia-corpus-seal.test.ts` fails if any of
these happen: the file holds a private key, the file's fingerprint stops
matching the pin, or the workflow passes a different pin.

To replace the pair (if the key is lost or exposed), on the owner's machine,
in Git Bash:

```
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=bis-sofia-corpus" \
  -keyout ~/.bis-corpus-key.pem -out sofia-corpus-recipient.pem
openssl x509 -in sofia-corpus-recipient.pem -noout -fingerprint -sha256
```

Then, in ONE PR, change all of these together, so the reviewer sees the pin
move:

1. `.github/sofia-corpus-recipient.pem`: the new certificate.
2. The fingerprint at the end of the seal step's `run:` line in
   `.github/workflows/sofia-corpus.yml`.
3. `COMMITTED_PIN` in `apps/web/ci/sofia-corpus-seal.test.ts`, and the same
   literal in the seal-step case of `apps/web/ci/ci-workflow.test.ts`.
4. The fingerprint and "valid until" above.

A PR that changes the certificate without the pin goes red. A PR that changes
the pin without a matching reason from the owner should be refused. Files
sealed to the old certificate open only with the old key.

## What guards this

- `apps/web/ci/ci-workflow.test.ts`, the `sofia-corpus.yml` block. It pins
  that the workflow runs only by hand and holds the key on one step. It also
  pins that the workflow carries no Supabase, Clerk or database value, passes
  inputs through env only, pins every action to a commit SHA, seals with the
  pinned fingerprint, and uploads only the `.cms` file, only after the seal
  step succeeded.
- `apps/web/ci/sofia-corpus-seal.test.ts` tests `.github/scripts/sofia-corpus-seal.sh`
  for real. It proves the round trip with a throwaway key pair, and AES-256-CBC
  in the sealed file. It also proves the script refuses each of these: a
  certificate that is not the pinned one (even with the same CN), a pin that
  is not a SHA-256 fingerprint, a recipient file holding a private key, an
  empty source, a crowded or nested upload folder, and a wrong name. Finally,
  it proves a check that fails after encryption leaves the upload folder
  empty.
- `apps/web/ci/realtime-spike.test.ts` pins that the spike stops with exit 2
  when there is no key or the model is not one of the choice, and that its
  error line (`realtime-spike-why.ts`) never carries an error's message,
  `toString` or JSON form. It also pins the transcription checks
  (`realtime-spike-checks.ts`): the full config keeps its audio block and
  changes only the transcriber, the transcript is capped, and an error is
  code/type/param only.
- `apps/web/ci/model-spike.test.ts` drives the model spike against a fake
  OpenAI whose every free-text path carries a sentinel. It pins the variant
  bodies, five runs for an accepted variant and one for a refused one, the
  Responses shape, the model filter, the 30-second bound on each call, the
  45-minute deadline, the section-by-section output, and that no error
  message, answer or key reaches the summary.
- The same `ci-workflow.test.ts` block runs the tool step's own bash with a
  stand-in `pnpm`: an unknown model or step and an empty key run nothing, each
  step runs its own tool on the chosen model, and `model-spike` copies its
  output to the job summary and exits with the spike's status. No case's
  output or summary carries the key, plain or base64. The job's 60 minutes are
  pinned too.
- `apps/web/src/lib/voice/modules/corpus-lib.test.ts` pins that an `only`
  matching no item stops the runner non-zero. It also pins that a throw while
  handling a Realtime event fails that one item, by the error's class only,
  and the run goes on. It pins that `base` plays no trade module: no TRADE
  RULES block in the prompt, and the no-pack identity ladder in the stub.
- `apps/web/src/lib/voice/modules/corpus.test.ts` pins every corpus's item
  list and flags. For `base` it also pins the English/Spanish order, the
  Spanish-with-usted rule on every Spanish item, which items play the
  known-caller fixture, and that the two Rio Roofing fixtures differ only in
  the caller's number and who is on it.
- `apps/web/src/lib/voice/modules/pin.test.ts` pins the base slice's hash
  (see section 1a). The same `ci-workflow.test.ts` block pins the `module`
  choice list, that `base` runs alone, and that `both` never includes it.
