/** 微型可观察快照 store（无外部依赖；W1 若需要 selector 再评估共享 store 引擎）。 */
export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T): void
}

export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: T): void {
      if (next === snapshot) return
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}
