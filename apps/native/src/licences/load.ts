import {Platform} from 'react-native';
import {parseLicenceData, type LicenceData} from '../../../../packages/client-core/src/presentation/licences';

/**
 * The open-source licence list of this build (`apps/native/scripts/licences.mts`). iPhone, iPad and
 * Apple TV read apple.json; Android reads android.json (`load.android.ts`); Vega replaces this
 * file (`apps/vega/src/overrides/native/licences/load.ts`). Metro bundles only the file of the
 * platform it builds for. The list is required when Settings › About › Open-source licenses
 * opens, not when the app starts.
 */
export function loadLicences(): LicenceData | undefined {
  return parseLicenceData(require('../../licences/generated/apple.json'));
}

/** Which build this is, for the parts only some builds carry (the Google Cast SDK is only in the iPhone and iPad app). */
export function licenceVariant(): string {
  return Platform.isTV ? 'tvos' : 'ios';
}
