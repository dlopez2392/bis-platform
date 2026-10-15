#!/bin/sh
# Signature updates and clamd as daemons, then the shim in the foreground: if the shim dies, the
# machine restarts; if clamd dies, /health answers clamd:false and the app's heartbeat goes red.
# freshclam is allowed to fail at start (a mirror refusing, a network blip): the image's preloaded
# signatures stand, and if they grow old the heartbeat says "signatures N hours old" (assumption A14:
# whether `freshclam --daemon` exits non-zero on a failed first update is read in plan Task 4 step 7
# and the CI job's log). clamd is NOT allowed to fail: set -eu stops the machine, and Fly restarts it.
# N3 (final fix round, found on the real Fly machine): a ONE-SHOT foreground `freshclam` runs BEFORE
# clamd starts reading its databases, so clamd never races a background `freshclam --daemon` update
# and comes up on signatures already days old (a fresh machine saw exactly this: clamd started reading
# at the same second freshclam began its first update, and came up on the OLD daily). Same tolerance
# as the daemon below: a failure here still leaves the image's preloaded signatures for clamd to read.
set -eu
freshclam || echo "start.sh: the one-shot freshclam update failed; clamd will read the image's preloaded signatures"
freshclam --daemon || echo "start.sh: freshclam did not start; the image's signatures stand until it does"
clamd
exec node /app/src/server.mjs
