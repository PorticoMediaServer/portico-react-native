import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, NativeModules, Platform} from 'react-native';
import {HttpLocalApi, ViewerService, type CredentialSessionService, type HostedServer, type HostedSession, type LocalSession, type SystemInfo} from '../../../../packages/client-core/src/index';
import {ACCESS_REFUSED, REFRESH_OUTSIDE_HOURS, connectHostedServer, connectPairedServer, rememberNativeSession, type RememberedServer} from '../../../../packages/client-core/src/server-connections';
import {acceptPorticoCustody, acceptPorticoInvitation, isAccessRefused, isClockSkew, isSessionMigrated, leavePorticoServer, porticoSignIn, transferPorticoOwnership, type HostedRequestApi} from '../../../../packages/client-core/src/portico-servers';
import type {ServerPin} from '../../../../packages/client-core/src/route-identity';
import {ViewerSelectionCommit, selectedViewerRecord, type SelectedViewerRecord} from '../../../../packages/client-core/src/viewer-selection';
import {directOutcome} from './direct-outcome';
import {addressFailure, changedWhileSigningIn, connectDirectServer, findDirectServer, serverAddress} from './direct-connect';
import {routeRefusal} from './portico-refusal';
import {classifyPorticoFailure, type PorticoFailure, type PorticoStage} from './portico-failure';
import {lastPorticoServer} from '../bridge/last-server';
import {directEntryFor} from './known-server-entry';
import {changeRequiredPassword, completeDirectSignInChallenge, directSignIn, selectDirectProfile, type DirectSignIn, type DirectSnapshot} from '../../../../packages/client-core/src/profile-management';
import {setInstallationIdentity, validInstallationId} from '../../../../packages/client-core/src/installation';
import {LocalSessionRefresher} from '../../../../packages/client-core/src/session-refresh';
import {HttpCredentialApi} from '../../../../packages/client-core/src/credentials';
import {deviceIdentity} from '../bridge/setup-codes';
import {installationPlatform} from '../bridge/device-platform';
import {forgetNativeConnection, nativeConnectionEnvironment, nativeHostedSource, nativeNetworkFetch, onNetworkChange, restoreNativeConnection, trackNativeConnection} from '../bridge/server-connections';
import {profileAPI} from '../bridge/profile-transport';
import {nativeViewerStorage, prepareSecureRecords, profileInstallation} from '../bridge/profile-trust';
import {isSecureRecordsLost, resetSecureRecords, restartApp} from '../bridge/secure-records';
import {useHostedAccount} from '../bridge/useHostedAccount';
import {useCredentialVerification} from '../bridge/useCredentialVerification';
import {closeAttachedAccount, observeAttachedAccount} from '../bridge/attached-account-boundary';
import {offlineDownloads} from '../bridge/offline-downloads';
import {activeI18n, present, ShownError, signInMessage} from './errors';
import {clearActivity} from '../bridge/NativeActivity';
import {knownDirectServers} from '../bridge/known-servers';
import {resumeEnding, savedStateAfter} from './sign-in-ended';
import {rememberDirectSignIn} from '../bridge/direct-memory';
import {hostedUrl} from '../bridge/account-authority';

/**
 * Session controller. Owns who is signed in, to which server, as which
 * profile, and how that was remembered on this installation. All protocol
 * work is delegated to client-core services; this file only sequences them
 * and exposes a small, screen-friendly API.
 */
export const viewer = new ViewerService();

/* Device-bound sessions: every credential request names this installation (the Keychain-held id
 * the native bridge keeps), so the server binds the sign-in to it and later accepts its refresh.
 * Resume waits for this before renewing a saved sign-in. */
let secureRecordsRecovered = false;
/** This device can no longer read its saved records, and only the person can decide to reset it
 * (see `bridge/secure-records.ts`). Set once, at launch; a reset starts the app again. */
let secureRecordsLost = false;
const installationReady: Promise<void> = (async () => {
  try {
    secureRecordsRecovered = await prepareSecureRecords();
    const [installationId, device] = await Promise.all([profileInstallation(), deviceIdentity()]);
    if (!validInstallationId(installationId)) return;
    setInstallationIdentity({installationId, name: device.deviceName, platform: installationPlatform, app: 'Portico', appVersion: device.appVersion});
  } catch (e) {
    // Otherwise sign-in still works; the session just can't be renewed.
    secureRecordsLost = isSecureRecordsLost(e);
  }
})();

/** Remembers a direct sign-in for the server switcher; a Portico sign-in to the same server forgets it. */
async function keepKnownServer(record: SelectedViewerRecord, name: string): Promise<void> {
  const serverId = record.session.viewer.serverId;
  const saved = await nativeConnectionEnvironment.storage.read().catch(() => undefined);
  const portico = directEntryFor(saved, serverId) === 'portico';
  await (portico ? knownDirectServers.forget(serverId) : knownDirectServers.remember({serverId, name, address: record.serverUrl, lastProfileId: record.session.viewer.profileId})).catch(() => {});
}

export {hostedUrl};

/**
 * C45: a direct sign-in that needs a profile chosen. `accountSession` is the account-tier session
 * the sign-in issued (role `account`: it can manage but not play); it is its own session family,
 * signed out (`DELETE /v1/sessions/current`) once a profile is chosen or the choice is abandoned.
 * Switching profiles while signed in has no account session: the live API is used.
 */
export type DirectPending = {api: HttpLocalApi; snapshot?: DirectSnapshot; accountGrant: boolean; accountSession?: LocalSession; /** A Portico Account member: routes are found through the account (Spec — Hosted at Scale). */ hosted?: RememberedServer['hosted']};
/** How opening a server with the Portico Account ended. */
export type PorticoOutcome = 'done' | 'refused' | 'unreachable' | 'failed';
/** A server nobody has set up, held open for first-run setup from a phone or tablet: what it says about itself, and the pinned connection to it. */
export type DirectSetup = {api: HttpLocalApi; name: string; hostedConfigured: boolean};

/** C45: a direct sign-in waiting on one more step: a two-step code, or a new password the server requires. */
export type DirectStep = 'challenge' | 'password-change' | 'device-pending';

