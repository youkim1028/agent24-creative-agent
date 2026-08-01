import { EventEmitter } from "node:events";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TraceEventType = "tool_call" | "tool_result" | "status" | "error";

export interface TraceEvent {
  id: string;
  timestamp: string;
  runId: string;
  type: TraceEventType;
  payload: unknown;
}

const EVENT_LIMIT = 250;

class TraceEventBus {
  private readonly emitter = new EventEmitter();
  private history: TraceEvent[] = [];
  private readonly logPath = path.resolve("data", "events.ndjson");
  private persistenceQueue: Promise<void> = Promise.resolve();

  emit(runId: string, type: TraceEventType, payload: unknown): TraceEvent {
    const event: TraceEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      runId,
      type,
      payload,
    };

    this.history.push(event);
    this.history = this.history.slice(-EVENT_LIMIT);
    this.emitter.emit("event", event);
    // Serialize writes so the rehearsal log preserves the same order as the live SSE stream.
    this.persistenceQueue = this.persistenceQueue.then(() => this.persist(event));
    return event;
  }

  subscribe(listener: (event: TraceEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  getHistory(): TraceEvent[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
  }

  private async persist(event: TraceEvent): Promise<void> {
    try {
      await mkdir(path.dirname(this.logPath), { recursive: true });
      await appendFile(this.logPath, `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      console.error("Failed to persist trace event", error);
    }
  }
}

export const traceEvents = new TraceEventBus();
