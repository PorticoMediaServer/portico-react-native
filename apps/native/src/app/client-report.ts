import {useCallback, useEffect, useState} from 'react';
import {Platform} from 'react-native';
import {sendClientReport} from '../../../../packages/client-core/src/client-reports';
import {installationIdentity} from '../../../../packages/client-core/src/installation';
import {devicePlatform} from '../bridge/device-platform';
import {deviceIdentity} from '../bridge/setup-codes';
import {forgetCrash, journal, lastCrash} from './error-capture';
import {reportBody, type FatalRecord} from './error-journal';
import {activeI18n} from './errors';

/**
 * A report of this app's own trouble, sent to the owner of the server the person is signed in to
 * (`POST /v1/diagnostics/client-logs`): the warnings and errors of this run and, when the last
 * run ended unexpectedly, what ended it. Sent only when the person asks. The server keeps a
 * handful per device and a daily amount per account, and says so when either is used up.
 */
type ReportApi = Parameters<typeof sendClientReport>[0];

export async function sendReport(api: ReportApi, serverId: string): Promise<void> {
  const [identity, crash] = await Promise.all([deviceIdentity().catch(() => undefined), lastCrash()]);
  const appVersion = identity?.appVersion ?? '';
  const platform = installationIdentity()?.platform || devicePlatform;
  const deviceClass = Platform.isTV ? 'television' : 'mobile';
  const body = reportBody({appVersion, platform, deviceClass, deviceName: identity?.deviceName, now: Date.now(), fatal: crash, entries: journal.list()});
  await sendClientReport(api, serverId, {platform, deviceClass, appVersion, body});
  if (crash) await forgetCrash(crash);
}

/** Why a report could not be sent, in words a person can act on. */
export function reportProblem(error: unknown): string {
  const code = (error as {code?: unknown} | null)?.code;
  if (code === 'client_log_budget') return activeI18n().t('web.diagnostics.clientReportBudget');
  if (code === 'device_session_required') return activeI18n().t('web.diagnostics.clientReportDevice');
  return activeI18n().t('about.report.failed');
}

/** Whether the last run ended unexpectedly and what ended it is still waiting to be sent. */
export function useLastCrash(): {crash?: FatalRecord; recheck: () => void} {
  const [crash, setCrash] = useState<FatalRecord>();
  const recheck = useCallback(() => { void lastCrash().then(setCrash); }, []);
  useEffect(recheck, [recheck]);
  return {crash, recheck};
}
