export type GenerationRefreshResult<T> =
  | { committed: true; value: T }
  | { committed: false };

export async function refreshLatestGeneration<T>(
  attempt: () => Promise<GenerationRefreshResult<T>>,
  maxAttempts = 5,
): Promise<T | null> {
  for (let index = 0; index < maxAttempts; index += 1) {
    const result = await attempt();
    if (result.committed) {
      return result.value;
    }
  }

  return null;
}

type QueueState<T> = {
  requested: number;
  promise: Promise<T>;
};

export function createRefreshCoalescer<T>(refresh: (key: string) => Promise<T>) {
  const queued = new Map<string, QueueState<T>>();

  return (key: string): Promise<T> => {
    const existing = queued.get(key);
    if (existing) {
      existing.requested += 1;
      return existing.promise;
    }

    const state = {} as QueueState<T>;
    state.requested = 1;
    state.promise = (async () => {
      let handled = 0;
      let result!: T;

      do {
        const target = state.requested;
        result = await refresh(key);
        handled = target;
      } while (handled < state.requested);

      return result;
    })().finally(() => {
      if (queued.get(key) === state) {
        queued.delete(key);
      }
    });

    queued.set(key, state);
    return state.promise;
  };
}
