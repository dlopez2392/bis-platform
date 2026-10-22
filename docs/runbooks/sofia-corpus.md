# Sofía's corpus, run from GitHub (`sofia-corpus.yml`)

Plays Sofía's S-47b test corpus, or the Realtime text-only spike, on a GitHub
runner with the repository's `OPENAI_API_KEY` secret, so nobody has to hold
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
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=both
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=events -f only=7
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=insurance-pc -f phone_engine=chat
gh workflow run sofia-corpus.yml --ref main -f step=corpus -f module=both -f repeat=1
```

| Input | Values | Default |
|---|---|---|
| `step` | `spike` (does gpt-realtime answer a text-only session) or `corpus` | `spike` (the cheaper one) |
| `module` | `both`, `insurance-pc`, `events` | `both` |
| `phone_engine` | `realtime` (phone items on gpt-realtime, text only) or `chat` (phone items on gpt-4o) | `realtime` |
| `only` | one item number, `7` or `07`; empty plays every item | empty |
| `repeat` | 1 or 3: plays each item that many times; 3 writes NN-…-r1.md to -r3.md and a sheet with one column per run | 3 |

The run uses the code's default Realtime model (`gpt-realtime`,
`apps/web/src/lib/voice/session-config.ts`). If production's Vercel
`REALTIME_MODEL` names a different model, this run does not play the model
that live calls use. Note that on the results sheet.

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

- **spike**: one JSON line per variant, `{variant, ok, why, seen, text}`.
  `ok: true` on either variant means the Realtime engine works text-only.
  `why` names an OpenAI error by its code, type and param only.
- **corpus**: `== insurance-pc ==`, then `ok   NN-….md` or `FAIL NN-….md:
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
  when there is no key, and that its error line (`realtime-spike-why.ts`)
  never carries an error's message, `toString` or JSON form.
- `apps/web/src/lib/voice/modules/corpus-lib.test.ts` pins that an `only`
  matching no item stops the runner non-zero. It also pins that a throw while
  handling a Realtime event fails that one item, by the error's class only,
  and the run goes on.
