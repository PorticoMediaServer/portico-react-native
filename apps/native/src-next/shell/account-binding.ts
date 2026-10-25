import type {LocalSession} from '../../../../packages/client-core/src';
import type {AppServerSession} from '../../../../packages/client-core/src/app-sessions';
import type {ServerPin} from '../../../../packages/client-core/src/route-identity';
import type {DirectSnapshot} from '../../../../packages/client-core/src/profile-management';

const cancelled = () => Object.assign(new Error('native_shell_cancelled'), {name: 'AbortError'});
const changed = () => Object.assign(new Error('native_shell_account_binding_changed'), {code: 'identity_mismatch'});

export type NativeShellAccountBinding = Readonly<{
  /** Identity linkage only. Roles, profiles and menus still come from this server. */
  hostedAccountId?: string;
  current: () => boolean;
  assertCurrent: () => Promise<void>;
  assertAccount: (snapshot: DirectSnapshot) => void;
}>;

/** Portico sign-in issues a local server session. Bind its real account snapshot to
 * the original protected connection, without contacting or depending on Hosted. */
export function createNativeShellAccountBinding(selected: AppServerSession, session: LocalSession, options: {
  current: () => boolean;
  session: () => LocalSession | undefined;
  pin: () => ServerPin | undefined;
  readSelected: () => Promise<AppServerSession | undefined>;
}): NativeShellAccountBinding {
  const connection = selected.connection;
  const pin = Object.freeze({...connection.pin}), viewer = Object.freeze({...session.viewer});
  const family = session.sessionFamilyId, horizon = session.authorizationHorizon;
  const device = session.deviceId, installation = session.installationId;
  const minimumGeneration = BigInt(session.tokenGeneration);
  const signIn = selected.signIn, resetOwner = selected.resetFileOwner;
  const origin = connection.logicalOrigin, selectionId = connection.selectionId;
  const hosted = connection.hosted && Object.freeze({origin: connection.hosted.origin, accountId: connection.hosted.accountId});
  const samePin = (value: ServerPin | undefined) => !!value && value.serverId === pin.serverId
    && value.publicKey === pin.publicKey && value.fingerprint === pin.fingerprint;
  const sameSession = (value: LocalSession | undefined) => !!value && value.viewer.authority === 'local'
    && value.sessionFamilyId === family && value.authorizationHorizon === horizon
    && value.deviceId === device && value.installationId === installation
    && (['serverId', 'accountId', 'profileId', 'authority', 'role'] as const).every(key => value.viewer[key] === viewer[key])
    && BigInt(value.tokenGeneration) >= minimumGeneration;
  const sameSelection = (value: AppServerSession | undefined) => !!value && value.signIn === signIn
    && value.resetFileOwner === resetOwner && value.connection.logicalOrigin === origin
    && value.connection.selectionId === selectionId && samePin(value.connection.pin) && sameSession(value.connection.session)
    && (hosted ? value.connection.hosted?.origin === hosted.origin && value.connection.hosted.accountId === hosted.accountId : !value.connection.hosted);
  const current = () => options.current() && samePin(options.pin()) && sameSession(options.session());
  return Object.freeze({...(hosted ? {hostedAccountId: hosted.accountId} : {}), current,
    assertCurrent: async () => {
      if (!current()) throw cancelled();
      const latest = await options.readSelected();
      if (!current()) throw cancelled();
      if (!sameSelection(latest)) throw changed();
    },
    assertAccount: (snapshot: DirectSnapshot) => {
      if (!current()) throw cancelled();
      if (snapshot.authority !== 'local' || snapshot.serverId !== viewer.serverId
        || snapshot.account.id !== viewer.accountId || snapshot.account.disabled || snapshot.account.role !== viewer.role
        || hosted && snapshot.account.hostedAccountId !== hosted.accountId) throw changed();
    },
  });
}
