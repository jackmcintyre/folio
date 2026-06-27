/**
 * base64 helpers for the frame-protocol codec (AD-16 / Story 1.7).
 *
 * Dependency-free and engine-portable: no Node `Buffer`, so the same codec runs
 * on Cloudflare Workers (the Relay) and Node (the Puller). The request body is
 * carried base64 inside the frame's JSON envelope; `size` on the wire is the
 * DECODED byteLen (AD-9), so these helpers are the only place transport framing
 * is added or removed.
 */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode raw bytes to a padded base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : 0;
    const b2 = i + 2 < len ? bytes[i + 2]! : 0;
    out += B64_CHARS[b0 >> 2]!;
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += i + 1 < len ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)]! : "=";
    out += i + 2 < len ? B64_CHARS[b2 & 0x3f]! : "=";
  }
  return out;
}

/** Decode a padded base64 string back to raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  // Process in 4-char groups over the ORIGINAL string (padding inclusive) so the
  // output-length calc is correct: outLen = len*3/4 - padChars.
  const len = b64.length;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const outLen = (len * 3) / 4 - pad;
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = b64charValue(b64.charAt(i), false);
    const c1 = b64charValue(b64.charAt(i + 1), false);
    const c2 = b64charValue(b64.charAt(i + 2), true);
    const c3 = b64charValue(b64.charAt(i + 3), true);
    out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 !== -1) out[p++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 !== -1) out[p++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}

/** Sextet value for a base64 char; -1 marks padding/absent (only valid in the
 *  trailing two positions, where it signals a shortened output group). */
function b64charValue(ch: string, padIsHole: boolean): number {
  if (ch === "") return padIsHole ? -1 : 0;
  if (padIsHole && ch === "=") return -1;
  return B64_CHARS.indexOf(ch);
}
