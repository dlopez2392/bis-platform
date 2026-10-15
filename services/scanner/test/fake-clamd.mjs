import net from "node:net";
import { pathToFileURL } from "node:url";
import { eicar } from "./eicar.mjs";

/**
 * A stand-in for clamd's TCP protocol (zPING, zVERSION, zINSTREAM), answering by CONTENT: a stream
 * holding the EICAR string is FOUND; one holding FAKE-CLAMD-ENCRYPTED is reported as clamd reports
 * an encrypted document (Heuristics.Encrypted.PDF FOUND); one holding FAKE-CLAMD-ERROR gets clamd's
 * own error line; anything else is OK. `broken: true` answers EVERY stream with clamd's out-of-memory
 * error, so a worker-wide fault (and its failing self-test) can be tested. For the shim's tests and the e2e stack
 * (apps/web/playwright.config.ts starts it beside the real shim). NEVER in the image: the Dockerfile
 * copies src/ only and .dockerignore drops test/ (plan deviation 5).
 */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** clamd's date form, as in "ClamAV 1.4.3/27791/Wed Oct 15 08:27:02 2026" (C's ctime, in UTC). */
export const ctime = (d) => `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${
  [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((x) => String(x).padStart(2, "0")).join(":")} ${d.getUTCFullYear()}`;

export function startFakeClamd(port = 0, host = "127.0.0.1", { broken = false } = {}) {
  const needle = Buffer.from(eicar());
  const answer = (all) => {
    if (broken) return "Can't allocate memory ERROR\0";
    if (all.includes(needle)) return "stream: Eicar-Test-Signature FOUND\0";
    if (all.includes(Buffer.from("FAKE-CLAMD-ENCRYPTED"))) return "stream: Heuristics.Encrypted.PDF FOUND\0";
    if (all.includes(Buffer.from("FAKE-CLAMD-ERROR"))) return "INSTREAM size limit exceeded. ERROR\0";
    return "stream: OK\0";
  };
  // Every TCP connection counted, so a test can prove a refused file was never even handed to clamd
  // (fix round item 2: a declared-length refusal must never open a stream).
  let connections = 0;
  const server = net.createServer((socket) => {
    connections++;
    let buf = Buffer.alloc(0);
    let cmd = null;
    const chunks = [];
    socket.on("error", () => {});
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (cmd === null) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        cmd = buf.subarray(0, end).toString("utf8");
        buf = buf.subarray(end + 1);
        if (cmd === "zPING") { socket.end("PONG\0"); return; }
        if (cmd === "zVERSION") { socket.end(`ClamAV 1.4.3/27000/${ctime(new Date())}\0`); return; }
        if (cmd !== "zINSTREAM") { socket.end("UNKNOWN COMMAND\0"); return; }
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          socket.end(answer(Buffer.concat(chunks)));
          buf = Buffer.alloc(0);
          return;
        }
        if (buf.length < 4 + len) return;
        chunks.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    port: server.address().port,
    get connections() { return connections; },
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFakeClamd(Number(process.argv[2] ?? 3399)).then(({ port }) => console.log(`fake clamd listening on ${port}`));
}
