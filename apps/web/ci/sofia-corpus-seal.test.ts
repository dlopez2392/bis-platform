import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .github/scripts/sofia-corpus-seal.sh is the ONLY thing between Sofía's corpus
// transcripts and a public artifact. The repository is public, so any signed-in
// GitHub user can download what sofia-corpus.yml uploads; the transcripts are
// therefore sealed to the owner's certificate (openssl cms, AES-256) and the
// script refuses to finish unless the upload directory holds exactly that one
// sealed file. These cases run the script for real, through bash and openssl,
// with a throwaway key pair made in a temp directory, so the round trip is
// proven with a key the test can hold. Nothing here touches the network.

const SCRIPT = fileURLToPath(new URL("../../../.github/scripts/sofia-corpus-seal.sh", import.meta.url)).replace(/\\/g, "/");
const COMMITTED_CERT = fileURLToPath(new URL("../../../.github/sofia-corpus-recipient.pem", import.meta.url));
const WORKFLOW = fileURLToPath(new URL("../../../.github/workflows/sofia-corpus.yml", import.meta.url));
/**
 * The committed certificate's SHA-256 fingerprint. The seal refuses any other
 * certificate, so a PR that swaps the .pem (even for one with the same CN)
 * cannot redirect the transcripts without also changing this line.
 */
const COMMITTED_PIN = "3A:6A:8F:8F:74:82:B0:F0:F0:B3:6E:12:ED:98:6F:95:C6:16:BC:D5:AC:76:78:9E:3F:5A:63:4E:32:61:7C:05";

// Real bash, openssl and tar several times per case; Windows starts them slowly.
vi.setConfig({ testTimeout: 60_000 });

/** Git for Windows' bash (never WSL's launcher), or plain bash elsewhere. No bash is a FAILURE. */
function bashExecutable(): string {
  if (process.platform !== "win32") return "bash";
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const candidates = [
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).map((b) => path.join(b!, "Git")),
    path.resolve(execPath, "..", "..", ".."),
  ].map((r) => path.join(r, "usr", "bin", "bash.exe"));
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`No Git for Windows bash found (looked at: ${candidates.join(", ")})`);
  return found;
}

let bash = "";
let root = "";
let key = "";
let cert = "";

/** A path as bash on this OS reads it. */
const p = (s: string) => s.replace(/\\/g, "/");

/**
 * Git for Windows rewrites an argument like `/CN=x` into a Windows path unless
 * told not to (Linux ignores both names). Only the key-pair call needs that
 * off: the script itself RELIES on the rewrite on Windows, because the native
 * openssl there cannot read a `/tmp/...` path.
 */
