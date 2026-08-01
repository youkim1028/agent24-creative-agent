import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface YouTubeQuotaState {
  date: string;
  callsToday: number;
  blockedUntil: number;
  blockReason: string | null;
}

export interface YouTubeQuotaDecision {
  allowed: boolean;
  reason: string | null;
}

function freshState(now: number): YouTubeQuotaState {
  return {
    date: new Date(now).toISOString().slice(0, 10),
    callsToday: 0,
    blockedUntil: 0,
    blockReason: null,
  };
}

export class YouTubeQuotaLedger {
  private stateValue: YouTubeQuotaState;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly persistencePath?: string,
  ) {
    this.stateValue = freshState(this.now());
    if (!persistencePath || !existsSync(persistencePath)) return;
    try {
      const stored = JSON.parse(readFileSync(persistencePath, "utf8")) as YouTubeQuotaState;
      if (typeof stored.callsToday === "number" && typeof stored.date === "string") this.stateValue = stored;
    } catch {
      // A corrupt local counter must not leak or crash the provider. A fresh
      // in-process counter still protects the remaining run.
    }
  }

  private state(): YouTubeQuotaState {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (this.stateValue.date !== today) {
      const previous = this.stateValue;
      this.stateValue = freshState(this.now());
      if (previous.blockedUntil > this.now()) {
        this.stateValue.blockedUntil = previous.blockedUntil;
        this.stateValue.blockReason = previous.blockReason;
      }
    }
    return this.stateValue;
  }

  private persist(): void {
    if (!this.persistencePath) return;
    mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    writeFileSync(this.persistencePath, JSON.stringify(this.stateValue, null, 2), "utf8");
  }

  canCall(dailyBudget: number, stopRatio: number): YouTubeQuotaDecision {
    const state = this.state();
    if (state.blockedUntil > this.now()) return { allowed: false, reason: state.blockReason || "provider_backoff" };
    if (state.callsToday >= Math.floor(dailyBudget * stopRatio)) {
      return { allowed: false, reason: "local_daily_80_percent_stop" };
    }
    return { allowed: true, reason: null };
  }

  recordAttempt(): void {
    this.state().callsToday += 1;
    this.persist();
  }

  recordResponse(status: number, reason: string | null, headers: Headers): void {
    const state = this.state();
    const providerLimit = ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(reason || "");
    if (status === 429 || providerLimit) {
      const retryAfterSeconds = Number(headers.get("retry-after") || "");
      const untilNextUtcDay = Date.parse(`${new Date(this.now() + 86_400_000).toISOString().slice(0, 10)}T00:05:00Z`) - this.now();
      const backoff = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : Math.max(6 * 60 * 60 * 1000, untilNextUtcDay);
      state.blockedUntil = this.now() + backoff;
      state.blockReason = status === 429 ? "http_429_no_retry" : `youtube_${reason}_no_retry`;
    }
    this.persist();
  }

  snapshot(): Omit<YouTubeQuotaState, "blockedUntil"> & { blockedUntil: string | null } {
    const state = this.state();
    return {
      ...state,
      blockedUntil: state.blockedUntil > this.now() ? new Date(state.blockedUntil).toISOString() : null,
    };
  }

  clear(): void {
    this.stateValue = freshState(this.now());
    this.persist();
  }
}

export const youtubeQuotaLedger = new YouTubeQuotaLedger(
  () => Date.now(),
  process.env.NODE_ENV === "test" ? undefined : path.resolve("data", "youtube-provider-quota.json"),
);
