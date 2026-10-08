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
    NSMutableDictionary *legacy = [@{@"state": @"downloading"} mutableCopy];
    NSCAssert(PorticoDownloadAcceptsTask(legacy, 21), @"existing upgraded transfer cannot finish");
    legacy[@"taskIdentifier"] = @23;
    NSCAssert(!PorticoDownloadAcceptsTask(legacy, 21), @"legacy attempt survives replacement");
    NSLog(@"PASS download attempt fencing: replacement, serialized restart, completed/removed files, legacy upgrade");
  }
}
