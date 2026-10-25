import {parseLicenceData, type LicenceData} from '../../../../packages/client-core/src/presentation/licences';
import {devicePlatform} from '../bridge/device-platform';

/** Android, Android TV and Fire TV: android.json (see load.ts). */
export function loadLicences(): LicenceData | undefined {
  return parseLicenceData(require('../../licences/generated/android.json'));
}

/** The Fire TV build (no Google Play services) or the Google one, for the libraries only one carries. */
export function licenceVariant(): string {
  return devicePlatform === 'firetv' ? 'firetv' : 'google';
}
