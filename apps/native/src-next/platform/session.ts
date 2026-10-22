import {createCredentials} from './credentials';
import {nativeViewerStorage, profileInstallation} from './profile-trust';
import {prepareSecureRecords} from './secure-records';

/** Prepare secure records before reading either installation metadata or a remembered viewer. */
export async function readNativeSession() {
  const recovered = await prepareSecureRecords();
  const [installation, viewer] = await Promise.all([profileInstallation(), nativeViewerStorage.read()]);
  return {recovered, installation, viewer};
}
export {createCredentials};
export {nativeViewerStorage, profileInstallation};
export {restoreNativeConnection, forgetNativeConnection, trackNativeConnection, nativeNetworkFetch, nativeConnectionEnvironment} from './server-connections';
