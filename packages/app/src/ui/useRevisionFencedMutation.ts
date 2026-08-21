import {useCallback, useRef, useState} from 'react';

export function useRevisionFencedMutation<T>(commit: (value: T) => Promise<unknown>) {
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const revision = useRef(0);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();

  const mutate = useCallback(async (value: T): Promise<boolean> => {
    // One UI owner means callers cannot compose a second patch from stale
    // authoritative state while the first revision is unresolved.
    if (inFlight.current) return false;
    inFlight.current = true;
    const requestRevision = ++revision.current;
    setPending(true);
    setError(undefined);
    try {
      await commitRef.current(value);
      return requestRevision === revision.current;
    } catch (cause) {
      if (requestRevision === revision.current) setError(cause);
      return false;
    } finally {
      if (requestRevision === revision.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }, []);

  return {error, mutate, pending};
}
