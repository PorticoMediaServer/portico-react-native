/**
 * How this app names its platform to servers and to people. The shared code says `tvos` for
 * every television (it was written when the Apple TV was the only one); the overrides in
 * `src/overrides` put these in its place.
 */
export const platformId = 'vega';
/** What an approval screen calls this device when it has no name of its own. */
export const deviceKindName = 'Fire TV';

/** The platform to report in place of the shared code's: its `tvos` is this television. */
export const reportedPlatform = (platform: string): string => (platform === 'tvos' ? platformId : platform);