const noPathConversion = { ...process.env, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" };

function sh(script: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(bash, ["-c", script], { cwd: root, env, encoding: "utf8" });
}

/** The throwaway certificate's SHA-256 fingerprint, the pin every throwaway seal passes unless a case says otherwise. */
let certPin = "";

function seal(src: string, out: string, name: string, recipient: string, pin = certPin) {
  return spawnSync(bash, [SCRIPT, p(src), p(out), name, p(recipient), pin], { cwd: root, encoding: "utf8" });
}

/** `openssl x509 -fingerprint -sha256`'s value, as openssl prints it (colon-separated, upper case). */
function fingerprintOf(file: string): string {
  const r = sh(`openssl x509 -in '${p(file)}' -noout -fingerprint -sha256`);
  if (r.status !== 0) throw new Error(`no fingerprint for ${file}: ${r.stderr}`);
  return r.stdout.trim().replace(/^[^=]*=/, "");
}

/** A self-signed certificate (and its key) made in a temp folder, with the given CN. */
function makeCert(dir: string, cn: string): { key: string; cert: string } {
  fs.mkdirSync(dir, { recursive: true });
  const k = path.join(dir, "key.pem");
  const c = path.join(dir, "cert.pem");
  const made = sh(`openssl req -x509 -newkey rsa:2048 -nodes -keyout '${p(k)}' -out '${p(c)}' -subj '/CN=${cn}' -days 1`, noPathConversion);
  if (made.status !== 0) throw new Error(`could not make a certificate: ${made.stderr}`);
  return { key: k, cert: c };
}

/** A fresh case directory with a corpus-shaped source folder. */
function corpusCase(id: string): { src: string; out: string } {
  const dir = path.join(root, id);
  const src = path.join(dir, ".sofia-corpus");
  fs.mkdirSync(path.join(src, "events", "2026-10-22T10-00-00-000Z"), { recursive: true });
  fs.mkdirSync(path.join(src, "insurance-pc", "2026-10-22T10-05-00-000Z"), { recursive: true });
  fs.writeFileSync(path.join(src, "events", "2026-10-22T10-00-00-000Z", "01-en-is-14th-free.md"), "caller: is the 14th free?\nsofia: Let me take a message.\n");
  fs.writeFileSync(path.join(src, "insurance-pc", "2026-10-22T10-05-00-000Z", "results-sheet.md"), "# ungraded\n| 01 | | |\n");
  return { src, out: path.join(dir, "upload") };
}

/** Every file under a directory, relative, with its bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full).replace(/\\/g, "/")] = fs.readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

beforeAll(() => {
  bash = bashExecutable();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sofia-seal-"));
  key = path.join(root, "throwaway-key.pem");
  cert = path.join(root, "throwaway-cert.pem");
  const made = sh(`openssl req -x509 -newkey rsa:2048 -nodes -keyout '${p(key)}' -out '${p(cert)}' -subj '/CN=sofia-seal-test' -days 1`, noPathConversion);
  if (made.status !== 0) throw new Error(`could not make a throwaway key pair: ${made.stderr}`);
  certPin = fingerprintOf(cert);
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("sofia-corpus-seal.sh seals the corpus to one certificate and leaves nothing else to upload", () => {
  it("round-trips: the one .cms opens with the matching private key into the same folder, byte for byte", () => {
    const { src, out } = corpusCase("roundtrip");
    const r = seal(src, out, "sofia-corpus-42-1", cert);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(out)).toEqual(["sofia-corpus-42-1.cms"]);

    const opened = path.join(root, "roundtrip", "opened");
    fs.mkdirSync(opened);
    const d = sh(`openssl cms -decrypt -binary -inform DER -inkey '${p(key)}' -in '${p(path.join(out, "sofia-corpus-42-1.cms"))}' | tar xz -C '${p(opened)}'`);
    expect(d.status, d.stderr).toBe(0);
    expect(snapshot(path.join(opened, ".sofia-corpus"))).toEqual(snapshot(src));
  });

  it("the sealed file is CMS enveloped data, not a readable archive, and holds none of the transcript text (mutation: drop -encrypt → FAILS)", () => {
    const { src, out } = corpusCase("opaque");
    expect(seal(src, out, "sofia-corpus-43-1", cert).status).toBe(0);
    const file = path.join(out, "sofia-corpus-43-1.cms");
    expect(sh(`openssl cms -cmsout -inform DER -in '${p(file)}' -noout -print`).stdout).toContain("pkcs7-envelopedData");
    expect(sh(`tar tzf '${p(file)}'`).status).not.toBe(0);
    expect(fs.readFileSync(file).includes(Buffer.from("is the 14th free"))).toBe(false);
  });

  it("encrypts the content with AES-256-CBC (mutation: -aes128 → FAILS)", () => {
    const { src, out } = corpusCase("cipher");
    expect(seal(src, out, "sofia-corpus-50-1", cert).status).toBe(0);
    const printed = sh(`openssl cms -cmsout -inform DER -in '${p(path.join(out, "sofia-corpus-50-1.cms"))}' -noout -print`).stdout;
    expect(printed).toMatch(/algorithm: aes-256-cbc \(2\.16\.840\.1\.101\.3\.4\.1\.42\)/);
  });

  it("refuses a certificate whose SHA-256 fingerprint is not the pinned one, even with the corpus's own CN, and writes nothing (a swapped certificate would seal to its owner; mutation: drop the fingerprint comparison → FAILS)", () => {
    const { src, out } = corpusCase("impostor");
    const impostor = makeCert(path.join(root, "impostor", "pair"), "bis-sofia-corpus");
    const r = seal(src, out, "sofia-corpus-51-1", impostor.cert, COMMITTED_PIN);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/fingerprint/i);
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
  });

  it("refuses a pin that is not a SHA-256 fingerprint: an empty or short pin never means 'any certificate' (mutation: skip the comparison when the pin is empty → FAILS)", () => {
    const { src, out } = corpusCase("bad-pin");
    expect(seal(src, out, "sofia-corpus-52-1", cert, "").status).not.toBe(0);
    expect(seal(src, out, "sofia-corpus-52-1", cert, certPin.slice(0, 20)).status).not.toBe(0);
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
  });

  it("leaves the upload directory EMPTY when a check after encryption fails, so the workflow can never upload a refused file (mutation: drop the EXIT trap that removes it → FAILS)", () => {
    const { src, out } = corpusCase("post-check");
    // A `tar` that claims any file is a readable archive: the script's last check must then refuse.
    const fake = path.join(root, "post-check", "fake-bin");
    fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, "tar"), '#!/usr/bin/env bash\nif [ "$1" = "tzf" ]; then exit 0; fi\nexec "$REAL_TAR" "$@"\n');
    const r = sh([
      `fake="$(command -v cygpath >/dev/null 2>&1 && cygpath -u '${p(fake)}' || printf %s '${p(fake)}')"`,
      `chmod +x "$fake/tar"`,
      `REAL_TAR="$(command -v tar)" PATH="$fake:$PATH" bash '${SCRIPT}' '${p(src)}' '${p(out)}' sofia-corpus-53-1 '${p(cert)}' '${certPin}'`,
    ].join("\n"));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("opens as a plain archive");
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it("refuses a recipient file that holds a private key, and writes nothing (mutation: drop the PRIVATE KEY check → FAILS)", () => {
    const { src, out } = corpusCase("private-key");
    const both = path.join(root, "private-key", "cert-and-key.pem");
    fs.writeFileSync(both, fs.readFileSync(cert, "utf8") + fs.readFileSync(key, "utf8"));
    const r = seal(src, out, "sofia-corpus-44-1", both);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/private key/i);
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
  });

  it("refuses a recipient file that is not a certificate", () => {
    const { src, out } = corpusCase("not-a-cert");
    const junk = path.join(root, "not-a-cert", "junk.pem");
    fs.writeFileSync(junk, "hello\n");
    expect(seal(src, out, "sofia-corpus-45-1", junk).status).not.toBe(0);
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
  });

  it("refuses a missing or empty source folder: a run that wrote nothing must not look like a sealed result", () => {
    const { out } = corpusCase("empty");
    const empty = path.join(root, "empty", "nothing-here");
    fs.mkdirSync(empty);
    expect(seal(empty, out, "sofia-corpus-46-1", cert).status).not.toBe(0);
    expect(seal(path.join(root, "empty", "absent"), out, "sofia-corpus-46-1", cert).status).not.toBe(0);
  });

  it("refuses an upload directory that already holds anything, so a plaintext file can never ride along (mutation: drop the empty-directory check → FAILS)", () => {
    const { src, out } = corpusCase("crowded");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "results-sheet.md"), "plaintext\n");
    const r = seal(src, out, "sofia-corpus-47-1", cert);
    expect(r.status).not.toBe(0);
    expect(fs.readdirSync(out)).toEqual(["results-sheet.md"]);
  });

  it("refuses an upload directory inside the source folder (the archive would swallow itself)", () => {
    const { src } = corpusCase("nested");
    const r = seal(src, path.join(src, "upload"), "sofia-corpus-48-1", cert);
    expect(r.status).not.toBe(0);
  });

  it("refuses a name that is not sofia-corpus-<run id>-<attempt>, so the artifact path stays the one the workflow test pins", () => {
    const { src, out } = corpusCase("bad-name");
    expect(seal(src, out, "../escape", cert).status).not.toBe(0);
    expect(seal(src, out, "sofia-corpus-x-1", cert).status).not.toBe(0);
  });

  it("prints counts and the file name, never a transcript line", () => {
    const { src, out } = corpusCase("quiet");
    const r = seal(src, out, "sofia-corpus-49-1", cert);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("sofia-corpus-49-1.cms");
    expect(r.stdout).toMatch(/2 files/);
    expect(r.stdout + r.stderr).not.toContain("14th");
  });
});

describe("the committed recipient is a public certificate and nothing more", () => {
  const text = fs.readFileSync(COMMITTED_CERT, "utf8");

  it("holds exactly one certificate block and no private key of any kind (mutation: append the private key → FAILS)", () => {
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(text.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(1);
    expect(text.match(/-----BEGIN [A-Z ]+-----/g)).toEqual(["-----BEGIN CERTIFICATE-----"]);
  });

  it("parses as an X.509 certificate for the corpus", () => {
    const r = sh(`openssl x509 -in '${p(COMMITTED_CERT)}' -noout -subject`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("CN=bis-sofia-corpus");
  });

  it("has exactly the pinned SHA-256 fingerprint (replacing the key pair changes this literal, visibly, in the same PR)", () => {
    expect(fingerprintOf(COMMITTED_CERT)).toBe(COMMITTED_PIN);
  });

  it("is what sofia-corpus.yml seals to, with this same pin as the script's fifth argument (mutation: change the pin in the workflow → FAILS)", () => {
    const workflow = fs.readFileSync(WORKFLOW, "utf8");
    expect(workflow).toContain(` .github/sofia-corpus-recipient.pem ${COMMITTED_PIN}\n`);
  });

  it("seals with that pin: the real certificate passes its own check", () => {
    const { src, out } = corpusCase("committed");
    const r = seal(src, out, "sofia-corpus-54-1", COMMITTED_CERT, COMMITTED_PIN);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readdirSync(out)).toEqual(["sofia-corpus-54-1.cms"]);
  });
});
