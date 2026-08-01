import type { ImageProvider } from "./contracts.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type MeteredProvider = Extract<ImageProvider, "pexels" | "unsplash">;

interface QuotaState {
  date: string;
  callsToday: number;
  providerLimit: number | null;
  providerRemaining: number | null;
  resetAt: string | null;
  blockedUntil: number;
  blockReason: string | null;
}

export interface QuotaDecision {
  allowed: boolean;
  reason: string | null;
}

const EMPTY = (): QuotaState => ({
  date: new Date().toISOString().slice(0, 10),
  callsToday: 0,
  providerLimit: null,
  providerRemaining: null,
  resetAt: null,
  blockedUntil: 0,
  blockReason: null,
});

export class ImageQuotaLedger {
  private readonly states = new Map<MeteredProvider, QuotaState>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly persistencePath?: string,
  ) {
    if (!persistencePath || !existsSync(persistencePath)) return;
    try {
      const stored = JSON.parse(readFileSync(persistencePath, "utf8")) as Partial<Record<MeteredProvider, QuotaState>>;
      for (const provider of ["pexels", "unsplash"] as const) {
        const state = stored[provider];
        if (state && typeof state.callsToday === "number" && typeof state.date === "string") this.states.set(provider, state);
      }
    } catch {
      // A corrupt local safety ledger fails closed only for persistence, not the run.
      // Provider headers and the fresh in-process counters still apply.
    }
  }

  private persist(): void {
    if (!this.persistencePath) return;
    mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    writeFileSync(this.persistencePath, JSON.stringify(Object.fromEntries(this.states), null, 2), "utf8");
  }

  private state(provider: MeteredProvider): QuotaState {
    const date = new Date(this.now()).toISOString().slice(0, 10);
    const current = this.states.get(provider);
    if (!current || current.date !== date) {
      const fresh = {
        ...EMPTY(),
        date,
        blockedUntil: current && current.blockedUntil > this.now() ? current.blockedUntil : 0,
        blockReason: current && current.blockedUntil > this.now() ? current.blockReason : null,
      };
      this.states.set(provider, fresh);
      return fresh;
    }
    return current;
  }

  canCall(provider: MeteredProvider, dailyBudget: number, stopRatio: number): QuotaDecision {
    const state = this.state(provider);
    if (state.blockedUntil > this.now()) return { allowed: false, reason: state.blockReason || "provider_backoff" };
    if (state.callsToday >= Math.floor(dailyBudget * stopRatio)) return { allowed: false, reason: "local_daily_80_percent_stop" };
    if (state.providerLimit && state.providerRemaining !== null) {
      const usedRatio = 1 - state.providerRemaining / state.providerLimit;
      if (usedRatio >= stopRatio) return { allowed: false, reason: "provider_80_percent_stop" };
    }
    return { allowed: true, reason: null };
  }

  recordAttempt(provider: MeteredProvider): void {
    this.state(provider).callsToday += 1;
    this.persist();
  }

  recordResponse(provider: MeteredProvider, status: number, headers: Headers): void {
    const state = this.state(provider);
    const limitHeader = headers.get("x-ratelimit-limit");
    const remainingHeader = headers.get("x-ratelimit-remaining");
    const limit = limitHeader === null ? Number.NaN : Number(limitHeader);
    const remaining = remainingHeader === null ? Number.NaN : Number(remainingHeader);
    if (Number.isFinite(limit) && limit > 0) state.providerLimit = limit;
    if (Number.isFinite(remaining) && remaining >= 0) state.providerRemaining = remaining;
    const reset = headers.get("x-ratelimit-reset");
    if (reset) state.resetAt = /^\d+$/.test(reset) ? new Date(Number(reset) * 1000).toISOString() : reset;
    if (status === 429) {
      const retryAfterSeconds = Number(headers.get("retry-after") || "");
      const fallback = 6 * 60 * 60 * 1000;
      state.blockedUntil = this.now() + (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : fallback);
      state.blockReason = "http_429_long_backoff";
    }
    this.persist();
  }

  snapshot(): Record<MeteredProvider, Omit<QuotaState, "blockedUntil"> & { blockedUntil: string | null }> {
    const convert = (provider: MeteredProvider) => {
      const state = this.state(provider);
      return { ...state, blockedUntil: state.blockedUntil > this.now() ? new Date(state.blockedUntil).toISOString() : null };
    };
    return { pexels: convert("pexels"), unsplash: convert("unsplash") };
  }

  clear(): void {
    this.states.clear();
    this.persist();
  }
}

export const imageQuotaLedger = new ImageQuotaLedger(
  () => Date.now(),
  process.env.NODE_ENV === "test" ? undefined : path.resolve("data", "image-provider-quota.json"),
);
