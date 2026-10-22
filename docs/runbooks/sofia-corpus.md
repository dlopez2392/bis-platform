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
```

| Input | Values | Default |
|---|---|---|
| `step` | `spike` (does gpt-realtime answer a text-only session) or `corpus` | `spike` (the cheaper one) |
| `module` | `both`, `insurance-pc`, `events` | `both` |
| `phone_engine` | `realtime` (phone items on gpt-realtime, text only) or `chat` (phone items on gpt-4o) | `realtime` |
| `only` | one item number, `7` or `07`; empty plays every item | empty |

The run uses the code's default Realtime model (`gpt-realtime`,
`apps/web/src/lib/voice/session-config.ts`). If production's Vercel
`REALTIME_MODEL` names a different model, this run does not play the model
that live calls use. Note that on the results sheet.

Runs queue one at a time and are never cancelled.

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
  failed. The sealed file is uploaded anyway, because a failed item's
  transcript says what happened.

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

## 6. The certificate, and replacing it

`.github/sofia-corpus-recipient.pem` is the public half: an X.509
certificate, `CN=bis-sofia-corpus`, valid until 2036-10-19, SHA-256
fingerprint `3A:6A:8F:8F:74:82:B0:F0:F0:B3:6E:12:ED:98:6F:95:C6:16:BC:D5:AC:76:78:9E:3F:5A:63:4E:32:61:7C:05`.
`apps/web/ci/sofia-corpus-seal.test.ts` fails if that file ever holds a
private key.

To replace the pair (if the key is lost or exposed), on the owner's machine,
in Git Bash:

```
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj "/CN=bis-sofia-corpus" \
  -keyout ~/.bis-corpus-key.pem -out sofia-corpus-recipient.pem
```

Then replace `.github/sofia-corpus-recipient.pem` with the new certificate
through a PR, and update the fingerprint above. Files sealed to the old
certificate open only with the old key.

## What guards this

- `apps/web/ci/ci-workflow.test.ts`, the `sofia-corpus.yml` block. It pins
  that the workflow runs only by hand and holds the key on one step. It also
  pins that the workflow carries no Supabase, Clerk or database value, passes
  inputs through env only, pins every action to a commit SHA, and uploads only
  the `.cms` file.
- `apps/web/ci/sofia-corpus-seal.test.ts` tests `.github/scripts/sofia-corpus-seal.sh`
  for real. It proves the round trip with a throwaway key pair, and that the
  script refuses each of these: a recipient file holding a private key, an
  empty source, a crowded or nested upload folder, and a wrong name.
- `apps/web/ci/realtime-spike.test.ts` pins that the spike stops with exit 2
  when there is no key, and that it never prints an error's free-text message.
