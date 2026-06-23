const interruptedRuns = new Set<string>();

export function registerRun(requestId: string) {
  interruptedRuns.delete(requestId);
}

export function interruptRun(requestId: string) {
  interruptedRuns.add(requestId);
}

export function isRunInterrupted(requestId: string) {
  return interruptedRuns.has(requestId);
}

export function clearRun(requestId: string) {
  interruptedRuns.delete(requestId);
}
