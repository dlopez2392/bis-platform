#!/bin/sh
# Signature updates and clamd as daemons, then the shim in the foreground: if the shim dies, the
# machine restarts; if clamd dies, /health answers clamd:false and the app's heartbeat goes red.
# freshclam is allowed to fail at start (a mirror refusing, a network blip): the image's preloaded
# signatures stand, and if they grow old the heartbeat says "signatures N hours old" (assumption A14:
# whether `freshclam --daemon` exits non-zero on a failed first update is read in plan Task 4 step 7
# and the CI job's log). clamd is NOT allowed to fail: set -eu stops the machine, and Fly restarts it.
set -eu
freshclam --daemon || echo "start.sh: freshclam did not start; the image's signatures stand until it does"
clamd
exec node /app/src/server.mjs
