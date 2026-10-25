import {Platform} from 'react-native';
import {sendClientReport} from '../../../../../packages/client-core/src/client-reports';
import {installationIdentity} from '../../../../../packages/client-core/src/installation';
import {forgetCrash, journal, lastCrash} from '../../platform/error-capture';
import {reportBody} from '../../platform/error-journal';
import type {NativeSettingsPanelDeps} from './settings-panels';

/** Explicitly requested, bounded/redacted diagnostics for this captured server only. */
export async function sendNativeDeviceReport({context, lifetime}: Pick<NativeSettingsPanelDeps, 'context' | 'lifetime'>): Promise<void> {
  lifetime.assert();
  const identity = installationIdentity();
  if (!identity) throw new Error('native_device_report_installation_unavailable');
  const crash = await lastCrash();
  lifetime.assert();
  if (installationIdentity() !== identity) throw new Error('native_device_report_installation_changed');
  const deviceClass = Platform.isTV ? 'television' : 'mobile';
  const body = reportBody({appVersion: identity.appVersion, platform: identity.platform, deviceClass, deviceName: identity.name,
    now: Date.now(), fatal: crash, entries: journal.list()});
  await lifetime.request(signal => sendClientReport(context.api, lifetime.authority.serverId,
    {platform: identity.platform, deviceClass, appVersion: identity.appVersion, body}, signal));
  if (crash) await forgetCrash(crash);
}
