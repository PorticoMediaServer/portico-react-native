#import <Foundation/Foundation.h>

// Called on the downloads serial queue before any callback mutates manifest or
// resume bytes. A callback must identify the exact current attempt. A damaged
// manifest with no task identity cannot authorize a late callback.
static inline BOOL PorticoDownloadAcceptsTask(NSDictionary *entry, NSUInteger taskIdentifier) {
  if (!entry || [entry[@"state"] isEqual:@"ready"]) return NO;
  NSNumber *current = entry[@"taskIdentifier"];
  return [current isKindOfClass:NSNumber.class] && current.unsignedIntegerValue == taskIdentifier;
}

// Resume data preserves the original request's policy; it cannot be tightened on reuse.
static inline BOOL PorticoDownloadResumePolicyMatches(NSDictionary *entry, BOOL cellular) {
  id policy = entry[@"cellularAllowed"];
  return [policy isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)policy) == CFBooleanGetTypeID() && [policy boolValue] == cellular;
}
