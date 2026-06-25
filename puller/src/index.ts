// Puller — sole filesystem writer; outbound WebSocket client to the Relay DO.
//
// Placeholder runtime: the outbound-channel / connection logic is the subject of
// later stories (Epic 2). At startup we only resolve the per-worktree dev
// configuration (Story 1.2, T3.4) so that the port + Target/dedupe paths come
// from the exported environment — never hard-coded.

import { loadDevConfig } from "./dev-config.js";

const config = loadDevConfig();

console.log(
  `[puller] dev config resolved: port=${config.port} ` +
    `target=${config.targetDir} dedupe=${config.dedupeDir}`,
);
console.log("[puller] placeholder runtime — no outbound channel wired (later story).");
