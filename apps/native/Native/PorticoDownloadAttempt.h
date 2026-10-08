#import <Foundation/Foundation.h>

// Called on the downloads serial queue before any callback mutates manifest or
// resume bytes. Older manifests have no task id; their existing task may finish
// until a new start records an id. A replacement always fences those callbacks.
static inline BOOL PorticoDownloadAcceptsTask(NSDictionary *entry, NSUInteger taskIdentifier) {
  if (!entry || [entry[@"state"] isEqual:@"ready"]) return NO;
  NSNumber *current = entry[@"taskIdentifier"];
  return current == nil || ([current isKindOfClass:NSNumber.class] && current.unsignedIntegerValue == taskIdentifier);
}
