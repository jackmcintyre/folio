// Puller — sole filesystem writer; outbound WebSocket client to the relay.
//
// On startup we resolve the per-worktree dev config (port + Target/dedupe dirs,
// Story 1.2) and the outbound channel config (relay URL + hop bearer, Story 2.1)
// from the exported environment — never hard-coded — then dial out and hold the
// line. The channel is a CLIENT: it opens no inbound listener, so the home
// server stays pull-only (AC1). Status transitions are logged so an operator
// can see liveness before a Filing is attempted (AC3).
//
// The write/dedupe paths are wired in later stories; here the channel runs and
// prints status, with inbound frames logged (the response-consuming write path
// attaches in a later story).

import { loadDevConfig } from "./dev-config.js";
import { createChannel, loadChannelEnv } from "./channel/index.js";

function main(): void {
  const config = loadDevConfig();
  const channelCfg = loadChannelEnv();

  console.log(
    `[puller] dev config resolved: port=${config.port} ` +
      `target=${config.targetDir} dedupe=${config.dedupeDir}`,
  );
  console.log(`[puller] dialing out to ${channelCfg.relayUrl} (pull-only)`);

  const channel = createChannel(channelCfg, {
    onStatus: (status) => console.log(`[puller] channel: ${status}`),
    onFrame: (frame) => console.log(`[puller] inbound frame: type=${frame.type}`),
  });
  channel.start();

  // Graceful teardown on dev-process signals (the dev.sh EXIT trap kills us
  // too; this closes the link cleanly first).
  const stop = (sig: string): void => {
    console.log(`[puller] ${sig} received — stopping channel`);
    channel.stop();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

main();
