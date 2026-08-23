const listeners = new Set<() => void>()

export function subscribeProjectControlChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyProjectControlChanged(): void {
  for (const listener of [...listeners]) listener()
}
