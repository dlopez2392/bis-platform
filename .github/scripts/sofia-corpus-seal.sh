#!/usr/bin/env bash
# Seal Sofía's corpus transcripts for a PUBLIC artifact (sofia-corpus.yml).
#
#   sofia-corpus-seal.sh <source-dir> <upload-dir> <name> <recipient-cert> <sha256-fingerprint>
#
# This repository is public, so anyone signed in to GitHub can download what a
# workflow uploads. The transcripts are archived (tar, gzip) and encrypted to
# ONE certificate (openssl cms, AES-256-CBC, DER); only the private key on the
# owner's machine opens the result (docs/runbooks/sofia-corpus.md).
#
# The certificate must have exactly the SHA-256 fingerprint passed as the
# fifth argument (the workflow passes a literal, pinned by test), so a swapped
# .pem, even one with the same CN, is refused instead of sealed to.
#
# After encrypting, it checks that <upload-dir> holds exactly the one sealed
# file and that the file is CMS enveloped data. If that check or any other
# step after encryption fails, an EXIT trap DELETES the sealed file, so a
# refusal always leaves <upload-dir> without it; the workflow, in addition,
# uploads only when this step succeeded.
#
# It refuses, writing nothing: a pin that is not a SHA-256 fingerprint, a
# recipient whose fingerprint is not the pin, a recipient file holding a
# private key (the key must never be in the repository), a recipient that is
# not a certificate, a missing or empty source, an upload directory that
# already holds anything or sits inside the source, and a name that is not
# sofia-corpus-<run>-<attempt>.
#
# It prints counts and the file name only, never a transcript line.
# Tested for real in apps/web/ci/sofia-corpus-seal.test.ts.
set -euo pipefail

fail() { echo "sofia-corpus-seal: $*" >&2; exit 1; }
# A fingerprint as bare upper-case hex: "3a:6A:…" and "3A6A…" compare equal.
hex() { tr -d ':' | tr '[:lower:]' '[:upper:]'; }

[ "$#" -eq 5 ] || fail "usage: sofia-corpus-seal.sh <source-dir> <upload-dir> <name> <recipient-cert> <sha256-fingerprint>"
src=$1
out=$2
name=$3
cert=$4
pin=$(printf '%s' "$5" | hex)

[[ "$name" =~ ^sofia-corpus-[0-9]+-[0-9]+$ ]] || fail "the name must be sofia-corpus-<run id>-<attempt>"
[[ "$pin" =~ ^[0-9A-F]{64}$ ]] || fail "the pinned fingerprint must be a SHA-256 fingerprint (64 hex digits)"

[ -f "$cert" ] || fail "no recipient certificate at $cert"
if grep -q "PRIVATE KEY" "$cert"; then
  fail "the recipient file holds a private key; only the public certificate belongs in the repository"
fi
openssl x509 -in "$cert" -noout 2>/dev/null || fail "the recipient file is not an X.509 certificate"
actual=$(openssl x509 -in "$cert" -noout -fingerprint -sha256 | sed 's/^[^=]*=//' | hex)
[ "$actual" = "$pin" ] || fail "the recipient certificate's SHA-256 fingerprint is not the pinned one; refusing to seal to an unknown certificate"

[ -d "$src" ] || fail "nothing to seal: $src does not exist"
files=$(find "$src" -type f | wc -l | tr -d ' ')
[ "$files" -gt 0 ] || fail "nothing to seal: $src holds no files"

src_abs=$(cd "$src" && pwd -P)
mkdir -p "$out"
out_abs=$(cd "$out" && pwd -P)
case "$out_abs/" in
  "$src_abs"/*) fail "the upload directory must not be inside the source" ;;
esac
[ -z "$(ls -A "$out")" ] || fail "the upload directory is not empty; refusing to put the sealed file beside anything else"

work=$(mktemp -d)
sealed="$out/$name.cms"
# From here to the success line, ANY exit removes the sealed file as well as
# the work folder, so a refused seal never leaves a file at the upload path.
trap 'rm -rf "$work"; rm -f "$sealed"' EXIT
tar czf "$work/$name.tar.gz" -C "$(dirname "$src_abs")" "$(basename "$src_abs")"
openssl cms -encrypt -binary -aes256 -outform DER \
  -in "$work/$name.tar.gz" -out "$sealed" "$cert"

# The upload directory holds the one sealed file and nothing else...
entries=$(ls -A "$out")
[ "$entries" = "$name.cms" ] || fail "the upload directory holds something besides $name.cms"
# ...and it is enveloped (encrypted) CMS, not an archive anyone could open.
openssl cms -cmsout -inform DER -in "$sealed" -noout -print 2>/dev/null \
  | grep -q "pkcs7-envelopedData" || fail "$name.cms is not CMS enveloped data"
if tar tzf "$sealed" >/dev/null 2>&1; then
  fail "$name.cms opens as a plain archive"
fi

bytes=$(wc -c < "$sealed" | tr -d ' ')
# Every check passed: keep the sealed file from here on.
trap 'rm -rf "$work"' EXIT
echo "sealed $files files into $name.cms ($bytes bytes)"
