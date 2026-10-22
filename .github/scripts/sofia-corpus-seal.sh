#!/usr/bin/env bash
# Seal Sofía's corpus transcripts for a PUBLIC artifact (sofia-corpus.yml).
#
#   sofia-corpus-seal.sh <source-dir> <upload-dir> <name> <recipient-cert>
#
# This repository is public, so anyone signed in to GitHub can download what a
# workflow uploads. The transcripts are archived (tar, gzip) and encrypted to
# ONE certificate (openssl cms, AES-256, DER); only the private key on the
# owner's machine opens the result (docs/runbooks/sofia-corpus.md). The script
# then refuses to finish unless <upload-dir> holds exactly that one file and it
# is CMS enveloped data, so the workflow's upload step can never pick up the
# plaintext folder, the plain archive, or anything else left beside them.
#
# It refuses, writing nothing: a recipient file holding a private key (the key
# must never be in the repository), a recipient that is not a certificate, a
# missing or empty source, an upload directory that already holds anything or
# sits inside the source, and a name that is not sofia-corpus-<run>-<attempt>.
#
# It prints counts and the file name only, never a transcript line.
# Tested for real in apps/web/ci/sofia-corpus-seal.test.ts.
set -euo pipefail

fail() { echo "sofia-corpus-seal: $*" >&2; exit 1; }

[ "$#" -eq 4 ] || fail "usage: sofia-corpus-seal.sh <source-dir> <upload-dir> <name> <recipient-cert>"
src=$1
out=$2
name=$3
cert=$4

[[ "$name" =~ ^sofia-corpus-[0-9]+-[0-9]+$ ]] || fail "the name must be sofia-corpus-<run id>-<attempt>"

[ -f "$cert" ] || fail "no recipient certificate at $cert"
if grep -q "PRIVATE KEY" "$cert"; then
  fail "the recipient file holds a private key; only the public certificate belongs in the repository"
fi
openssl x509 -in "$cert" -noout 2>/dev/null || fail "the recipient file is not an X.509 certificate"

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
trap 'rm -rf "$work"' EXIT
tar czf "$work/$name.tar.gz" -C "$(dirname "$src_abs")" "$(basename "$src_abs")"
openssl cms -encrypt -binary -aes256 -outform DER \
  -in "$work/$name.tar.gz" -out "$out/$name.cms" "$cert"

# The upload directory holds the one sealed file and nothing else...
entries=$(ls -A "$out")
[ "$entries" = "$name.cms" ] || fail "the upload directory holds something besides $name.cms"
# ...and it is enveloped (encrypted) CMS, not an archive anyone could open.
openssl cms -cmsout -inform DER -in "$out/$name.cms" -noout -print 2>/dev/null \
  | grep -q "pkcs7-envelopedData" || fail "$name.cms is not CMS enveloped data"
if tar tzf "$out/$name.cms" >/dev/null 2>&1; then
  fail "$name.cms opens as a plain archive"
fi

bytes=$(wc -c < "$out/$name.cms" | tr -d ' ')
echo "sealed $files files into $name.cms ($bytes bytes)"
