import { useEffect, useRef, useState } from 'react';

export interface ReplEntry {
  input: string;
  output: string;
  isError: boolean;
}

export interface ReplHistory {
  /** Rendered output history. Cleared by `clear()`, persisted to localStorage. */
  history: ReplEntry[];
  /** Append a new entry. Also pushes the input onto the recall stack. */
  append(entry: ReplEntry): void;
  /** Clear the rendered history. Recall stack is preserved. */
  clear(): void;
  /**
   * Move one step back in the input recall stack. Pass the editor's current
   * value so it can be saved as a draft before the first step. Returns the
   * recalled input, or `null` if already at the oldest entry.
   */
  recallPrev(currentInput: string): string | null;
  /**
   * Move one step forward in the input recall stack. Returns the recalled
   * input, or the saved draft (string, possibly empty) when stepping past
   * the newest entry, or `null` if not currently recalling.
   */
  recallNext(): string | null;
  /** Reset recall position (call when the user types a new character). */
  resetRecall(): void;
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_HISTORY_ENTRIES = 200;
const MAX_INPUT_HISTORY = 500;

function entriesKey(prefix: string) {
  return `${prefix}-history`;
}
function inputsKey(prefix: string) {
  return `${prefix}-input-history`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const kept = s.slice(0, max);
  const dropped = s.length - max;
  const droppedLines =
    (s.match(/\n/g)?.length ?? 0) - (kept.match(/\n/g)?.length ?? 0);
  return (
    kept +
    `\n… (truncated ${droppedLines} line${droppedLines === 1 ? '' : 's'}, ${dropped} chars)`
  );
}

function entriesForStorage(history: ReplEntry[]): ReplEntry[] {
  return history.map((e) =>
    e.output.length <= MAX_OUTPUT_BYTES
      ? e
      : { ...e, output: truncate(e.output, MAX_OUTPUT_BYTES) },
  );
}

function loadEntries(prefix: string): ReplEntry[] {
  try {
    const raw = localStorage.getItem(entriesKey(prefix));
    if (raw) return JSON.parse(raw) as ReplEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

function saveEntries(prefix: string, history: ReplEntry[]) {
  let toSave = entriesForStorage(history);
  try {
    localStorage.setItem(entriesKey(prefix), JSON.stringify(toSave));
    return;
  } catch {
    while (toSave.length > 0) {
      toSave = toSave.slice(Math.ceil(toSave.length / 2));
      try {
        localStorage.setItem(entriesKey(prefix), JSON.stringify(toSave));
        return;
      } catch {
        /* keep trimming */
      }
    }
  }
}

function loadInputs(prefix: string): string[] {
  try {
    const raw = localStorage.getItem(inputsKey(prefix));
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    /* ignore */
  }
  // Backwards-compat: seed from the rendered history if input-history was
  // never persisted separately on this tab.
  return loadEntries(prefix).map((e) => e.input);
}

function saveInputs(prefix: string, inputs: string[]) {
  try {
    localStorage.setItem(inputsKey(prefix), JSON.stringify(inputs));
  } catch {
    /* quota — drop quietly */
  }
}

export function useReplHistory(storageKeyPrefix: string): ReplHistory {
  const [history, setHistory] = useState<ReplEntry[]>(() =>
    loadEntries(storageKeyPrefix),
  );
  const inputs = useRef<string[]>(loadInputs(storageKeyPrefix));
  const index = useRef(-1);
  const draft = useRef('');

  useEffect(() => {
    saveEntries(storageKeyPrefix, history);
  }, [history, storageKeyPrefix]);

  function append(entry: ReplEntry) {
    setHistory((h) => [...h, entry].slice(-MAX_HISTORY_ENTRIES));
    inputs.current = [...inputs.current, entry.input].slice(-MAX_INPUT_HISTORY);
    saveInputs(storageKeyPrefix, inputs.current);
    index.current = -1;
    draft.current = '';
  }

  function clear() {
    setHistory([]);
  }

  function recallPrev(currentInput: string): string | null {
    const list = inputs.current;
    if (list.length === 0) return null;
    if (index.current === -1) {
      draft.current = currentInput;
      index.current = list.length - 1;
    } else if (index.current > 0) {
      index.current--;
    } else {
      return null;
    }
    return list[index.current];
  }

  function recallNext(): string | null {
    if (index.current === -1) return null;
    const list = inputs.current;
    if (index.current < list.length - 1) {
      index.current++;
      return list[index.current];
    }
    index.current = -1;
    return draft.current;
  }

  function resetRecall() {
    index.current = -1;
    draft.current = '';
  }

  return { history, append, clear, recallPrev, recallNext, resetRecall };
}
