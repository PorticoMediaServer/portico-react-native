import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {NativeQueueStore} from '../bridge/queue-storage';
import {defaultEngineSetting, parseEngineSetting, type EngineSetting} from '../player/engine-choice';
import {engineSettingStore} from '../player/engine-setting-store';

/**
 * Installation-scoped viewing preferences. These are device conveniences,
 * not account state, so they live in the native secure store keyed to this
 * installation and never sync.
 */
export type Preferences = {
  reduceMotion: boolean;
  autoplayNext: boolean;
  musicSpeed: number;
  audiobookSpeed: number;
  subtitleLanguage: string;
  /** Television only: the ten-foot text scale (APL-SYS-03 / A11Y-7.6). */
  textSize: 'standard' | 'large';
  /** Television only: let this profile's other devices send playback here. */
  receiveFromDevices: boolean;
  /** Which player plays video on this device: Automatic (the default), the system's own, or mpv. */
  playerEngine: EngineSetting;
  /** "If something looks or sounds wrong": the server plans every title for this device as two
   * channels, without handing sound to a receiver untouched, or as a standard-range screen. */
  forceStereo: boolean;
  disablePassthrough: boolean;
  disableHdr: boolean;
};

const defaults: Preferences = {reduceMotion: false, autoplayNext: true, musicSpeed: 1, audiobookSpeed: 1, subtitleLanguage: '', textSize: 'standard', receiveFromDevices: true, playerEngine: defaultEngineSetting, forceStereo: false, disablePassthrough: false, disableHdr: false};
const key = 'preferences:v1';
const store = new NativeQueueStore();

function parse(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return defaults;
  const r = raw as Partial<Preferences>;
  return {
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : defaults.reduceMotion,
    autoplayNext: typeof r.autoplayNext === 'boolean' ? r.autoplayNext : defaults.autoplayNext,
    musicSpeed: typeof r.musicSpeed === 'number' ? r.musicSpeed : defaults.musicSpeed,
    audiobookSpeed: typeof r.audiobookSpeed === 'number' ? r.audiobookSpeed : defaults.audiobookSpeed,
    subtitleLanguage: typeof r.subtitleLanguage === 'string' ? r.subtitleLanguage : defaults.subtitleLanguage,
    textSize: r.textSize === 'large' ? 'large' : 'standard',
    receiveFromDevices: typeof r.receiveFromDevices === 'boolean' ? r.receiveFromDevices : defaults.receiveFromDevices,
    playerEngine: parseEngineSetting(r.playerEngine),
    forceStereo: r.forceStereo === true,
    disablePassthrough: r.disablePassthrough === true,
    disableHdr: r.disableHdr === true,
  };
}

type Value = {preferences: Preferences; update: (patch: Partial<Preferences>) => void; loaded: boolean};
const PreferencesContext = createContext<Value>({preferences: defaults, update: () => {}, loaded: false});

export function PreferencesProvider({children}: {children: React.ReactNode}) {
  const [preferences, setPreferences] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    store
      .change(key, raw => ({record: raw, value: parse(raw)}))
      .then(value => {
        if (active) setPreferences(value);
      })
      .catch(() => {})
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, []);
  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences(prev => {
      const next = {...prev, ...patch};
      void store.change(key, () => ({record: next, value: next})).catch(() => {});
      return next;
    });
  }, []);
  // The server plans for the player the viewer chose and under the viewer's overrides: the
  // capability publisher reads them here, and only once this device's saved values are known.
  useEffect(() => { if (loaded) engineSettingStore.set(preferences.playerEngine); }, [loaded, preferences.playerEngine]);
  useEffect(() => { if (loaded) engineSettingStore.setOverrides({forceStereo: preferences.forceStereo, disablePassthrough: preferences.disablePassthrough, disableHdr: preferences.disableHdr}); }, [loaded, preferences.forceStereo, preferences.disablePassthrough, preferences.disableHdr]);
  const value = useMemo(() => ({preferences, update, loaded}), [preferences, update, loaded]);
  return React.createElement(PreferencesContext.Provider, {value}, children);
}

export function usePreferences(): Value {
  return useContext(PreferencesContext);
}
