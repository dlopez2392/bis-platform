import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "../src/scan.mjs";

test("parseReply: only a reply ending in ' ERROR' is stage clamd; any other unexpected or truncated reply is transport (fix round item 3; mutation: treat every non-OK/non-FOUND reply as stage clamd -> FAILS)", () => {
  assert.deepEqual(parseReply("INSTREAM size limit exceeded. ERROR"), { verdict: "error", stage: "clamd", reason: "INSTREAM size limit exceeded. ERROR" });
  assert.deepEqual(parseReply("Can't allocate memory ERROR"), { verdict: "error", stage: "clamd", reason: "Can't allocate memory ERROR" });
  // Not clamd's own ERROR reply about this stream: a connection-level garble or a truncated read.
  // Neither ends in " ERROR", so neither may be blamed on the file; both are "transport".
  assert.deepEqual(parseReply("COMMAND READ TIMED OUT"), { verdict: "error", stage: "transport", reason: "COMMAND READ TIMED OUT" });
  assert.deepEqual(parseReply("stream: O"), { verdict: "error", stage: "transport", reason: "stream: O" });
});
