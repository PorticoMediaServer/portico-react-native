// The shared `app/device.tsx` announces every television as `tvos`; this one is `vega`.
import {announceDevice as announce, type DeviceDescription, type IdentityClient} from '../../../../../../../packages/client-core/src/identity-client';
import {reportedPlatform} from '../../../../platform';

export * from '../../../../../../../packages/client-core/src/identity-client';

export function announceDevice(identity: IdentityClient, device: DeviceDescription, sessionFamilyId: string): ReturnType<typeof announce> {
  return announce(identity, {...device, platform: reportedPlatform(device.platform)}, sessionFamilyId);
}
