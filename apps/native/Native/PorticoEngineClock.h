#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * The clock of a video engine other than the AVPlayer controller.
 *
 * `PorticoSystemMedia` (Now Playing, the lock screen, remote commands) reads the playing video's
 * position and rate. For AVPlayer it reads them from the player itself. A second engine (mpv)
 * has no `AVPlayer`, so while it holds a playback lease it registers itself here and the system
 * surfaces read the same four facts from it. Everything is called on the main queue.
 */
@protocol PorticoEngineClockSource <NSObject>
/** Seconds in the media's own timeline, or NaN when there is no position yet. */
- (double)engineClockPosition;
/** The rate the picture is moving at now: 0 while paused, seeking or waiting for data. */
- (double)engineClockRate;
/** The media's length in seconds, or 0 when it is not known. */
- (double)engineClockDuration;
@end

@interface PorticoEngineClock : NSObject
/** The engine that owns the video on screen, or nil when AVPlayer does. Held weakly. */
@property (class, nonatomic, weak, nullable) id<PorticoEngineClockSource> active;
/** Tells listeners that the active engine's rate or position jumped (play, pause, a seek). */
+ (void)changed;
@end

/** Posted on the main queue by `+changed` and when `active` is set or cleared. */
extern NSNotificationName const PorticoEngineClockChangedNotification;

NS_ASSUME_NONNULL_END
