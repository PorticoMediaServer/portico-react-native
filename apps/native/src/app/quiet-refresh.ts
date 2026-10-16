import {useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {quietRefreshStep, type QuietRefreshState} from '../../../../packages/client-core/src/quiet-refresh';

/** A try that came due while the app was in the background runs this long after it is in front again. */
const RESUME_MS = 1000;

/**
 * A list the server says changed under the screen (`refresh-required`) is read again by itself,
 * quietly, with what is shown kept in place (the shared rule, `quietRefreshStep`, as on the web).
 * Tries run only while the app is in front. True once they have not brought the list back: then,
 * and only then, the screen shows its notice with Refresh.
 */
export function useQuietRefresh(required: boolean, refresh: () => unknown): boolean {
  const [stuck, setStuck] = useState(false);
  const latest = useRef(refresh);
  latest.current = refresh;
  const still = useRef(required);
  still.current = required;
  const state = useRef<QuietRefreshState>({tries: 0, lastAt: 0});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef(false);
  const flying = useRef(false);
  const live = useRef(true);
  const attempt = useRef(() => {});
  const next = useRef(() => {});
  attempt.current = () => {
    timer.current = undefined;
    if (!still.current || !live.current) return;
    // In the background nothing is read: the try runs once the app is in front again.
    if (AppState.currentState !== 'active') { waiting.current = true; return; }
    flying.current = true;
    let run: Promise<unknown>;
    try { run = Promise.resolve(latest.current()); } catch (error) { run = Promise.reject(error); }
    // After each try: a list still refused is tried again, until the tries run out.
    void run.catch(() => {}).finally(() => setTimeout(() => { flying.current = false; next.current(); }, 0));
  };
  next.current = () => {
    if (!still.current || !live.current) return;
    const step = quietRefreshStep(state.current, Date.now());
    state.current = step.state;
    if (step.stuck) setStuck(true);
    else timer.current = setTimeout(() => attempt.current(), step.delayMs ?? 0);
  };
  useEffect(() => {
    live.current = true;
    const subscription = AppState.addEventListener('change', now => {
      if (now !== 'active' || !waiting.current) return;
      waiting.current = false;
      timer.current = setTimeout(() => attempt.current(), RESUME_MS);
    });
    return () => {
      live.current = false;
      subscription.remove();
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (!required) {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      waiting.current = false;
      setStuck(false);
      return;
    }
    // A try under way says what comes next when it ends.
    if (!flying.current && timer.current === undefined && !waiting.current) next.current();
  }, [required]);
  return required && stuck;
}
