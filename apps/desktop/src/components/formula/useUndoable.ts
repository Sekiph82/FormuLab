import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo for the formula draft.
 *
 * Coalesces edits that land within `coalesceMs` of each other so that typing
 * "12.5" into a percentage cell is one undo step, not four. Without that, undo
 * is useless on a grid: a chemist would have to press it a dozen times to get
 * back past one number.
 */
export function useUndoable<T>(initial: T, opts: { coalesceMs?: number; limit?: number } = {}) {
  const coalesceMs = opts.coalesceMs ?? 600;
  const limit = opts.limit ?? 200;

  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastPush = useRef(0);
  const [, forceRender] = useState(0);

  const set = useCallback(
    (next: T | ((prev: T) => T), opts: { checkpoint?: boolean } = {}) => {
      setPresent((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (value === prev) return prev;

        const now = Date.now();
        const coalesce = !opts.checkpoint && now - lastPush.current < coalesceMs;
        if (!coalesce) {
          past.current = [...past.current, prev].slice(-limit);
          future.current = [];
        }
        lastPush.current = now;
        return value;
      });
      forceRender((n) => n + 1);
    },
    [coalesceMs, limit],
  );

  /** Replace the value without recording history — for loading, not editing. */
  const reset = useCallback((value: T) => {
    past.current = [];
    future.current = [];
    lastPush.current = 0;
    setPresent(value);
    forceRender((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    setPresent((current) => {
      const previous = past.current[past.current.length - 1];
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current].slice(0, limit);
      return previous;
    });
    // A fresh undo must not be coalesced into the next keystroke.
    lastPush.current = 0;
    forceRender((n) => n + 1);
  }, [limit]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    setPresent((current) => {
      const next = future.current[0];
      future.current = future.current.slice(1);
      past.current = [...past.current, current].slice(-limit);
      return next;
    });
    lastPush.current = 0;
    forceRender((n) => n + 1);
  }, [limit]);

  return {
    value: present,
    set,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
