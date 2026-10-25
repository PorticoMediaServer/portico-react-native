import React, {useEffect, useRef, useState} from 'react';
import {AppState, NativeModules} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {SettingsRow} from '../../kit/shell';

type Facts = Readonly<{eligible?: boolean}>;

/** Canonical Apple input only: audio.eac3JocEligible. There is no videoEligibility
 * fallback in AppleNativeFacts or the bridge, and a missing value is not evidence. */
function readFacts(value: unknown): Facts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const audio = (value as {audio?: {eac3JocEligible?: unknown}}).audio;
  return {eligible: typeof audio?.eac3JocEligible === 'boolean' ? audio.eac3JocEligible : undefined};
}

/** Frame 12's Audio passthrough is a capability line, not a control: the Apple engines
 * have no stored passthrough choice to honour. It reports only the canonical eac3Joc
 * eligibility. Atmos is not named here: client-profile attaches it only when that
 * eligibility and the spatial-route requirement both hold, and the exact value copy
 * arrives with the mirrored key. Nothing is an active-output or receiver claim. */
export function NativeApplePassthroughRow({testID}: {testID?: string}) {
  const t = defaultI18n.t, [facts, setFacts] = useState<Facts | null>();
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const read = ++generation.current;
      try {
        const value = await (NativeModules.PorticoCapabilities?.facts?.() as Promise<unknown> | undefined);
        if (!alive || read !== generation.current) return;
        setFacts(readFacts(value) ?? null);
      } catch {
        if (alive && read === generation.current) setFacts(null);
      }
    };
    void load();
    const subscription = AppState.addEventListener('change', value => {if (value === 'active') void load();});
    return () => {alive = false; subscription.remove();};
  }, []);
  if (facts === undefined) return null;
  const value = facts?.eligible === true ? t('next.kit.codec.eac3')
    : facts?.eligible === false ? undefined : t('web.capabilities.unknown');
  return <SettingsRow testID={testID} label={t('next.settingsSpec.account.device.groups.1.rows.7.label')}
    description={t('next.settingsSpec.account.device.groups.1.rows.7.help')} value={value} readable/>;
}
