// The shared `app/receiver.tsx` registers every television player as `tvos`; this one is `vega`.
import {ReceiverHost as Host} from '../../../../../../../packages/client-core/src/remote-playback';
import {reportedPlatform} from '../../../../platform';

export * from '../../../../../../../packages/client-core/src/remote-playback';

type Options = ConstructorParameters<typeof Host>[0];

export class ReceiverHost extends Host {
  constructor(options: Options) {
    super({...options, device: {...options.device, platform: reportedPlatform(options.device.platform) as Options['device']['platform']}});
  }
}
