import {ApiError} from '../../../../packages/client-core/src/index';

/**
 * Once a server tells Portico that an account's membership ended, Portico refuses that account the
 * server's routes (403) before the server itself is ever asked. That is the same answer as the
 * server's own `access_refused`: drop the server and say so, rather than a generic failure.
 */
export function routeRefusal(error: unknown): unknown {
  return error instanceof ApiError && error.status === 403 ? new ApiError(403, 'access_refused', error.message) : error;
}