export type SessionValue = {
  phase: 'restoring' | 'signedOut' | 'ready';
  api: HttpLocalApi;
  serverUrl?: string;
  session?: LocalSession;
  system?: SystemInfo;
  hostedUrl: string;
  credentials?: CredentialSessionService;
  hosted?: Omit<HostedSession, 'refreshToken'>;
  servers: readonly HostedServer[];
  directoryStatus: string;
  directoryError?: string;
  refreshServers: () => void;
  attachedServer?: HostedServer;
  /** A remembered server session that has not been verified yet this launch. */
  recovery?: SelectedViewerRecord;
  /** Why the last attempt to resume `recovery` failed: the server could not be reached ('offline', retried automatically) or it refused the saved sign-in ('auth'). */
  resumeFailure?: 'offline' | 'auth';
  /**
   * Justin's rule: the app always opens into the shell. A remembered sign-in is shown at once and
   * checked in the background; while it isn't confirmed this says why, for the centered status that
   * replaces the page (shell/ReconnectingStatus.tsx):
   * 'checking', 'offline' (retried a few times, then on request) or 'replaced' (something else
   * answers at the server's address: the sign-in is kept and retried, and only the person decides
   * to sign in again). Undefined once confirmed, or with no saved sign-in.
   */
  saved?: {state: 'checking' | 'offline' | 'replaced' | 'outsideHours'; host?: string; retry: () => void; signInAgain: () => void; useAnother: () => void};
  /**
   * The server has stopped renewing this sign-in because the account is now outside the hours its
   * owner allows. It was signed in and working until then, and nothing has ended: the sign-in is
   * kept, the renewal is tried again by itself (and at once on `retry`), and when the hours come
   * round the shell carries on where it was. The shell shows the same centered status it shows for
   * a sign-in refused for hours at launch.
   */
  outsideHours?: {host?: string; retry: () => void};
  /**
   * Justin (23 Sep): a sign-in that has ended (the server refused to renew it, or refused this
   * profile access) goes straight back to sign-in, never a banner in the shell. 'ended': the
   * server refused to renew this sign-in, or it is no longer on this device. 'noAccess': the server
   * knows this sign-in and refuses it access (`access_refused`); not retried, the credential kept. This says where to: the direct form with the address (and username)
   * filled in, or the Portico Account flow with its server chooser. Downloads stay on the device.
   */
  signInHint?: {authority: 'local' | 'hosted'; reason: 'ended' | 'noAccess'};
  clearSignInHint: () => void;
  /** The quiet note the sign-in screens show after such an ending ("Your sign-in to … has ended."). */
  signInNote?: string;
  /** Show the remembered sign-in again (from sign-in, after "Use another server or account"). */
  openSaved: () => void;
  /**
   * Present when this device can no longer read its saved sign-in (the system lost the key that
   * protects it) and cannot repair that by itself. Sign-in cannot be kept in this state, so the
   * sign-in screens show this instead: `reset` removes what the device had saved, after the
   * person confirms, and `tryAgain` looks once more. Both start the app again; 'reopen' means it
   * could not restart itself and the person has to close and open it.
   */
  deviceReset?: {reset: () => Promise<'restarting' | 'reopen'>; tryAgain: () => Promise<'restarting' | 'reopen'>};
  error: string;
  busy: boolean;
  clearError: () => void;
  resumeSaved: () => Promise<void>;
  forgetSaved: () => void;
  direct: {
    origin: string;
    setOrigin: (value: string) => void;
    pin?: ServerPin;
    inspect: () => Promise<void>;
    resetPin: () => void;
    signIn: (username: string, password: string) => Promise<void>;
    /** Abandon the sign-in (or TV connection) under way: its answer is ignored and Sign in is ready again. */
    cancel: () => void;
    /** TV-AUTH-01: verify and connect to the server at `origin`, for Quick Connect. */
    connect: () => Promise<HttpLocalApi>;
    /** TV-AUTH-01: sign in with a session Quick Connect issued on `api`. */
    acceptSession: (api: HttpLocalApi, session: LocalSession) => Promise<void>;
    pending?: DirectPending;
    /** C45: the sign-in's next step, when the server asked for one. */
    step?: DirectStep;
    /** Finish a two-step sign-in with an authenticator or recovery code. */
    completeChallenge: (code: string) => Promise<void>;
    /** Choose the new password the server requires, then sign in with it. */
    changeRequiredPassword: (newPassword: string) => Promise<void>;
    /** After the owner approved this device: sign in again with the same details. */
    retrySignIn: () => Promise<void>;
    /** Abandon the pending step (the connection and any account session are released). */
    cancelStep: () => void;
    /** First run from a phone or tablet: the server at `origin` that nobody has set up, connected and pinned. */
    setup?: DirectSetup;
    /** Connect to the server at `origin` to set it up (handhelds); false when it turned out to be set up already. */
    beginSetup: () => Promise<boolean>;
    /** Leave first-run setup (the connection is released). */
    cancelSetup: () => void;
    /** Setup created the owner: sign in with the session it issued. */
    finishSetup: (session: LocalSession) => Promise<void>;
    chooseProfile: (profileId: string, pin?: string) => Promise<void>;
    cancelPending: () => void;
    openProfileChooser: () => void;
  };
  /** Portico Account members (Spec — Hosted at Scale). */
  portico: {
    /** Sign in to one of the account's servers with the account (a Hosted identity assertion the
     * server checks itself); a profile chooser follows through `direct.pending` when needed. */
    connect: (server: HostedServer) => Promise<PorticoOutcome>;
    /** Accept a server's invitation link (`/join#code=…&server=…`) as the account. */
    acceptInvitation: (origin: string, code: string) => Promise<boolean>;
    /** Settings › Refresh Servers. */
    refreshServers: () => void;
    /** Sign in to a server from the shell's landing: undefined when it opened (or a profile or
     *  step follows), else what failed. */
    open: (server: HostedServer) => Promise<PorticoFailure | undefined>;
    /** The server this account opened last on this device. */
    lastServer: () => Promise<string | undefined>;
    /** A member leaves the current server: Portico drops it from the account's list, this device
     *  forgets its sign-in there, and the server chooser shows. The owner can't leave (409). */
    leave: () => Promise<void>;
    /** The owner hands the current server to an active member, confirmed with the Portico Account.
     *  `expectedRevision` is the owner's own account revision (`GET /v1/direct`). */
    transferOwnership: (accountId: string, expectedRevision: number) => Promise<void>;
    /** INT M6: the owner accepts Portico's custody of this server's registration (`custodyPending`),
     *  confirmed with the Portico Account. */
    acceptCustody: () => Promise<void>;
    /** When the list was last confirmed with the account service. */
    checkedAt?: number;
  };
  /** Adopts a television activation's account session; false when it was no longer wanted (the session is retired). */
  activationApproved: (session: HostedSession, accept: () => boolean) => Promise<boolean>;
  signOut: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

const friendlyHostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/** Quiet retries for a remembered server that can't be reached; after these, only on request. */
const RESUME_RETRY_MS = [3000, 10000, 30000, 60000, 120000];
/** After the quick retries: every 2 minutes for as long as the app is in the foreground. */
const RESUME_SLOW_RETRY_MS = 120000;

/**
 * An unreachable saved server is retried at once when the app comes back to the foreground or the
 * network changes. Module-level so the provider's hooks stay as they are; `resumeWake` is set
 * while a saved sign-in is waiting on the server and cleared once it resumes.
 */
let resumeWake: (() => void) | undefined;
let resumeWakeInstalled = false;
function installResumeWake() {
  if (resumeWakeInstalled) return;
  resumeWakeInstalled = true;
  AppState.addEventListener('change', state => { if (state === 'active') resumeWake?.(); });
  onNetworkChange(() => resumeWake?.());
}

/**
 * Whether the address answers as a different server than the one this sign-in belongs to (the
 * demo was rebuilt, say). Asks `/v1/system` without any credential.
 */
async function serverReplaced(record: SelectedViewerRecord): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await fetch(record.serverUrl.replace(/\/+$/, '') + '/v1/system', {signal: abort.signal, headers: {Accept: 'application/json'}});
    if (!response.ok) return false;
    const info = (await response.json()) as {id?: unknown};
    return typeof info.id === 'string' && info.id !== record.session.viewer.serverId;
  } finally {
    clearTimeout(timer);
  }
}

/** How long the launch gate waits for a saved server before offering the saved-server screen. */
const RESUME_DEADLINE_MS = 15000;
/** How long a direct sign-in has, once its server has answered, to finish or say why it couldn't. */
const SIGN_IN_DEADLINE_MS = 15000;

/** One step of a sign-in, given SIGN_IN_DEADLINE_MS to answer; then it is stopped and fails as "took too long". */
async function inTime<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ShownError(activeI18n().t('error.timeout'))); }, SIGN_IN_DEADLINE_MS); })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * NS-08: `work` stopped when either signal aborts: its request is cancelled, and it settles as
 * cancelled at that moment even where a transport answers later (Hermes has no `AbortSignal.any`).
 */
function untilEither<T>(work: (signal: AbortSignal) => Promise<T>, own: AbortSignal, abandoned: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  own.addEventListener('abort', stop, {once: true});
  abandoned.addEventListener('abort', stop, {once: true});
  if (own.aborted || abandoned.aborted) stop();
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(Object.assign(new Error('Sign-in was abandoned.'), {code: 'cancelled'}));
    if (controller.signal.aborted) return cancelled();
    controller.signal.addEventListener('abort', cancelled, {once: true});
    work(controller.signal).then(resolve, reject);
  }).finally(() => {
    own.removeEventListener('abort', stop);
    abandoned.removeEventListener('abort', stop);
  });
}

/** The API before a server is chosen. Never a real destination: nothing may be requested from it. */
export const PLACEHOLDER_ORIGIN = 'http://127.0.0.1:1';
export const hasRealOrigin = (api: {baseUrl: string}) => !api.baseUrl.startsWith(PLACEHOLDER_ORIGIN);

// APL-SYS-04: sign-in failures are presented by code (a wrong password, an expired code, an
// unreachable server), never by the raw error text.
const message = (e: unknown) => signInMessage(e);

/** What a person types is rarely a URL (shared with the direct-connect sequence). */
export {serverAddress} from './direct-connect';

