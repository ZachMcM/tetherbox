interface ListenerSet {
  subscribe(listener: () => void): () => void;
  emit(): void;
}

export function createListenerSet(): ListenerSet {
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    emit() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
