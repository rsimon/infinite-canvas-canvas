import type { Selection } from "./types";

let current: Selection = null;

type Listener = (selection: Selection) => void;
const listeners = new Set<Listener>();

export function getSelection(): Selection {
  return current;
}

export function select(selection: Selection): void {
  current = selection;
  notify();
}

export function clearSelection(): void {
  if (current === null) return;
  current = null;
  notify();
}

export function subscribeSelection(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn(current);
}
