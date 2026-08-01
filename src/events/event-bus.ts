import { EventEmitter } from "node:events";
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
}

export const traceEvents = new TraceEventBus();
