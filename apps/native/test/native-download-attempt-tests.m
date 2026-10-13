#import <Foundation/Foundation.h>
#import "../Native/PorticoDownloadAttempt.h"

int main(void) {
  @autoreleasepool {
    NSMutableDictionary *entry = [@{@"state": @"downloading", @"taskIdentifier": @22, @"grantUrl": @"https://server/grant/new", @"bytesDone": @0} mutableCopy];
    // All four asynchronous mutation paths (progress, finish, error/resume,
    // policy-cancellation) share this production guard. Deliver an old attempt
    // after the replacement published its identity: no manifest or bytes change.
    for (NSString *callback in @[@"progress", @"finish", @"error-resume", @"wifi-pause"]) {
      NSCAssert(!PorticoDownloadAcceptsTask(entry, 21), @"stale %@ accepted", callback);
    }
    NSCAssert(PorticoDownloadAcceptsTask(entry, 22), @"current task rejected");
    NSData *saved = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
    NSDictionary *reopened = [NSJSONSerialization JSONObjectWithData:saved options:0 error:nil];
    NSCAssert(!PorticoDownloadAcceptsTask(reopened, 21) && PorticoDownloadAcceptsTask(reopened, 22), @"restart lost identity");
    entry[@"state"] = @"ready";
    NSCAssert(!PorticoDownloadAcceptsTask(entry, 22), @"late progress degrades completed file");
    NSCAssert(!PorticoDownloadAcceptsTask(nil, 22), @"removed entry accepts callback");
    NSMutableDictionary *damaged = [@{@"state": @"downloading"} mutableCopy];
    NSCAssert(!PorticoDownloadAcceptsTask(damaged, 21), @"missing task identity accepts callback");
    entry[@"cellularAllowed"] = @YES;
    NSCAssert(PorticoDownloadResumePolicyMatches(entry, YES), @"same cellular policy cannot resume");
    NSCAssert(!PorticoDownloadResumePolicyMatches(entry, NO), @"old cellular request can resume under Wi-Fi only");
    entry[@"cellularAllowed"] = @NO;
    NSCAssert(PorticoDownloadResumePolicyMatches(entry, NO), @"same Wi-Fi policy cannot resume");
    [entry removeObjectForKey:@"cellularAllowed"];
    NSCAssert(!PorticoDownloadResumePolicyMatches(entry, NO), @"unknown resume policy was trusted");
    entry[@"cellularAllowed"] = @1;
    NSCAssert(!PorticoDownloadResumePolicyMatches(entry, YES), @"malformed resume policy was trusted");
    NSLog(@"PASS download attempt fencing: replacement, serialized restart, completed/removed files, missing identity, resume policy");
  }
}
