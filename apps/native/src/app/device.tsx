import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {StyleSheet, TVFocusGuideView, View} from 'react-native';
import {IdentityClient, announceDevice} from '../../../../packages/client-core/src/index';
import {profileInstallation} from '../bridge/profile-trust';
import {deviceIdentity} from '../bridge/setup-codes';
import {devicePlatform} from '../bridge/device-platform';
import {Button, StateView, useTheme} from '../ui';
import {useSession} from './session';
import {useI18n} from './i18n';
import {clearTopShelf, refreshTopShelf} from './top-shelf';

const version: string = (() => { try { return String(require('../../package.json').version ?? ''); } catch { return ''; } })();

/**
 * After any sign-in, tells the server which device this is, so it appears by name under
 * Devices, can be signed out from elsewhere, and is held for the owner's approval when the
 * server asks for that. Only an explicit "waiting for approval" from the server covers the app;
 * any other failure is ignored, because a device list must never cost anyone their sign-in.
 */
export function DeviceApprovalCover() {
  const {api, session, signOut} = useSession();
  const i18n = useI18n();
  const {colors, space, isTV} = useTheme();
  const identity = useMemo(() => (api ? new IdentityClient(api) : null), [api]);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  // Every sign-in is a device on its server, however the viewer proved who they are: the record
  // lives on the server alone, and a Portico Account sign-in never asks Hosted Services about it.
  const family = session?.sessionFamilyId ?? '';
  const serverId = session?.viewer.serverId, profileId = session?.viewer.profileId;
  const announce = useCallback(async () => {
    if (!family || !identity) { setPending(false); return; }
    const installationId = await profileInstallation().catch(() => undefined);
    if (!installationId) return;
    setChecking(true);
    // APL-AUTH-06: the device's own name ("Living Room"), as everywhere else it introduces itself.
    const device = await deviceIdentity();
    const outcome = await announceDevice(identity, {installationId, name: device.deviceName, platform: devicePlatform, app: 'Portico', appVersion: device.appVersion || version}, family);
    setChecking(false); setPending(outcome === 'pending');
    // The home-screen shelf is tied to an approved device, so it is supplied once this one is known.
    if (isTV && outcome === 'bound' && api && serverId && profileId) void refreshTopShelf(api, installationId, `${serverId}/${profileId}`);
  }, [identity, family, isTV, api, serverId, profileId]);
  useEffect(() => { void announce(); }, [announce]);
  // Signed out: the shelf must not go on showing this profile's titles.
  useEffect(() => { if (isTV && !session) clearTopShelf(); }, [isTV, session]);
  if (!pending) return null;
  return (
    // QA (TV): the cover keeps focus; nothing under it can be reached with the remote.
    <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={[StyleSheet.absoluteFill, {backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md}]}>
      <StateView icon="shield" title={i18n.t('device.approveTitle')} message={i18n.t('device.approveBody')} />
      <View style={{flexDirection: 'row', gap: space.sm}}>
        <Button variant="primary" label={i18n.t('device.approval.checkAgain')} loading={checking} hasTVPreferredFocus onPress={() => void announce()} />
        <Button variant="ghost" label={i18n.t('action.signOut')} onPress={signOut} />
      </View>
    </TVFocusGuideView>
  );
}
