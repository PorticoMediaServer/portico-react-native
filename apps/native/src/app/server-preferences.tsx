import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFreshness} from './freshness';
import {dependsOn} from '../../../../packages/client-core/src/freshness-hub';
import {PreferencesReader} from '../../../../packages/client-core/src/preferences-reader';
import {preferenceValue, type PreferencePatch, type PreferenceScope, type PreferenceSnapshot, type PreferenceValue} from '../../../../packages/client-core/src/preferences';
import {viewerScope} from './content';
import {useSession} from './session';
import {present, say} from './errors';

/**
 * Viewer preferences published by the selected server. The server owns every
 * default, domain and clamp; this provider mirrors the snapshot and forwards
 * merge patches. Without a server answer, readers get the fallback they pass,
 * so the app keeps working offline.
 */
type Value = {
  snapshot?: PreferenceSnapshot;
  loading: boolean;
  error?: string;
  /** APL-SYS-12: the kind of failure (`presentError` category), so the copy blames the network only when it was the network. */
  errorCategory?: string;
  saving: boolean;
  value: <T extends PreferenceValue>(key: string, fallback: T) => T;
  set: (patch: PreferencePatch) => Promise<void>;
  reload: () => void;
};

const Ctx = createContext<Value>({loading: false, saving: false, value: (_k, f) => f, set: async () => {}, reload: () => {}});

export function ServerPreferencesProvider({deviceClass, children}: {deviceClass: 'mobile' | 'television'; children: React.ReactNode}) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const client = useMemo(() => new PreferencesReader(api, scope), [api, scope]);
  useEffect(() => () => client.dispose(), [client]);
  const [snapshot, setSnapshot] = useState<PreferenceSnapshot>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [errorCategory, setErrorCategory] = useState<string>();
  const generation = useRef(0);
  const load = useCallback(() => {
    const gen = ++generation.current;
    setLoading(true);
    client.preferences(deviceClass).then(next => {
      if (gen !== generation.current) return;
      setSnapshot(next);
      setError(undefined);
      setErrorCategory(undefined);
    }).catch((e: unknown) => {
      if (gen !== generation.current) return;
      // APL-SYS-12: a projection the parser refused is diagnosable in development.
      if (__DEV__) console.warn('[preferences] load failed', e);
      setError(say(e, 'preferences', 'load'));
      setErrorCategory(present(e, 'preferences').category);
    }).finally(() => {
      if (gen === generation.current) setLoading(false);
    });
  }, [client, deviceClass]);
  useEffect(load, [load]);
  // Preferences changed on another device, or the server's own settings, arrive on the event feed: read them again in place.
  const {hub} = useFreshness();
  useEffect(() => hub.watch([dependsOn.settings('preferences'), dependsOn.settings('server')], load), [hub, load]);
  // APL-SET-03: a transient failure no longer leaves Preferences empty until relaunch. Retry with
  // backoff while nothing has loaded, and refresh whenever the app comes back to the foreground.
  const failures = useRef(0);
  useEffect(() => {
    if (!error || snapshot) { failures.current = 0; return; }
    const wait = [5000, 15000, 45000, 120000][Math.min(failures.current, 3)]!;
    failures.current += 1;
    const timer = setTimeout(load, wait);
    return () => clearTimeout(timer);
  }, [error, snapshot, load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => { if (next === 'active') load(); });
    return () => sub.remove();
  }, [load]);
  const value = useCallback(<T extends PreferenceValue>(key: string, fallback: T): T => {
    if (!snapshot) return fallback;
    try {
      return preferenceValue<T>(snapshot, key);
    } catch {
      return fallback;
    }
  }, [snapshot]);
  const set = useCallback(async (patch: PreferencePatch) => {
    if (!snapshot) throw new Error('Preferences are not available while the server is unreachable.');
    const byScope = new Map<PreferenceScope, Record<string, PreferenceValue | null>>();
    for (const [key, v] of Object.entries(patch)) {
      const field = snapshot.registry.fields.find(f => f.key === key);
      if (!field) throw new Error(`This server does not publish the preference ${key}.`);
      const scopeName = field.scopes[0];
      if (!byScope.has(scopeName)) byScope.set(scopeName, {});
      byScope.get(scopeName)![key] = v;
    }
    setSaving(true);
    try {
      let current = snapshot;
      for (const [scopeName, values] of byScope) {
        const revision = current.documents.find(d => d.scope === scopeName)?.revision ?? 1;
        current = await client.applyPreferences(scopeName, deviceClass, revision, values);
      }
      setSnapshot(current);
      setError(undefined);
    } finally {
      setSaving(false);
    }
  }, [client, deviceClass, snapshot]);
  const ctx = useMemo<Value>(() => ({snapshot, loading, error, errorCategory, saving, value, set, reload: load}), [snapshot, loading, error, errorCategory, saving, value, set, load]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export const useServerPreferences = () => useContext(Ctx);
