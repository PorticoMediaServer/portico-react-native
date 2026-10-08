// The shared `app/session.tsx` introduces every television as `tvos`; this one is `vega`.
import {setInstallationIdentity as setIdentity, type InstallationIdentity} from '../../../../../../../packages/client-core/src/installation';
import {reportedPlatform} from '../../../../platform';

export * from '../../../../../../../packages/client-core/src/installation';

export function setInstallationIdentity(identity: InstallationIdentity | undefined): void {
  setIdentity(identity ? {...identity, platform: reportedPlatform(identity.platform)} : undefined);
}
