#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <TVServices/TVServices.h>

static NSString * const PorticoTopShelfAppGroup = @"group.tv.getportico";
static NSString * const PorticoTopShelfPayloadKey = @"PorticoTopShelfPayload.v1";

@interface PorticoTopShelfDownloadDelegate : NSObject <NSURLSessionTaskDelegate>
@end

@implementation PorticoTopShelfDownloadDelegate

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler
{
  NSURLRequest *original = task.originalRequest;
  if ([original valueForHTTPHeaderField:@"Authorization"].length == 0) {
    completionHandler(request);
    return;
  }
  NSURL *from = original.URL;
  NSURL *to = request.URL;
  BOOL sameOrigin = [from.scheme.lowercaseString isEqualToString:to.scheme.lowercaseString]
    && [from.host.lowercaseString isEqualToString:to.host.lowercaseString]
    && ((from.port == nil && to.port == nil) || [from.port isEqualToNumber:to.port]);
  if (sameOrigin) {
    completionHandler(request);
    return;
  }
  NSMutableURLRequest *sanitized = [request mutableCopy];
  [sanitized setValue:nil forHTTPHeaderField:@"Authorization"];
  completionHandler(sanitized);
}

@end

@interface PorticoTopShelf : NSObject <RCTBridgeModule>
@property (nonatomic, strong) PorticoTopShelfDownloadDelegate *downloadDelegate;
@property (nonatomic, strong) NSURLSession *session;
@end

@implementation PorticoTopShelf

RCT_EXPORT_MODULE(PorticoTopShelf)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    _downloadDelegate = [PorticoTopShelfDownloadDelegate new];
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    configuration.timeoutIntervalForRequest = 20;
    configuration.timeoutIntervalForResource = 30;
    configuration.HTTPMaximumConnectionsPerHost = 3;
    _session = [NSURLSession sessionWithConfiguration:configuration
                                             delegate:_downloadDelegate
                                        delegateQueue:nil];
  }
  return self;
}

- (NSURL *)cacheDirectory
{
  NSURL *container = [[NSFileManager defaultManager]
    containerURLForSecurityApplicationGroupIdentifier:PorticoTopShelfAppGroup];
  if (container == nil) return nil;
  NSURL *directory = [container URLByAppendingPathComponent:@"Library/Caches/PorticoTopShelf"
                                               isDirectory:YES];
  NSError *error = nil;
  if (![[NSFileManager defaultManager] createDirectoryAtURL:directory
                                withIntermediateDirectories:YES
                                                 attributes:nil
                                                      error:&error]) {
    return nil;
  }
  return directory;
}

- (NSString *)safeFileNameForIdentifier:(NSString *)identifier
{
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:
    @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."];
  NSMutableString *safe = [NSMutableString stringWithCapacity:MIN(identifier.length, 96)];
  for (NSUInteger index = 0; index < identifier.length && safe.length < 96; index += 1) {
    unichar character = [identifier characterAtIndex:index];
    [safe appendString:[allowed characterIsMember:character]
      ? [NSString stringWithCharacters:&character length:1]
      : @"_"];
  }
  return safe.length > 0 ? safe : NSUUID.UUID.UUIDString;
}

- (void)publishPayload:(NSArray<NSDictionary *> *)items
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:PorticoTopShelfAppGroup];
  if (defaults == nil) return;
  NSData *payload = [NSJSONSerialization dataWithJSONObject:@{
    @"version": @1,
    @"updatedAt": @([[NSDate date] timeIntervalSince1970]),
    @"items": items
  } options:0 error:nil];
  if (payload != nil) [defaults setObject:payload forKey:PorticoTopShelfPayloadKey];
  [defaults synchronize];
  dispatch_async(dispatch_get_main_queue(), ^{
    [TVTopShelfContentProvider topShelfContentDidChange];
  });
}

RCT_EXPORT_METHOD(clear:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:PorticoTopShelfAppGroup];
  [defaults removeObjectForKey:PorticoTopShelfPayloadKey];
  [defaults synchronize];
  NSURL *directory = [self cacheDirectory];
  if (directory != nil) {
    for (NSURL *file in [[NSFileManager defaultManager] contentsOfDirectoryAtURL:directory
                                                  includingPropertiesForKeys:nil
                                                                     options:0
                                                                       error:nil]) {
      [[NSFileManager defaultManager] removeItemAtURL:file error:nil];
    }
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [TVTopShelfContentProvider topShelfContentDidChange];
  });
  resolve(nil);
}

