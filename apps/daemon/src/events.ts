import type { DaemonEvent } from "@tetherbox/core";

export type { DaemonEvent };

export type DaemonEventListener = (event: DaemonEvent) => void;

export class DaemonEventBus {
  readonly #listeners = new Set<DaemonEventListener>();

  subscribe(listener: DaemonEventListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: DaemonEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("daemon event listener failed", error);
      }
    }
  }
}
