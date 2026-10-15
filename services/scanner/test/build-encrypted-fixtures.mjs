import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { cleanPdf } from "./eicar.mjs";

/**
 * I1 (final whole-branch review): writes the one clean PDF the CI `scanner` job's qpdf step then
 * encrypts three ways (owner-only RC4/AES-128, owner-only AES-256/R6, and a real user password) into
 * the directory named on argv[2]. qpdf itself runs in a throwaway `alpine` container in ci.yml — this
 * script owns only the plaintext source, so the shape of the clean PDF lives in one place (eicar.mjs's
 * own `cleanPdf`, the same bytes `clean.pdf` already proves clean in real-clamd.mjs).
 */
const dir = process.argv[2];
if (!dir) { console.error("usage: node build-encrypted-fixtures.mjs <dir>"); process.exit(2); }
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "in.pdf"), cleanPdf(2048));
console.log(`wrote ${join(dir, "in.pdf")}`);