RCT_EXPORT_METHOD(update:(NSArray *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *directory = [self cacheDirectory];
  if (directory == nil) {
    reject(@"top_shelf_storage_unavailable", @"Top Shelf storage is unavailable.", nil);
    return;
  }
  NSArray *bounded = input.count > 12 ? [input subarrayWithRange:NSMakeRange(0, 12)] : input;
  dispatch_group_t group = dispatch_group_create();
  dispatch_queue_t stateQueue = dispatch_queue_create("tv.getportico.top-shelf", DISPATCH_QUEUE_SERIAL);
  NSMutableArray<NSMutableDictionary *> *payload = [NSMutableArray array];
  NSMutableSet<NSString *> *retainedFiles = [NSMutableSet set];

  for (id candidate in bounded) {
    if (![candidate isKindOfClass:NSDictionary.class]) continue;
    NSDictionary *source = candidate;
    NSString *identifier = [source[@"id"] isKindOfClass:NSString.class] ? source[@"id"] : @"";
    NSString *title = [source[@"title"] isKindOfClass:NSString.class] ? source[@"title"] : @"";
    if (identifier.length == 0 || title.length == 0) continue;
    NSString *fileName = [[self safeFileNameForIdentifier:identifier] stringByAppendingPathExtension:@"image"];
    NSURL *fileURL = [directory URLByAppendingPathComponent:fileName];
    NSMutableDictionary *item = [@{
      @"id": identifier,
      @"title": title,
      @"order": @(payload.count),
      @"deepLink": [NSString stringWithFormat:@"portico://media/%@",
        [identifier stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.URLPathAllowedCharacterSet]]
    } mutableCopy];
    NSNumber *progress = [source[@"progress"] isKindOfClass:NSNumber.class] ? source[@"progress"] : nil;
    if (progress != nil) item[@"progress"] = @(MAX(0, MIN(1, progress.doubleValue)));
    @synchronized (payload) {
      [payload addObject:item];
      [retainedFiles addObject:fileName];
    }

    NSString *imageValue = [source[@"imageURL"] isKindOfClass:NSString.class] ? source[@"imageURL"] : @"";
    NSURL *imageURL = [NSURL URLWithString:imageValue];
    if (imageURL == nil || !([imageURL.scheme.lowercaseString isEqualToString:@"https"]
      || [imageURL.scheme.lowercaseString isEqualToString:@"http"])) {
      if ([[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) item[@"imageURL"] = fileURL.absoluteString;
      continue;
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:imageURL];
    NSDictionary *headers = [source[@"imageHeaders"] isKindOfClass:NSDictionary.class] ? source[@"imageHeaders"] : @{};
    NSString *authorization = [headers[@"Authorization"] isKindOfClass:NSString.class] ? headers[@"Authorization"] : nil;
    if (authorization.length > 0) [request setValue:authorization forHTTPHeaderField:@"Authorization"];
    dispatch_group_enter(group);
    [[self.session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
      NSHTTPURLResponse *http = [response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse *)response : nil;
      NSString *mime = response.MIMEType.lowercaseString;
      BOOL valid = error == nil && data.length > 0 && data.length <= (8 * 1024 * 1024)
        && http.statusCode >= 200 && http.statusCode < 300 && [mime hasPrefix:@"image/"];
      dispatch_async(stateQueue, ^{
        if (valid && [data writeToURL:fileURL options:NSDataWritingAtomic error:nil]) {
          item[@"imageURL"] = fileURL.absoluteString;
        } else if ([[NSFileManager defaultManager] fileExistsAtPath:fileURL.path]) {
          item[@"imageURL"] = fileURL.absoluteString;
        }
        dispatch_group_leave(group);
      });
    }] resume];
  }

  dispatch_group_notify(group, stateQueue, ^{
    for (NSURL *file in [[NSFileManager defaultManager] contentsOfDirectoryAtURL:directory
                                                  includingPropertiesForKeys:nil
                                                                     options:0
                                                                       error:nil]) {
      if (![retainedFiles containsObject:file.lastPathComponent]) {
        [[NSFileManager defaultManager] removeItemAtURL:file error:nil];
      }
    }
    NSArray *ordered = [payload sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
      NSUInteger leftIndex = [left[@"order"] unsignedIntegerValue];
      NSUInteger rightIndex = [right[@"order"] unsignedIntegerValue];
      return leftIndex < rightIndex ? NSOrderedAscending : leftIndex > rightIndex ? NSOrderedDescending : NSOrderedSame;
    }];
    for (NSMutableDictionary *item in ordered) [item removeObjectForKey:@"order"];
    [self publishPayload:ordered];
    resolve(nil);
  });
}

@end