export function SessionProvider({children}: {children: React.ReactNode}) {
  const scope = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  // The viewer store outlives this provider (a reload, or a render error that remounts the tree), so
  // a provider that mounts while a viewer is already selected must talk to that viewer's server.
  // Starting from the placeholder here left a signed-in shell sending every request nowhere.
  const [api, setApi] = useState(() => {
    const current = viewer.getSnapshot();
    if (current.phase === 'ready' && current.serverUrl && current.session) {
      const local = profileAPI(current.serverUrl, current.session.accessToken);
      trackNativeConnection(local);
      return local;
    }
    return new HttpLocalApi(PLACEHOLDER_ORIGIN);
  });
  const [system, setSystem] = useState<SystemInfo>();
  const [error, setError] = useState('');
  // Work in flight, one token per operation. Each releases its own token however it ends, so a
  // sign-in that was superseded (an ending, Back, new details) can't leave the spinner running or
  // stop a newer one; abandoning an attempt drops every token at once.
  const [busy, setBusy] = useState(false);
  const operations = useRef(new Set<symbol>());
  // The direct sign-in being attempted, and the busy tokens taken while it runs (its commit's among
  // them): abandoning it or running out of time releases exactly those. See `cancelAttempt`.
  const attempt = useRef<{controller: AbortController; ops: Set<symbol>} | undefined>(undefined);
  const beginBusy = useCallback(() => { const op = Symbol('busy'); operations.current.add(op); attempt.current?.ops.add(op); setBusy(true); return op; }, []);
  const endBusy = useCallback((op: symbol) => { if (operations.current.delete(op) && !operations.current.size) setBusy(false); }, []);
  const dropBusy = useCallback(() => { operations.current.clear(); setBusy(false); }, []);
  const [recovery, setRecovery] = useState<SelectedViewerRecord>();
  const [resumeFailure, setResumeFailure] = useState<'offline' | 'auth'>();
  const [savedState, setSavedState] = useState<'checking' | 'offline' | 'replaced' | 'outsideHours'>();
  const resumeAttempts = useRef(0);
  const resumeRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [restoring, setRestoring] = useState(true);
  const [directOrigin, setDirectOrigin] = useState('');
  const [pin, setPin] = useState<ServerPin>();
  const [pending, setPending] = useState<DirectPending>();
  // First run from a phone or tablet: the server being set up, held open until setup ends.
  const [setupTarget, setSetupTarget] = useState<DirectSetup>();
  const setupRef = useRef<DirectSetup | undefined>(undefined);
  const holdSetup = useCallback((next: DirectSetup | undefined, release = true) => {
    const old = setupRef.current;
    if (old && old !== next && release) { try { old.api.getRouteConnection()?.dispose(); } catch { /* already gone */ } }
    setupRef.current = next;
    setSetupTarget(next);
  }, []);
  const commit = useMemo(() => new ViewerSelectionCommit(nativeViewerStorage), []);
  /** Keeps the published viewer's 15-minute access token alive (session-refresh.ts). */
  const refresher = useRef<LocalSessionRefresher | undefined>(undefined);
  const refreshEnded = useRef<(error?: unknown) => void>(() => {});
  /** The saved sign-in can't be used any more: back to sign-in (set once signOut exists, below). */
  /** The address that answered for what was typed, kept beside the pinned identity so pairing goes to the same place. */
  const answered = useRef<{typed: string; address: string} | undefined>(undefined);
  const pinnedAddress = (typed: string) => (answered.current?.typed === typed ? answered.current.address : serverAddress(typed));
  const signInNeeded = useRef<(reason: 'ended' | 'noAccess', record?: SelectedViewerRecord) => void>(() => {});
  const [signInHint, setSignInHint] = useState<SessionValue['signInHint']>();
  const [signInNote, setSignInNote] = useState<string>();
  const [deviceUnreadable, setDeviceUnreadable] = useState(false);
  useEffect(() => {
    let active = true;
    void installationReady.then(() => {
      if (!active) return;
      if (secureRecordsLost) setDeviceUnreadable(true);
      if (secureRecordsRecovered) {
        secureRecordsRecovered = false;
        setSignInNote(activeI18n().t('web.hostedAccount.ended') + ' ' + activeI18n().t('web.hostedAccount.signInAgain'));
      }
    });
    return () => { active = false; };
  }, []);
  // The person confirmed resetting a device that cannot read its saved records. The app then
  // starts again from the top: nothing read from the old records may stay in memory, and the new
  // launch finds either an empty store (sign in again) or, if the key answered after all, the
  // sign-in that was there. Where the app cannot restart itself the person is asked to reopen it.
  const resetDevice = useCallback(async (): Promise<'restarting' | 'reopen'> => {
    await resetSecureRecords();
    return (await restartApp()) ? 'restarting' : 'reopen';
  }, []);
  const recheckDevice = useCallback(async (): Promise<'restarting' | 'reopen'> => ((await restartApp()) ? 'restarting' : 'reopen'), []);
  const deviceReset = useMemo(() => (deviceUnreadable ? {reset: resetDevice, tryAgain: recheckDevice} : undefined), [deviceUnreadable, resetDevice, recheckDevice]);
  const [hoursRefused, setHoursRefused] = useState(false);
  const refresherWatch = useRef<() => void>(() => {});
  const keepAlive = useCallback((local: HttpLocalApi, record: SelectedViewerRecord) => {
    refresher.current?.stop();
    refresherWatch.current();
    setHoursRefused(false);
    const made = refresher.current = new LocalSessionRefresher({
      env: nativeConnectionEnvironment,
      api: local,
      session: record.session,
      onRotated: next => {
        viewer.rotate(next);
        void nativeViewerStorage.read().then(saved => saved?.session.sessionFamilyId === next.sessionFamilyId ? nativeViewerStorage.write(selectedViewerRecord(record.serverUrl, next)) : undefined).catch(() => {});
      },
      onSignedOut: e => refreshEnded.current(e),
    });
    // A renewal the server refuses for the time of day keeps the sign-in and is tried again; the
    // shell says so for as long as that is the answer, and stops saying it with the first renewal
    // that succeeds.
    refresherWatch.current = made.subscribe(() => {
      if (refresher.current !== made) return;
      const state = made.getSnapshot();
      setHoursRefused(state.phase === 'retrying' && state.error?.code === REFRESH_OUTSIDE_HOURS);
    });
  }, []);
  const stopRefresh = useCallback(() => { refresher.current?.stop(); refresher.current = undefined; refresherWatch.current(); refresherWatch.current = () => {}; setHoursRefused(false); }, []);
  const retryRenewal = useCallback(() => refresher.current?.wake(), []);
  useEffect(() => {
    // Timers sleep with the app: renew on return to the foreground if the token is close to expiry.
    const sub = AppState.addEventListener('change', state => { if (state === 'active') refresher.current?.wake(); });
    return () => { sub.remove(); refresher.current?.stop(); refresher.current = undefined; };
  }, []);
  // A provider remounted over an already-selected viewer keeps renewing it.
  useEffect(() => {
    const current = viewer.getSnapshot();
    if (current.phase === 'ready' && current.serverUrl && current.session && !refresher.current) keepAlive(api, {version: 1, serverUrl: current.serverUrl, session: current.session});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const attachment = useRef<() => void>(() => {});
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; resumeWake = undefined; }, []);
  // The account's server list is kept on the device and version-checked (Spec — Hosted at Scale), so
  // it stays available while signed in to a server: re-admission and Switch server use it.
  const {credentials, hosted, setHosted, servers, directoryStatus, directoryError, refreshServers, dropServer, checkServersNow, serversCheckedAt, attachedServer, setAttachedServer} = useHostedAccount(hostedUrl, 'hosted', !restoring);
  // Credential exposure is Vega's containment (`apps/vega/src/bridge/credential-boundary.ts`): its
  // SDK follows a redirect before the app sees it, so the runtime finds afterwards that a request
  // carrying a credential was answered from another address, revokes what went there, and reports
  // it here. Android and Apple have no such event by design: their native transports refuse every
  // redirect before anything more is sent (`PorticoTransport.kt`, `PorticoPlayer.m`), Portico
  // Account sign-in included (NS-03), so there is nothing to contain afterwards.
  useEffect(() => {
    const runtime = NativeModules.PorticoRuntime;
    if (typeof runtime?.onCredentialExposure !== 'function') return;
    return runtime.onCredentialExposure((event: {origin: string; origins?: readonly string[]}) => {
      const current = viewer.getSnapshot();
      const account = event.origin === hostedUrl;
      const selected = current.serverUrl && (event.origins ?? [event.origin]).includes(new URL(current.serverUrl).origin);
      // An unrelated retired server must not clear a newer viewer.
      if (!account && current.session && !selected && api.baseUrl !== event.origin) return;
      if (account) void credentials?.logout().catch(() => {});
      signInNeeded.current('ended');
      dropBusy();
      setError('');
      setSignInNote(runtime.credentialExposureMessage(activeI18n().locale));
    });
  }, [api, credentials, dropBusy]);

  const serversRef = useRef(servers);
  serversRef.current = servers;
  useCredentialVerification(credentials, hostedUrl);
  useEffect(() => () => attachment.current(), []);

  // Read the remembered viewer once at launch. Verification happens on resume.
  useEffect(() => {
    let active = true;
    nativeViewerStorage
      .read()
      .then(
        record => {
          if (!active || !record) return;
          setRecovery(record);
          // APP-03: name the saved viewer to the downloads store before any network
          // call. A cold launch with no server can then list and play exactly that
          // viewer's downloads — the receipt checks in `playable` are unchanged, so
          // this grants nothing; it only stops the screen being unreachable.
          offlineDownloads.adopt(record.session.viewer);
          // Justin: open straight into the shell with the remembered viewer. The API stays the
          // placeholder (nothing is sent with this token) until the server is confirmed. Its
          // access token has usually expired by now (15 minutes); the restore renews it, so
          // it is shown as a stored sign-in, never refused here.
          try {
            viewer.select(record.serverUrl, record.session, {stored: true});
          } catch {
            // Showing it early is a convenience; the restore below still runs.
          }
          setSavedState('checking');
        },
        // Only a failed read of the secure store lands here. Nothing is deleted: the record
        // stays for the next launch, and signing in replaces it. When the device cannot read any
        // of its records, the sign-in screens say that instead (and offer to reset it), so the
        // answer to that question is waited for before anything is shown.
        async () => {
          await installationReady;
          if (active && !secureRecordsLost) setError(activeI18n().t('signIn.savedUnreadable'));
        },
      )
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const bindAccountAttachment = useCallback(
    (local: HttpLocalApi, session: LocalSession, central: Omit<HostedSession, 'refreshToken'>) => {
      attachment.current();
      if (!credentials || !central.familyId) return;
      attachment.current = observeAttachedAccount(credentials, {accountId: central.account.id, familyId: central.familyId}, () => {
        closeAttachedAccount(session.accessToken, viewer.getSnapshot().session, {localToken: session.accessToken, leave: () => {}}, () => {
          refresher.current?.stop();
          refresher.current = undefined;
          viewer.clear();
          void commit.clear().catch(() => setError(activeI18n().t('signIn.cleanupUnconfirmed')));
          setRecovery(undefined);
          offlineDownloads.adopt(undefined);
          setAttachedServer(undefined);
          setApi(new HttpLocalApi(local.baseUrl));
          void local
            .logout()
            .catch(() => {})
            .finally(() => void forgetNativeConnection(session).catch(() => {}));
        });
      });
    },
    [credentials, commit, setAttachedServer],
  );

  const commitSelectedViewer = useCallback(
    async (url: string, session: LocalSession, result?: {server: HostedServer; context: {sessionId: string; profileId: string}; isCurrent?: () => boolean}, established = false, expectedGeneration = generation.current, abandoned?: AbortSignal) => {
      const assertCandidate = () => { if (expectedGeneration !== generation.current) throw changedWhileSigningIn(url); };
      assertCandidate();
      const candidate = selectedViewerRecord(url, session);
      const central = credentials?.getSnapshot().session;
      const oldServer = attachedServer;
      setError('');
      let transferred = false;
      if (result?.isCurrent?.() === false) throw new ShownError(activeI18n().t('web.signIn.error.profilesChanged', {server: result?.server.name ?? activeI18n().t('invitation.thisServer')}));
      const publish = (record: SelectedViewerRecord) => {
        const local = profileAPI(record.serverUrl, record.session.accessToken);
        trackNativeConnection(local);
        keepAlive(local, record);
        setApi(local);
        setSystem(undefined);
        setAttachedServer(result?.server ?? (oldServer?.id === record.session.viewer.serverId ? oldServer : undefined));
        viewer.select(local.baseUrl, record.session);
        setRecovery(undefined);
        setPending(undefined);
        if (record.session.viewer.authority === 'hosted' && central?.account.id === record.session.viewer.accountId) bindAccountAttachment(local, record.session, central);
        void local
          .system()
          .then(info => {
            if (viewer.getSnapshot().session?.accessToken === record.session.accessToken) setSystem(info);
            // A direct sign-in (or its restore) is remembered for the server switcher; no credentials.
            // A Portico member's sign-in (kept with its Portico route source) is on "Your servers" instead.
            if (record.session.viewer.authority === 'local') void keepKnownServer(record, info.name);
          })
          .catch(() => {});
      };
      const op = beginBusy();
      try {
        await commit.commit(candidate, {
          current: () => {
            const current = viewer.getSnapshot();
            // Read as stored: a resumed viewer holds the saved record, whose access token may have expired
            // (it is being renewed). Read strictly, it threw here and the commit retired the renewed session.
            return current.session ? selectedViewerRecord(current.serverUrl!, current.session, true) : null;
          },
          fence: () => {
            transferred = true;
            attachment.current();
            viewer.clear();
          },
          assertCurrent: () => {
            if (!transferred && result?.isCurrent?.() === false) throw new ShownError(activeI18n().t('web.signIn.error.profilesChanged', {server: result?.server.name ?? activeI18n().t('invitation.thisServer')}));
            if (candidate.session.viewer.authority !== 'hosted') return;
            const live = credentials?.getSnapshot().session;
            if (established) {
              if (live && live.account.id !== candidate.session.viewer.accountId) throw new ShownError(activeI18n().t('web.signIn.error.accountChanged'));
              return;
            }
            if (!central || live?.account.id !== candidate.session.viewer.accountId || live.familyId !== central.familyId || (result && result.context.sessionId !== live.familyId)) throw new ShownError(activeI18n().t('web.signIn.error.accountChanged'));
          },
          assertCandidateCurrent: assertCandidate,
          // NS-08: a direct sign-in abandoned or out of time (`abandoned`) stops this check at once
          // instead of leaving it to run on. The commit then rolls back exactly as it does for a late
          // answer: it never retires a sign-in of the family in use (`sameSignIn`). A restore of the
          // saved sign-in passes no signal; its own deadline deliberately leaves it running.
          verify: (record, signal) => {
            const check = (live: AbortSignal) => profileAPI(record.serverUrl, record.session.accessToken).request<{viewer: LocalSession['viewer']}>('/v1/me', 'GET', undefined, live);
            return abandoned ? untilEither(check, signal, abandoned) : check(signal);
          },
          prepareContext: result ? () => credentials!.updateContext({profileId: result.context.profileId, server: result.server}) : undefined,
          publish,
          restore: record => {
            if (expectedGeneration !== generation.current) return;
            const local = profileAPI(record.serverUrl, record.session.accessToken);
            trackNativeConnection(local);
            keepAlive(local, record);
            setApi(local);
            setAttachedServer(oldServer);
            viewer.select(local.baseUrl, record.session);
            if (record.session.viewer.authority === 'hosted' && central?.account.id === record.session.viewer.accountId) bindAccountAttachment(local, record.session, central);
          },
          revoke: async record => {
            // The shared commit never retires a record of the sign-in in use (same server and
            // family: `sameSignIn`), so a refreshed token or a failed restore keeps its family.
            try {
              await profileAPI(record.serverUrl, record.session.accessToken).logout();
            } finally {
              await forgetNativeConnection(record.session);
            }
          },
          cleanupFailed: () => setError(activeI18n().t('signIn.unusedSession')),
        });
      } catch (e) {
        if (expectedGeneration === generation.current) setError(message(e));
        throw e;
      } finally {
        endBusy(op);
      }
    },
    [attachedServer, bindAccountAttachment, commit, credentials, keepAlive, setAttachedServer, beginBusy, endBusy],
  );

  // APL-AUTH-01: resuming a saved server always settles. The restore-and-verify work is one
  // in-flight operation; the launch gate waits for it at most RESUME_DEADLINE_MS and then shows the
  // saved-server screen, which keeps retrying. If the slow attempt succeeds later it still signs
  // the person in (the commit publishes the session), and a retry joins it instead of starting a
  // second one against the same server.
  const resumeInFlight = useRef<{record: SelectedViewerRecord; generation: number; work: Promise<'signed-in' | 'gone'>} | null>(null);
  const resumeSaved = useCallback(async () => {
    if (!recovery) return;
    const record = recovery, gen = generation.current;
    const op = beginBusy();
    setError('');
    try {
      let flight = resumeInFlight.current;
      if (!flight || flight.record !== record || flight.generation !== gen) {
        const work = (async (): Promise<'signed-in' | 'gone'> => {
          await installationReady;
          if (gen !== generation.current) throw changedWhileSigningIn(record.serverUrl);
          const routed = await restoreNativeConnection(hostedUrl, credentials, record.session);
          if (gen !== generation.current) throw changedWhileSigningIn(record.serverUrl);
          if (!routed) return 'gone';
          await commitSelectedViewer(routed.api.baseUrl, routed.session, undefined, true, gen);
          return 'signed-in';
        })();
        flight = {record, generation: gen, work};
        resumeInFlight.current = flight;
        const settled = () => { if (resumeInFlight.current === flight) resumeInFlight.current = null; };
        work.then(settled, settled);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), RESUME_DEADLINE_MS); });
      const outcome = await Promise.race([flight.work, deadline]).finally(() => clearTimeout(timer));
      if (gen !== generation.current) return;
      if (outcome === 'timeout') throw Object.assign(new Error('Resume deadline passed.'), {code: 'timeout'});
      if (outcome === 'gone') {
        // Nothing left on this device to resume with: sign in again.
        resumeWake = undefined;
        signInNeeded.current('ended', record);
        return;
      }
      setResumeFailure(undefined);
      setSavedState(undefined);
      resumeAttempts.current = 0;
      resumeWake = undefined;
    } catch (e) {
      if (gen !== generation.current) return;
      // An unreachable server is not a signed-out person, and neither is an expired or refused
      // access token: the restore renews it with the refresh token first (client-core). The saved
      // sign-in has ended only when the renewal itself is refused (the server revoked the family,
      // doesn't know it, or saw a refresh token reused). An address that now answers as a different
      // server ends nothing: that answer is unsigned, so the sign-in is kept and retried, and the
      // shell says a different server is answering. Nothing is discarded here: that waits for Sign in.
      // The server moved to its own membership (migration 0120): not a sign-out. Re-admit silently
      // with the Portico Account; only a refusal or no account session opens sign-in.
      if (isSessionMigrated(e)) {
        clearTimeout(resumeRetry.current);
        resumeWake = undefined;
        void readmitRef.current(record);
        return;
      }
      const ending = resumeEnding(e, ACCESS_REFUSED);
      const replaced = ending || (e as {code?: unknown} | null)?.code === REFRESH_OUTSIDE_HOURS ? false : await serverReplaced(record).catch(() => false);
      clearTimeout(resumeRetry.current);
      if (ending) {
        // Must sign in again: straight to the sign-in screen (Justin, 23 Sep), never a banner.
        resumeWake = undefined;
        if (ending === 'noAccess') dropServer(record.session.viewer.serverId);
        signInNeeded.current(ending, record);
      } else {
        setResumeFailure('offline');
        setSavedState(savedStateAfter(e, replaced, REFRESH_OUTSIDE_HOURS));
        // Offline: quick retries, then every 2 minutes while in the foreground, and at once on
        // returning to the foreground or a network change (so Home's "It will keep trying" holds).
        const wait = resumeAttempts.current < RESUME_RETRY_MS.length ? RESUME_RETRY_MS[resumeAttempts.current++]! : RESUME_SLOW_RETRY_MS;
        const again = () => { if (AppState.currentState === 'active') void resumeSavedRef.current(); else resumeRetry.current = setTimeout(again, RESUME_SLOW_RETRY_MS); };
        resumeRetry.current = setTimeout(again, wait);
        installResumeWake();
        resumeWake = () => { clearTimeout(resumeRetry.current); void resumeSavedRef.current(); };
      }
    } finally {
      endBusy(op);
    }
  }, [recovery, credentials, commitSelectedViewer, dropServer, beginBusy, endBusy]);
  const resumeSavedRef = useRef(resumeSaved);
  resumeSavedRef.current = resumeSaved;
  // A directly signed-in server that is now reached at another address (its identity proven there)
  // is remembered at that address, so the server list never offers a dead one. A server this
  // device knows only through a Portico Account is not in that list, and nothing is written for it.
  const directServerId = scope.phase === 'ready' && scope.session?.viewer.authority === 'local' ? scope.session.viewer.serverId : undefined;
  useEffect(() => {
    if (!directServerId) return;
    const follow = () => {
      const route = api.getRouteSnapshot();
      if (route?.phase === 'ready' && route.origin) void knownDirectServers.setAddress(directServerId, route.origin).catch(() => {});
    };
    follow();
    return api.subscribeRoute(follow);
  }, [directServerId, api]);
  // The remembered sign-in shown at launch is checked right away.
  useEffect(() => {
    if (savedState === 'checking' && recovery) void resumeSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedState, recovery]);
  useEffect(() => () => clearTimeout(resumeRetry.current), []);
  const openSaved = useCallback(() => {
    if (!recovery) return;
    clearTimeout(resumeRetry.current);
    resumeAttempts.current = 0;
    viewer.select(recovery.serverUrl, recovery.session, {stored: true});
    setSavedState('checking');
  }, [recovery]);
  const retrySaved = useCallback(() => {
    clearTimeout(resumeRetry.current);
    resumeAttempts.current = 0;
    void resumeSavedRef.current();
  }, []);
  /** The server was reset (or refused the sign-in): drop the remembered sign-in and sign in again. Downloads stay listed. */
  const signInAgain = useCallback(() => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    const record = recovery;
    viewer.clear();
    setSavedState(undefined);
    setResumeFailure(undefined);
    setRecovery(undefined);
    setError('');
    void commit.clear().catch(() => {});
    if (record) void forgetNativeConnection(record.session).catch(() => {});
  }, [recovery, commit]);
  /** Leave the remembered sign-in for now (kept; sign-in offers to come back to it). */
  const useAnother = useCallback(() => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    viewer.clear();
    setSavedState(undefined);
    setResumeFailure('offline');
  }, []);

  const forgetSaved = useCallback(() => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    const record = recovery;
    setRecovery(undefined);
    setResumeFailure(undefined);
    offlineDownloads.adopt(undefined);
    setError('');
    void commit.clear().catch(() => {});
    if (record) {
      void forgetNativeConnection(record.session).catch(() => {});
      void profileAPI(record.serverUrl, record.session.accessToken).logout().catch(() => {});
    }
  }, [recovery, commit]);

  // Direct sign-in: inspect → confirm fingerprint → credentials → (profiles).
  const inspect = useCallback(async () => {
    if (busy) return;
    const op = beginBusy();
    setError('');
    const gen = ++generation.current;
    try {
      const found = await findDirectServer(directOrigin, nativeConnectionEnvironment, new AbortController().signal);
      if (gen === generation.current) { answered.current = {typed: directOrigin, address: found.address}; setPin(found.identity); }
    } catch (e) {
      setError(message(addressFailure(e, directOrigin)));
    } finally {
      endBusy(op);
    }
  }, [busy, directOrigin, beginBusy, endBusy]);

  const acceptDirect = useCallback(
    async (url: string, session: LocalSession, grant?: DirectPending, gen = generation.current, abandoned?: AbortSignal) => {
      if (session.viewer.authority !== 'local') throw new ShownError(activeI18n().t('signIn.chooseLocalProfile'));
      const cleanup = grant?.accountGrant && grant.accountSession ? profileAPI(grant.api.baseUrl, grant.accountSession.accessToken) : undefined;
      const old = viewer.getSnapshot();
      const routed = grant?.api ?? (old.session && old.serverUrl === url ? profileAPI(url, old.session.accessToken) : new HttpLocalApi(url, session.accessToken, nativeNetworkFetch));
      if (gen !== generation.current) throw changedWhileSigningIn(url);
      await rememberNativeSession(routed, session, nativeConnectionEnvironment, grant?.hosted, () => gen === generation.current);
      await commitSelectedViewer(url, session, undefined, false, gen, abandoned);
      // C45: the account-tier session is a separate family; it ends once a profile is chosen.
      if (cleanup) void cleanup.request('/v1/sessions/current', 'DELETE').catch(() => {});
    },
    [commitSelectedViewer],
  );

  // C45: what a direct sign-in (or its two-step completion) answered, and the step it leads to.
  const [directStep, setDirectStep] = useState<DirectStep>();
  const stepState = useRef<{connected: Awaited<ReturnType<typeof connectPairedServer>>; username: string; password: string; token?: string; session?: LocalSession; /** A Portico sign-in retries with the account, not a password. */ retry?: () => Promise<void>; /** A Portico sign-in's route source and re-admission profile, kept across its two-step verification. */ extra?: {hosted?: RememberedServer['hosted']; preferProfileId?: string}} | undefined>(undefined);
  const releaseStep = useCallback((signOutAccount: boolean) => {
    generation.current++;
    const held = stepState.current;
    stepState.current = undefined;
    setDirectStep(undefined);
    if (!held) return;
    // The step's account session is ended over its own connection, so that connection stays open
    // until the request has gone (NS-06); disposing it first would drop the request unsent.
    if (signOutAccount && held.session) {
      void profileAPI(held.connected.api.baseUrl, held.session.accessToken).request('/v1/sessions/current', 'DELETE').catch(() => {}).finally(() => held.connected.connection.dispose());
      return;
    }
    held.connected.connection.dispose();
  }, []);
  /** Returns 'held' when the connection now belongs to a pending step or profile choice, 'issued' when a viewer session was accepted. */
  const settleDirect = useCallback(async (result: DirectSignIn, connected: Awaited<ReturnType<typeof connectPairedServer>>, username: string, password: string, gen: number, extra: {hosted?: RememberedServer['hosted']; retry?: () => Promise<void>; preferProfileId?: string; /** The attempt's signal: abandoning it stops the new viewer's check (NS-08). */ signal?: AbortSignal} = {}): Promise<'held' | 'issued'> => {
    const local = connected.api;
    if (gen !== generation.current) throw changedWhileSigningIn(local.baseUrl);
    const outcome = directOutcome(result);
    if (result.kind === 'challenge') {
      stepState.current = {connected, username, password, token: result.token, retry: extra.retry, extra: {hosted: extra.hosted, preferProfileId: extra.preferProfileId}};
      setDirectStep('challenge');
      return 'held';
    }
    if (result.kind === 'device-pending') {
      // Nothing was issued: the owner approves this device, then the same sign-in is tried again.
      stepState.current = {connected, username, password, retry: extra.retry};
      setDirectStep('device-pending');
      return 'held';
    }
    if (outcome === 'new-password') {
      local.setAccessToken(result.session.accessToken);
      stepState.current = {connected, username, password, session: result.session};
      setDirectStep('password-change');
      return 'held';
    }
    if (outcome === 'choose-profile') {
      local.setAccessToken(result.session.accessToken);
      const grant: DirectPending = {api: local, snapshot: result.snapshot, accountGrant: true, accountSession: result.session, hosted: extra.hosted};
      // Re-admission: the same profile again, straight in, when it needs no PIN here.
      const same = extra.preferProfileId ? result.snapshot.profiles.find(p => p.id === extra.preferProfileId && !p.pinRequired) : undefined;
      if (same) {
        const selection = await selectDirectProfile(local, {authority: 'local', accountId: result.snapshot.account.id, serverId: result.snapshot.serverId}, same.id, {});
        if (gen !== generation.current) throw changedWhileSigningIn(local.baseUrl);
        await acceptDirect(local.baseUrl, selection.session, grant, gen, extra.signal);
        return 'issued';
      }
      setPending(grant);
      return 'held';
    }
    // 'viewer': this session is the viewer; it is kept, never ended.
    await rememberNativeSession(local, result.session, nativeConnectionEnvironment, extra.hosted, () => gen === generation.current);
    if (gen !== generation.current) throw changedWhileSigningIn(local.baseUrl);
    await acceptDirect(local.baseUrl, result.session, extra.hosted ? {api: local, accountGrant: false, hosted: extra.hosted} : undefined, gen, extra.signal);
    return 'issued';
  }, [acceptDirect]);

  const signInDirectRef = useRef<(username: string, password: string) => Promise<void>>(async () => {});
  // Changing any detail abandons the attempt under way (`cancelAttempt`): its requests are aborted,
  // whatever it answers later is ignored, and Sign in is ready again at once.
  const releaseAttempt = useCallback((live: {ops: Set<symbol>}) => { for (const op of live.ops) endBusy(op); live.ops.clear(); }, [endBusy]);
  const cancelAttempt = useCallback(() => {
    const live = attempt.current;
    if (!live) return;
    attempt.current = undefined;
    generation.current++;
    live.controller.abort();
    releaseAttempt(live);
  }, [releaseAttempt]);
  useEffect(() => () => attempt.current?.controller.abort(), []);

  const signInDirect = useCallback(
    async (username: string, password: string) => {
      // Signing in again replaces an attempt still under way.
      cancelAttempt();
      const mine = {controller: new AbortController(), ops: new Set<symbol>()};
      attempt.current = mine;
      const op = beginBusy();
      setError('');
      const gen = pin ? generation.current : ++generation.current;
      const {signal} = mine.controller;
      // The address lookup bounds each candidate itself; from the moment a server has answered,
      // the rest of the sign-in gets SIGN_IN_DEADLINE_MS to finish or say why it couldn't.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expire: (e: unknown) => void = () => {};
      const expired = new Promise<never>((_, reject) => { expire = reject; });
      let timedOut = false;
      const arm = () => { timer = setTimeout(() => { timedOut = true; expire(new ShownError(activeI18n().t('error.timeout'))); }, SIGN_IN_DEADLINE_MS); };
      let connected: Awaited<ReturnType<typeof connectPairedServer>> | undefined;
      let issued: LocalSession | undefined;
      let offered = false;
      const work = (async () => {
        try {
          // One page, one button: the server is looked up and its identity pinned as part of signing in.
          let identity = pin;
          if (!identity) {
            // Each likely address for what was typed is tried until one answers and proves an identity.
            let found: Awaited<ReturnType<typeof findDirectServer>>;
            try { found = await findDirectServer(directOrigin, nativeConnectionEnvironment, signal); }
            catch (e) { throw addressFailure(e, directOrigin); }
            if (gen !== generation.current) return;
            answered.current = {typed: directOrigin, address: found.address};
            identity = found.identity;
            setPin(identity);
          }
          arm();
          connected = await connectPairedServer(pinnedAddress(directOrigin), identity, nativeConnectionEnvironment, signal);
          const local = connected.api;
          const info = await local.system();
          if (gen !== generation.current) return;
          if (info.setupRequired) {
            // A phone or tablet sets it up here; a television says where it can be set up.
            if (Platform.isTV) throw new ShownError(activeI18n().t('setup.app.notSetUp'));
            holdSetup({api: local, name: info.name, hostedConfigured: info.hostedConfigured});
            offered = true;
            return;
          }
          const result = await directSignIn(local, username, password, signal);
          if (gen !== generation.current) {
            if (result.kind === 'signed-in') issued = result.session;
            return;
          }
          // The server accepted the credentials: remember the address and username (not the password)
          // so a sign-in that ends later reopens with both filled in.
          void rememberDirectSignIn(directOrigin, username).catch(() => {});
          // A viewer session straight from sign-in is signed out again if accepting it fails.
          if (result.kind === 'signed-in' && directOutcome(result) === 'viewer') issued = result.session;
          await settleDirect(result, connected, username, password, gen, {signal});
          offered = true;
        } finally {
          // Whatever wasn't handed on is released, even when the answer came after the attempt was abandoned.
          if (!offered && connected) {
            if (issued) {
              connected.api.setAccessToken(issued.accessToken);
              try {
                await connected.api.logout();
              } catch {}
            }
            connected.connection.dispose();
          }
        }
      })();
      try {
        await Promise.race([work, expired]);
      } catch (e) {
        // An abandoned attempt says nothing; the person has already moved on.
        if (attempt.current === mine) setError(message(e));
      } finally {
        clearTimeout(timer);
        if (attempt.current === mine) {
          attempt.current = undefined;
          // Out of time: its requests stop, and nothing it answers later may sign in.
          if (timedOut) {
            if (gen === generation.current) generation.current++;
            mine.controller.abort();
            releaseAttempt(mine);
          }
        }
        work.catch(() => {});
        endBusy(op);
      }
    },
    [pin, directOrigin, settleDirect, holdSetup, beginBusy, endBusy, cancelAttempt, releaseAttempt],
  );

  /** C45: the code for a two-step sign-in (authenticator or recovery code). */
  const completeChallenge = useCallback(async (code: string) => {
    const held = stepState.current;
    if (!held?.token || busy) return;
    const op = beginBusy();
    setError('');
    const gen = generation.current;
    try {
      const token = held.token;
      const result = await inTime(signal => completeDirectSignInChallenge(held.connected.api, token, code, signal));
      if (gen !== generation.current || stepState.current !== held) {
        if (result.kind === 'signed-in') { held.connected.api.setAccessToken(result.session.accessToken); void held.connected.api.logout().catch(() => {}); }
        return;
      }
      stepState.current = undefined;
      setDirectStep(undefined);
      try {
        await settleDirect(result, held.connected, held.username, held.password, gen, {...held.extra, retry: held.retry});
      } catch (e) {
        if (result.kind === 'signed-in') { held.connected.api.setAccessToken(result.session.accessToken); void held.connected.api.logout().catch(() => {}); }
        held.connected.connection.dispose();
        throw e;
      }
    } catch (e) {
      setError(message(e));
    } finally {
      endBusy(op);
    }
  }, [busy, settleDirect, beginBusy, endBusy]);

  /** C45: the server requires a new password; change it with the sign-in's session, then sign in with it. */
  const changeRequired = useCallback(async (newPassword: string) => {
    const held = stepState.current;
    if (!held?.session || busy) return;
    const op = beginBusy();
    setError('');
    let changed = false;
    const gen = generation.current;
    try {
      await inTime(signal => changeRequiredPassword(held.connected.api, held.password, newPassword, signal));
      changed = true;
    } catch (e) {
      setError(message(e));
    } finally {
      endBusy(op);
    }
    if (!changed || gen !== generation.current || stepState.current !== held) return;
    // The change ended every session of the account, the step's included.
    releaseStep(false);
    await signInDirectRef.current(held.username, newPassword);
  }, [busy, releaseStep, beginBusy, endBusy]);

  const retrySignIn = useCallback(async () => {
    const held = stepState.current;
    if (!held) return;
    releaseStep(false);
    if (held.retry) await held.retry();
    else await signInDirectRef.current(held.username, held.password);
  }, [releaseStep]);

  signInDirectRef.current = signInDirect;

  const connectDirect = useCallback(async () => {
    setError('');
    // Like signInDirect: an unpinned attempt is a new generation, so an address
    // edited (or a Continue pressed twice) while it is in flight is superseded
    // instead of pinning a stale identity and returning a stale connection.
    cancelAttempt();
    const gen = pin ? generation.current : ++generation.current;
    // It is the attempt under way until it answers, so a changed address abandons it too.
    const mine = {controller: new AbortController(), ops: new Set<symbol>()};
    attempt.current = mine;
    try {
      const {api, pin: identity, address} = await connectDirectServer({
        origin: directOrigin,
        pin,
        address: pin ? pinnedAddress(directOrigin) : undefined,
        env: nativeConnectionEnvironment,
        signal: mine.controller.signal,
        isCurrent: () => gen === generation.current && attempt.current === mine,
      });
      answered.current = {typed: directOrigin, address};
      setPin(identity);
      return api;
    } finally {
      if (attempt.current === mine) attempt.current = undefined;
    }
  }, [pin, directOrigin, cancelAttempt]);

  /** First run from a phone or tablet: connect to the server at the typed address and hold it for setup. */
  const beginSetup = useCallback(async () => {
    if (busy) return false;
    const op = beginBusy();
    setError('');
    const gen = pin ? generation.current : ++generation.current;
    try {
      const found = await connectDirectServer({origin: directOrigin, pin, address: pin ? pinnedAddress(directOrigin) : undefined, env: nativeConnectionEnvironment, signal: new AbortController().signal, isCurrent: () => gen === generation.current, allowSetup: true});
      answered.current = {typed: directOrigin, address: found.address};
      setPin(found.pin);
      // Set up in the meantime (from a browser, say): there is nothing to do here but sign in.
      if (!found.setup) { found.api.getRouteConnection()?.dispose(); return false; }
      holdSetup({api: found.api, name: found.setup.name, hostedConfigured: found.setup.hostedConfigured});
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      endBusy(op);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pin, directOrigin, holdSetup]);

  const acceptQuickConnect = useCallback(async (local: HttpLocalApi, issued: LocalSession) => {
    const gen = ++generation.current;
    const op = beginBusy();
    setError('');
    try {
      await rememberNativeSession(local, issued, nativeConnectionEnvironment, undefined, () => gen === generation.current);
      await acceptDirect(local.baseUrl, issued, undefined, gen);
    } catch (e) {
      setError(message(e));
      throw e;
    } finally {
      endBusy(op);
    }
  }, [acceptDirect, beginBusy, endBusy]);

  /** Setup created the owner: the session it issued is this device's sign-in, on the connection setup used. */
  const finishSetup = useCallback(async (issued: LocalSession) => {
    const target = setupRef.current;
    if (!target) return;
    await acceptQuickConnect(target.api, issued);
    holdSetup(undefined, false);
  }, [acceptQuickConnect, holdSetup]);

  const chooseProfile = useCallback(
    async (profileId: string, profilePin?: string) => {
      if (!pending) return;
      const gen = ++generation.current;
      clearActivity();
      const snapshot = pending.snapshot ?? (await (async () => {
        const current = viewer.getSnapshot();
        return current.session ? undefined : undefined;
      })());
      const op = beginBusy();
      setError('');
      let issued: LocalSession | undefined;
      try {
        const serverId = snapshot?.serverId ?? viewer.getSnapshot().session?.viewer.serverId ?? pending.api.getRouteConnection()?.pin.serverId ?? '';
        const accountId = snapshot?.account.id ?? viewer.getSnapshot().session?.viewer.accountId ?? '';
        const selection = await inTime(signal => selectDirectProfile(pending.api, {authority: 'local', accountId, serverId}, profileId, {pin: profilePin}, signal));
        issued = selection.session;
        await acceptDirect(pending.api.baseUrl, selection.session, pending, gen);
      } catch (e) {
        // The server made a viewer session this device won't use (left, or refused before it was
        // handed over): end it, unless it is the one now in use (NS-07).
        if (issued && viewer.getSnapshot().session?.sessionFamilyId !== issued.sessionFamilyId) void profileAPI(pending.api.baseUrl, issued.accessToken).logout().catch(() => {});
        if (gen === generation.current) setError(message(e));
      } finally {
        endBusy(op);
      }
    },
    [pending, acceptDirect, beginBusy, endBusy],
  );

  const cancelPending = useCallback(() => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    // C45: the account-tier session is its own family; abandoning the choice signs it out.
    if (pending?.accountGrant && pending.accountSession) void profileAPI(pending.api.baseUrl, pending.accountSession.accessToken).request('/v1/sessions/current', 'DELETE').catch(() => {});
    setPending(undefined);
  }, [pending]);

  const openProfileChooser = useCallback(() => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    const current = viewer.getSnapshot();
    if (current.session?.viewer.authority !== 'local' || !hasRealOrigin(api)) return;
    // QA (switch profile): the live API, with its route connection and its renewed token. A fresh
    // transport built from the stored token failed once that token had aged out.
    setPending({api, accountGrant: false});
  }, [api]);

  /* Portico Account members (Spec — Hosted at Scale): the account service proves who the person
     is; the server decides and answers exactly as for a password (its own profiles, PINs and
     device approval). The ticket attach and the account's profile chooser are gone. */
  const hostedApi = useMemo<HostedRequestApi>(() => ({
    request: async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => {
      if (!credentials) throw new ShownError(activeI18n().t('web.portico.signInFirst'));
      const live = await credentials.accessSession();
      return new HttpLocalApi(hostedUrl, live.accessToken, nativeNetworkFetch).request<T>(path, method, body, signal);
    },
  }), [credentials]);
  const porticoFailure = useRef<PorticoFailure | undefined>(undefined);
  const porticoConnectRef = useRef<(server: HostedServer, options?: {kind?: 'interactive' | 'automatic'; preferProfileId?: string}) => Promise<PorticoOutcome>>(async () => 'failed');
  const porticoConnect = useCallback(async (server: HostedServer, options: {kind?: 'interactive' | 'automatic'; preferProfileId?: string} = {}): Promise<PorticoOutcome> => {
    const live = credentials?.getSnapshot().session;
    if (!credentials || !live) { setError(activeI18n().t('web.portico.signInFirst')); return 'failed'; }
    const kind = options.kind ?? 'interactive';
    const gen = ++generation.current;
    const op = beginBusy();
    setError('');
    let connected: Awaited<ReturnType<typeof connectHostedServer>> | undefined;
    let kept = false;
    let stage: PorticoStage = 'route';
    porticoFailure.current = undefined;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    try {
      connected = await connectHostedServer(server, nativeHostedSource(hostedUrl, credentials, live.account.id), nativeConnectionEnvironment, abort.signal).catch(e => { throw routeRefusal(e); });
      stage = 'signIn';
      // The server's challenge is bound to this installation's ID, sent with it.
      await installationReady;
      const result = await porticoSignIn(hostedApi, hostedUrl, connected.api, server.id, {kind, signal: abort.signal, crypto: nativeConnectionEnvironment.crypto});
      if (gen !== generation.current) throw changedWhileSigningIn(server.name);
      await settleDirect(result, connected, live.account.username, '', gen, {hosted: connected.hosted, retry: () => porticoConnectRef.current(server, options).then(() => {}), preferProfileId: options.preferProfileId});
      kept = true;
      // The server this account opened last reopens by itself after the next sign-in.
      void lastPorticoServer.write(live.account.id, server.id).catch(() => {});
      return 'done';
    } catch (e) {
      if (kind === 'automatic') throw e;
      porticoFailure.current = classifyPorticoFailure(e, stage, server.name, present(e, 'sign-in').category);
      if (__DEV__) porticoFailure.current = {...porticoFailure.current, detail: [stage, (e as {status?: unknown})?.status, (e as {code?: unknown})?.code, String(e)].filter(v => v !== undefined && v !== '').join(' · ')}; // lint-raw-errors-allow: __DEV__-only diagnostics
      if (__DEV__) console.warn('[portico] sign-in failed', stage, (e as {status?: unknown})?.status, (e as {code?: unknown})?.code, String(e)); // lint-raw-errors-allow: __DEV__-only diagnostics
      if (isAccessRefused(e)) {
        dropServer(server.id);
        // Portico drops the server from this account's list too; look now rather than at the next check.
        checkServersNow();
        setError(activeI18n().t('web.portico.noAccess', {server: server.name}));
        return 'refused';
      }
      if (isClockSkew(e)) { setError(activeI18n().t('portico.clockSkew', {server: server.name})); return 'failed'; }
      setError(message(e));
      const p = present(e, 'sign-in');
      return p.category === 'unreachable' || p.category === 'offline' || p.category === 'timeout' ? 'unreachable' : 'failed';
    } finally {
      clearTimeout(timer);
      if (!kept && connected) connected.connection.dispose();
      endBusy(op);
    }
  }, [credentials, hostedApi, settleDirect, dropServer, checkServersNow, beginBusy, endBusy]);
  porticoConnectRef.current = porticoConnect;
  /** The shell's landing: sign in to one server and say exactly what failed, if anything. */
  const porticoOpen = useCallback(async (server: HostedServer): Promise<PorticoFailure | undefined> => {
    const outcome = await porticoConnect(server);
    return outcome === 'done' ? undefined : porticoFailure.current ?? {kind: 'other', server: server.name};
  }, [porticoConnect]);
  const porticoLastServer = useCallback(async (): Promise<string | undefined> => {
    const id = credentials?.getSnapshot().session?.account.id;
    return id ? lastPorticoServer.read(id).catch(() => undefined) : undefined;
  }, [credentials]);

  /** An invitation link as a Portico Account: the inviting server checks the code, makes the
   * membership and answers with the sign-in, so this device has the server at once. */
  const acceptPortico = useCallback(async (origin: string, code: string): Promise<boolean> => {
    const live = credentials?.getSnapshot().session;
    if (!credentials || !live) { setError(activeI18n().t('web.portico.signInFirst')); return false; }
    const gen = ++generation.current;
    const op = beginBusy();
    setError('');
    let connected: Awaited<ReturnType<typeof connectPairedServer>> | undefined;
    let kept = false;
    try {
      const {address, identity} = await findDirectServer(origin, nativeConnectionEnvironment, new AbortController().signal).catch(e => { throw addressFailure(e, origin); });
      connected = await connectPairedServer(address, identity, nativeConnectionEnvironment, new AbortController().signal);
      setPin(identity);
      await installationReady;
      const result = await acceptPorticoInvitation(hostedApi, hostedUrl, connected.api, identity.serverId, code, undefined, nativeConnectionEnvironment.crypto);
      if (gen !== generation.current) throw changedWhileSigningIn(origin);
      // The server told Portico at once: from here the server is one of this account's, reached
      // through its Portico routes and kept as a Portico sign-in (not a second, direct entry).
      const listed = await hostedApi.request<{items?: HostedServer[]}>('/v1/servers').then(list => list.items?.find(s => s.id === identity.serverId), () => undefined);
      if (listed) {
        const routed = await connectHostedServer(listed, nativeHostedSource(hostedUrl, credentials, live.account.id), nativeConnectionEnvironment, new AbortController().signal).catch(() => undefined);
        if (routed) {
          connected.connection.dispose();
          connected = routed;
          await settleDirect(result, routed, live.account.username, '', gen, {hosted: routed.hosted, retry: () => porticoConnectRef.current(listed).then(() => {})});
          kept = true;
          checkServersNow();
          return true;
        }
      }
      // Portico hasn't listed it yet: the direct route, and the account's next check adds it.
      // Waiting for the owner to approve this device: the retry signs in with the account again.
      const retry = async (): Promise<void> => {
        const fresh = await connectPairedServer(address, identity, nativeConnectionEnvironment, new AbortController().signal);
        try {
          await settleDirect(await porticoSignIn(hostedApi, hostedUrl, fresh.api, identity.serverId, {crypto: nativeConnectionEnvironment.crypto}), fresh, live.account.username, '', generation.current, {retry});
        } catch (e) { fresh.connection.dispose(); throw e; }
      };
      await settleDirect(result, connected, live.account.username, '', gen, {retry});
      kept = true;
      // The server tells the account service; this account's other devices learn at their next check.
      checkServersNow();
      return true;
    } catch (e) {
      setError(message(e));
      throw e;
    } finally {
      if (!kept && connected) connected.connection.dispose();
      endBusy(op);
    }
  }, [credentials, hostedApi, settleDirect, checkServersNow, beginBusy, endBusy]);

  /* A session the server's move to its own membership ended (migration 0120, `session_migrated`):
     re-admit silently with the Portico Account and the same profile. Only a refusal, or no Portico
     Account session, opens the sign-in screen. */
  const readmitRef = useRef<(record: SelectedViewerRecord) => Promise<void>>(async () => {});
  readmitRef.current = async (record: SelectedViewerRecord) => {
    const serverId = record.session.viewer.serverId;
    try {
      if (!credentials?.getSnapshot().session) throw new Error('No Portico Account session.');
      let server = serversRef.current.find(s => s.id === serverId);
      if (!server) {
        const list = await hostedApi.request<{items: HostedServer[]}>('/v1/servers');
        server = list.items.find(s => s.id === serverId);
      }
      if (!server) throw new Error('This server is no longer in your list.');
      await porticoConnect(server, {kind: 'automatic', preferProfileId: record.session.viewer.profileId});
      setError('');
      setSavedState(undefined);
      setResumeFailure(undefined);
      setRecovery(undefined);
      // The profile needs its PIN here: the old viewer steps aside and the server's chooser shows.
      if (viewer.getSnapshot().session?.sessionFamilyId === record.session.sessionFamilyId) { stopRefresh(); viewer.clear(); setApi(new HttpLocalApi(PLACEHOLDER_ORIGIN)); }
    } catch (e) {
      if (isAccessRefused(e)) { dropServer(serverId); checkServersNow(); signInNeeded.current('noAccess', record); return; }
      signInNeeded.current('ended', record);
    }
  };

  const activationApproved = useCallback(
    async (session: HostedSession, accept: () => boolean): Promise<boolean> => {
      if (!credentials) return false;
      // Left before it was adopted: the approval is spent, and its session is ended rather than kept.
      const retire = () => { if (session.refreshToken) void new HttpCredentialApi(hostedUrl, nativeNetworkFetch).revoke(session.refreshToken).catch(() => {}); };
      if (!accept()) { retire(); return false; }
      try {
        await new HttpLocalApi(hostedUrl, session.accessToken, nativeNetworkFetch).request('/v1/me');
        if (!accept()) { retire(); return false; }
        await credentials.adopt(session);
        if (!accept()) { await credentials.logoutIfCurrent({accountId: session.account.id, familyId: session.familyId}); return false; }
        return true;
      } catch (e) {
        setError(message(e));
        throw e;
      }
    },
    [credentials],
  );

  const signOut = useCallback(() => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    setSignInNote(undefined);
    // OS-02/03: nothing this viewer indexed stays in Spotlight or Handoff after they leave.
    clearActivity();
    attachment.current();
    const current = viewer.getSnapshot();
    stopRefresh();
    if (credentials && (hosted || current.session?.viewer.authority === 'hosted')) void credentials.logout().catch(e => setError(message(e)));
    setHosted(undefined);
    setAttachedServer(undefined);
    void commit.clear().catch(() => setError(activeI18n().t('signIn.cleanupSignedOut')));
    setRecovery(undefined);
    // Signing out withdraws the offline list too: the files stay, but nobody is
    // named as their owner until that viewer signs in again.
    offlineDownloads.adopt(undefined);
    cancelPending();
    void api.logout().catch(() => {});
    if (current.session) void forgetNativeConnection(current.session).catch(() => {});
    viewer.clear();
    setSystem(undefined);
    setPin(undefined);
    setApi(new HttpLocalApi(PLACEHOLDER_ORIGIN));
  }, [api, cancelPending, commit, credentials, hosted, setAttachedServer, setHosted, stopRefresh]);
  const leaveServer = useCallback(async () => {
    generation.current++;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    const current = viewer.getSnapshot();
    const serverId = current.session?.viewer.serverId;
    if (!credentials?.getSnapshot().session || !serverId) throw new ShownError(activeI18n().t('web.portico.signInFirst'));
    await leavePorticoServer(hostedApi, hostedUrl, serverId);
    dropServer(serverId);
    checkServersNow();
    // This device's sign-in there goes too; the Portico Account stays signed in.
    clearActivity();
    stopRefresh();
    void api.logout().catch(() => {});
    void commit.clear().catch(() => {});
    if (current.session) void forgetNativeConnection(current.session).catch(() => {});
    void knownDirectServers.forget(serverId).catch(() => {});
    offlineDownloads.adopt(undefined);
    setAttachedServer(undefined);
    viewer.clear();
    setSystem(undefined);
    setPin(undefined);
    setApi(new HttpLocalApi(PLACEHOLDER_ORIGIN));
  }, [api, commit, credentials, hostedApi, dropServer, checkServersNow, stopRefresh, setAttachedServer]);
  const acceptCustody = useCallback(async () => {
    const serverId = viewer.getSnapshot().session?.viewer.serverId;
    if (!credentials?.getSnapshot().session || !serverId) throw new ShownError(activeI18n().t('web.portico.signInFirst'));
    await installationReady;
    await acceptPorticoCustody(hostedApi, hostedUrl, api, serverId, undefined, nativeConnectionEnvironment.crypto);
  }, [api, credentials, hostedApi]);
  const transferOwnership = useCallback(async (accountId: string, expectedRevision: number) => {
    const serverId = viewer.getSnapshot().session?.viewer.serverId;
    if (!credentials?.getSnapshot().session || !serverId) throw new ShownError(activeI18n().t('web.portico.signInFirst'));
    await installationReady;
    await transferPorticoOwnership(hostedApi, hostedUrl, api, serverId, accountId, expectedRevision, undefined, nativeConnectionEnvironment.crypto);
  }, [api, credentials, hostedApi]);
  // The server refused this device's sign-in (revoked, reused, device removed): the Keychain record is already cleared.
  // The server refused this device's sign-in (revoked, reused, device removed): the Keychain record is already cleared.
  refreshEnded.current = error => {
    const current = viewer.getSnapshot();
    // Migration 0120 ended this family while the app was open: re-admit, as at launch.
    if (isSessionMigrated(error) && current.session && current.serverUrl) { void readmitRef.current({version: 1, serverUrl: current.serverUrl, session: current.session}); return; }
    signInNeeded.current('ended');
  };
  /**
   * Back to sign-in because this sign-in can't be used any more. Unlike Sign out, a Portico Account
   * stays signed in (its server chooser opens), the downloads stay listed, and the direct form opens
   * with the server's address filled in. What can't be used is cleared: the saved selection and the
   * server connection record.
   */
  signInNeeded.current = (reason, record) => {
    generation.current++;
    const current = viewer.getSnapshot();
    const session = record?.session ?? current.session;
    const serverUrl = record?.serverUrl ?? current.serverUrl;
    clearTimeout(resumeRetry.current);
    resumeWake = undefined;
    clearActivity();
    attachment.current();
    stopRefresh();
    setAttachedServer(undefined);
    void commit.clear().catch(() => {});
    setRecovery(undefined);
    setSavedState(undefined);
    setResumeFailure(undefined);
    cancelPending();
    if (session) void forgetNativeConnection(session).catch(() => {});
    viewer.clear();
    setSystem(undefined);
    setPin(undefined);
    setApi(new HttpLocalApi(PLACEHOLDER_ORIGIN));
    const host = serverUrl ? friendlyHostOf(serverUrl) : '';
    // A Portico Account member's session is server-local (Spec — Hosted at Scale); it goes back to the
    // account's chooser, not the direct form, while the account is signed in and lists the server.
    const member = !!session && !!credentials?.getSnapshot().session && serversRef.current.some(s => s.id === session.viewer.serverId);
    const authority = session?.viewer.authority === 'hosted' || member ? 'hosted' : 'local';
    if (authority === 'local' && serverUrl) setDirectOrigin(serverUrl.replace(/^https?:\/\//, '').replace(/\/+$/, ''));
    setSignInHint({authority, reason});
    // One quiet note for every ending, in web's words (the platforms agree).
    setSignInNote(activeI18n().t('web.signIn.ended', {server: host || activeI18n().t('servers.fallbackName')}));
  };
  const clearSignInHint = useCallback(() => setSignInHint(undefined), []);

  const value = useMemo<SessionValue>(
    () => ({
      phase: restoring ? 'restoring' : scope.phase === 'ready' ? 'ready' : 'signedOut',
      api,
      serverUrl: scope.serverUrl,
      session: scope.session,
      system,
      hostedUrl,
      credentials,
      hosted,
      servers,
      directoryStatus,
      directoryError,
      refreshServers,
      attachedServer,
      recovery,
      resumeFailure,
      saved: savedState && recovery ? {state: savedState, host: friendlyHostOf(recovery.serverUrl), retry: retrySaved, signInAgain, useAnother} : undefined,
      outsideHours: hoursRefused && scope.phase === 'ready' && !savedState ? {host: scope.serverUrl ? friendlyHostOf(scope.serverUrl) : undefined, retry: retryRenewal} : undefined,
      signInHint,
      clearSignInHint,
      signInNote: scope.phase === 'ready' ? undefined : signInNote,
      openSaved,
      deviceReset,
      error,
      busy,
      clearError: () => setError(''),
      resumeSaved,
      forgetSaved,
      direct: {
        origin: directOrigin,
        setOrigin: value => {
          setDirectOrigin(value);
          setPin(undefined);
          holdSetup(undefined);
          ++generation.current;
        },
        pin,
        inspect,
        resetPin: () => setPin(undefined),
        signIn: signInDirect,
        cancel: cancelAttempt,
        connect: connectDirect,
        acceptSession: acceptQuickConnect,
        pending,
        step: directStep,
        completeChallenge,
        changeRequiredPassword: changeRequired,
        cancelStep: () => releaseStep(true),
        setup: setupTarget,
        beginSetup,
        cancelSetup: () => holdSetup(undefined),
        finishSetup,
        retrySignIn,
        chooseProfile,
        cancelPending,
        openProfileChooser,
      },
      portico: {connect: server => porticoConnect(server), open: porticoOpen, lastServer: porticoLastServer, acceptInvitation: acceptPortico, refreshServers, checkedAt: serversCheckedAt, leave: leaveServer, transferOwnership, acceptCustody},
      activationApproved,
      signOut,
    }),
    [hoursRefused, retryRenewal, deviceReset, savedState, signInHint, clearSignInHint, signInNote, openSaved, retrySaved, signInAgain, useAnother, restoring, scope, api, system, credentials, hosted, servers, directoryStatus, directoryError, refreshServers, attachedServer, recovery, resumeFailure, error, busy, resumeSaved, forgetSaved, directOrigin, pin, inspect, signInDirect, cancelAttempt, connectDirect, acceptQuickConnect, setupTarget, beginSetup, holdSetup, finishSetup, pending, directStep, completeChallenge, changeRequired, releaseStep, retrySignIn, chooseProfile, leaveServer, transferOwnership, acceptCustody, porticoOpen, porticoLastServer, cancelPending, openProfileChooser, porticoConnect, acceptPortico, serversCheckedAt, activationApproved, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}
