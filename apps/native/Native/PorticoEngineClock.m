#import "PorticoEngineClock.h"

NSNotificationName const PorticoEngineClockChangedNotification = @"PorticoEngineClockChanged";

static __weak id<PorticoEngineClockSource> PorticoActiveEngineClock;

@implementation PorticoEngineClock
+ (id<PorticoEngineClockSource>)active { return PorticoActiveEngineClock; }
+ (void)setActive:(id<PorticoEngineClockSource>)active {
  if (PorticoActiveEngineClock == active) return;
  PorticoActiveEngineClock = active;
  [self changed];
}
+ (void)changed {
  if (NSThread.isMainThread) [NSNotificationCenter.defaultCenter postNotificationName:PorticoEngineClockChangedNotification object:nil];
  else dispatch_async(dispatch_get_main_queue(), ^{ [NSNotificationCenter.defaultCenter postNotificationName:PorticoEngineClockChangedNotification object:nil]; });
}
@end
