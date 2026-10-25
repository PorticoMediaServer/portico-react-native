import {isAccessRefused, isClockSkew} from '../../../../../packages/client-core/src/portico-servers';

/** Only the server's typed membership refusal selects connect#4c. Other 403s,
 * expired sessions and local authority retirement keep their own error flow. */
export function directoryAccessRefused(error: unknown): boolean {
  return isAccessRefused(error);
}

/** A typed clock answer is distinct from credential refusal or reachability. */
export function directoryClockSkew(error: unknown): boolean {return isClockSkew(error);}
