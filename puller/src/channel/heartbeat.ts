/**
 * heartbeat — ping/pong liveness for the outbound channel (Story 2.1 AC2 /
 * NFR-2).
 *
 * The puller sends a protocol-level Ping frame to the relay on a fixed cadence
 * and expects a Pong back within a bounded window. If the Pong for a Ping does
 * not arrive within `timeoutMs`, the link is declared dead and `onMiss` fires
 * exactly once — the connection layer then terminates the socket and reconnects
 * (AC3). A missed heartbeat is therefore detected within `timeoutMs` of the ping
 * that went unanswered, a bounded interval (AC2).
 *
 * Timer injection: the connection layer passes a `TimerSource` (defaults to the
 * real Node timers). Tests drive the cadence and the miss window with fake
 * timers WITHOUT standing up a real socket, so the bound is provable in
 * isolation — the place a timing bug (double-fire, never-fire, fire-after-stop)
 * would hide is this loop, not the network.
 */

/** Opaque handle returned by a TimerSource (matches Node's timer handles). */
export type TimerHandle = ReturnType<typeof setTimeout>;

/** Indirection over the global timers so the heartbeat loop is unit-testable. */
export interface TimerSource {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

/** The real Node timers (the production TimerSource). */
export const realTimers: TimerSource = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

/**
 * Ping/pong heartbeat. `sendPing` is the channel's hook to emit a WS Ping; the
 * connection layer calls `notePong()` when it receives the matching Pong. One
 * `Heartbeat` owns one connection's liveness; call `stop()` on drop.
 */
export class Heartbeat {
  private intervalHandle?: TimerHandle;
  private missHandle?: TimerHandle;
  private readonly timers: TimerSource;

  constructor(
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
    private readonly sendPing: () => void,
    timers?: TimerSource,
  ) {
    this.timers = timers ?? realTimers;
  }

  /**
   * Start the cadence. Sends the first Ping immediately, then every `intervalMs`.
   * If the Pong for a Ping is not received within `timeoutMs`, `onMiss` fires.
   * Starting an already-running heartbeat re-arms it cleanly (idempotent).
   */
  start(onMiss: () => void): void {
    this.stop();
    this.fire(onMiss); // first ping at once — liveness is checked from T0
    this.intervalHandle = this.timers.setInterval(() => this.fire(onMiss), this.intervalMs);
  }

  /** Called by the connection layer on each inbound Pong. */
  notePong(): void {
    if (this.missHandle !== undefined) {
      this.timers.clearTimeout(this.missHandle);
      this.missHandle = undefined;
    }
  }

  /** Stop the cadence and clear any pending miss timer (idempotent). */
  stop(): void {
    if (this.intervalHandle !== undefined) {
      this.timers.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.missHandle !== undefined) {
      this.timers.clearTimeout(this.missHandle);
      this.missHandle = undefined;
    }
  }

  /** Send one Ping and arm the miss window for its Pong. */
  private fire(onMiss: () => void): void {
    this.sendPing();
    if (this.missHandle !== undefined) this.timers.clearTimeout(this.missHandle);
    this.missHandle = this.timers.setTimeout(() => {
      this.missHandle = undefined;
      onMiss();
    }, this.timeoutMs);
  }
}
