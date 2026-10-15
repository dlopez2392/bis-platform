# The document vault's virus scanner (spec 2026-10-15 section 3.1): the official ClamAV image, its
# signatures preloaded, plus a dependency-free Node shim. clamd and freshclam run as daemons beside it.
FROM clamav/clamav:1.4

# Every directive this file owns is deleted first, then set once, so a value in the base image can never
# survive beside ours. Each name is read off the 1.4 image in plan Task 4 step 1 (assumption A13 until the
# CI scanner job proves these directive names and ownership against the real image).
# NO LIMIT IS SET BELOW 1.4's OWN DEFAULT (plan re-review N1: 1.4's clamd.conf.sample gives MaxFileSize
# 100M and MaxScanSize 400M; a limit applies to every member unpacked from an Office file, so lowering it
# would delete ordinary exports). MaxRecursion and MaxFiles keep their defaults (not set here).
#   StreamMaxLength 100M: at least 1.4's default; the shim itself refuses past 25 MiB, so this never binds.
#   MaxFileSize 400M / MaxScanSize 1000M: a 25 MiB Office upload whose XML unpacks to hundreds of MB still
#     scans in full (the CI job proves a 300 MiB expansion is clean and reports its time and peak memory,
#     A1, A15). ORCHESTRATOR RULING 2026-10-15: anything that expands past these is treated as a
#     decompression bomb: unscannable, removed, the generic note (accepted residual, deviation 16).
#   AlertExceedsMax yes: content skipped under any limit is REPORTED (Heuristics.Limits.Exceeded.*), never
#     a silent OK; the shim maps it to "unscannable" (plan review C2).
#   AlertEncrypted / AlertEncryptedArchive / AlertEncryptedDoc yes: content clamd cannot read because it is
#     encrypted is reported (Heuristics.Encrypted.*), never a silent OK; "unscannable", and the note says
#     the file has a password (owner ruling 2026-10-15).
#   ConcurrentDatabaseReload no: one signature set in memory during a reload, so 2 GB holds (deviation 12).
#   TCPSocket 3310 / TCPAddr 127.0.0.1: clamd answers the shim on loopback only, never the machine's network.
#   Foreground no: both daemonise, and start.sh runs the shim in the foreground.
#   LocalSocket / LocalSocketGroup / LocalSocketMode: DELETED, never re-set (N2, final fix round, found
#     on the real Fly machine): the base image's clamd.conf still names a unix socket
#     (`/tmp/clamd.sock`) alongside TCPSocket/TCPAddr. freshclam's NotifyClamd reads clamd.conf itself and
#     tries that socket first — "WARNING: Clamd was NOT notified: Can't connect to clamd through
#     /tmp/clamd.sock" on every successful update — so clamd never gets told to reload until its own
#     600 s SelfCheck (not data-unsafe, just stale freshness in between). With no LocalSocket line at
#     all, NotifyClamd falls back to clamd.conf's TCPSocket/TCPAddr, the one clamd actually serves.
# freshclam.conf's own TestDatabases no (final whole-branch review N1): freshclam's default (yes) loads
# every freshly-downloaded signature file into a SECOND in-memory database to self-check it before
# replacing the live one, doubling the resident signature set for that moment — the same kind of spike
# ConcurrentDatabaseReload no avoids on the clamd side, on the 2 GB worker (deviation 12).
RUN apk add --no-cache nodejs \
 && for d in StreamMaxLength MaxFileSize MaxScanSize AlertExceedsMax AlertEncrypted AlertEncryptedArchive AlertEncryptedDoc ConcurrentDatabaseReload TCPSocket TCPAddr Foreground LocalSocket LocalSocketGroup LocalSocketMode; do \
      sed -i -e "/^${d} /d" /etc/clamav/clamd.conf; \
    done \
 && printf '%s\n' 'StreamMaxLength 100M' 'MaxFileSize 400M' 'MaxScanSize 1000M' 'AlertExceedsMax yes' 'AlertEncrypted yes' 'AlertEncryptedArchive yes' 'AlertEncryptedDoc yes' 'ConcurrentDatabaseReload no' 'TCPSocket 3310' 'TCPAddr 127.0.0.1' 'Foreground no' >> /etc/clamav/clamd.conf \
 && sed -i -e '/^Foreground /d' -e '/^TestDatabases /d' /etc/clamav/freshclam.conf \
 && printf '%s\n' 'Foreground no' 'TestDatabases no' >> /etc/clamav/freshclam.conf \
 && node --version

COPY --chown=clamav:clamav src/ /app/src/
COPY --chown=clamav:clamav start.sh /app/start.sh
RUN chmod 0755 /app/start.sh

USER clamav
EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]
