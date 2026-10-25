/** A verified original setup ended without granting an owner. Cancellation is
 * deliberately distinct from an authenticated Hosted denial. */
export class NativeSetupEnded extends Error {
  constructor(readonly reason: 'declined' | 'cancelled') {super('native_setup_ended');}
}
