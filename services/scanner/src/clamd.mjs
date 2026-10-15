import net from "node:net";
import { once } from "node:events";

/** clamd's TCP protocol (clamd(8)): z-prefixed commands, NUL-terminated replies; INSTREAM takes length-prefixed chunks and a zero length to end. */
const CHUNK = 64 * 1024;

function connect({ host, port }, signal) {
  const socket = net.connect({ host, port });
  const abort = () => socket.destroy(new Error("clamd: timed out"));
  signal?.addEventListener("abort", abort, { once: true });
  socket.once("close", () => signal?.removeEventListener("abort", abort));
  return socket;
}

function replyOf(socket) {
  const reply = new Promise((resolve, reject) => {
    let acc = "";
    socket.on("data", (d) => {
      acc += d.toString("utf8");
      const end = acc.indexOf("\0");
      if (end >= 0) resolve(acc.slice(0, end));
    });
    socket.on("end", () => resolve(acc));
    socket.on("error", reject);
  });
  reply.catch(() => {}); // awaited by the caller; never an unhandled rejection meanwhile
  return reply;
}

export async function command(clamd, name, timeoutMs = 5000) {
  const socket = connect(clamd, AbortSignal.timeout(timeoutMs));
  const reply = replyOf(socket);
  try {
    await once(socket, "connect");
    socket.write(`z${name}\0`);
    return (await reply).trim();
  } finally {
    socket.destroy();
  }
}

/** Streams `body` (an async iterable of bytes) to clamd and answers its reply. Throws past `maxBytes`. */
export async function instream(clamd, body, { maxBytes, signal }) {
  const socket = connect(clamd, signal);
  const reply = replyOf(socket);
  try {
    await once(socket, "connect");
    socket.write("zINSTREAM\0");
    let total = 0;
    for await (const piece of body) {
      const buf = Buffer.from(piece);
      total += buf.length;
      if (total > maxBytes) throw new Error("too large");
      for (let at = 0; at < buf.length; at += CHUNK) {
        const part = buf.subarray(at, at + CHUNK);
        const head = Buffer.alloc(4);
        head.writeUInt32BE(part.length, 0);
        if (!socket.write(Buffer.concat([head, part]))) await once(socket, "drain");
      }
    }
    socket.write(Buffer.alloc(4));
    return (await reply).trim();
  } finally {
    socket.destroy();
  }
}
