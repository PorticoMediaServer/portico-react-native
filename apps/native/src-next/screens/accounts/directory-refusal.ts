import {isAccessRefused} from '../../../../../packages/client-core/src/portico-servers';

/** Only the server's typed membership refusal selects connect#4c. Other 403s,
 * expired sessions and local authority retirement keep their own error flow. */
export function directoryAccessRefused(error: unknown): boolean {
  return isAccessRefused(error);
}
