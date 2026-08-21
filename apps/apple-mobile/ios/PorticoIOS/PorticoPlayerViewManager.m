#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <MediaPlayer/MediaPlayer.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>
#import <TargetConditionals.h>
#import <UIKit/UIKit.h>
#import <VideoToolbox/VideoToolbox.h>
#import <math.h>

static NSString * const PorticoResourceLoaderScheme = @"portico-resource";

static NSDate *PorticoISO8601Date(NSString *value) {
  if (![value isKindOfClass:NSString.class] || !value.length) return nil;
  NSISO8601DateFormatter *fractional = [NSISO8601DateFormatter new];
  fractional.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
  NSDate *date = [fractional dateFromString:value];
  return date ?: [[NSISO8601DateFormatter new] dateFromString:value];
}

@interface PorticoResourceLoad : NSObject
@property (nonatomic, strong) AVAssetResourceLoadingRequest *loadingRequest;
@property (nonatomic, strong) NSMutableData *data;
@property (nonatomic, strong) NSURL *originalURL;
@property (nonatomic, strong) NSHTTPURLResponse *response;
@property (nonatomic, strong) NSURLSessionTask *task;
@property (nonatomic, assign) NSInteger requestedOffset;
@property (nonatomic, assign) NSInteger currentOffset;
@property (nonatomic, assign) NSInteger requestedLength;
@property (nonatomic, assign) BOOL requestsAllDataToEnd;
@property (nonatomic, assign) BOOL isPlaylist;
@end

@implementation PorticoResourceLoad
@end

/**
 * The old undocumented AVURLAsset header-field option does not reliably cover
 * HLS child requests. This delegate maps only the synthetic URL scheme used
 * for approved server resources and applies PorticoMedia on same-origin
 * requests, including manifests, byte ranges, segments, subtitles, and
 * trick-play assets.
 */
@interface PorticoResourceLoader : NSObject <AVAssetResourceLoaderDelegate, NSURLSessionDataDelegate, NSURLSessionTaskDelegate>
@property (nonatomic, strong) NSURL *originURL;
@property (nonatomic, copy) NSArray<NSString *> *allowedOrigins;
@property (nonatomic, copy) NSDictionary *routePolicy;
@property (nonatomic, copy) NSString *authorization;
@property (nonatomic, assign) BOOL allowsCellularAccess;
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, PorticoResourceLoad *> *loads;
@property (nonatomic, strong) dispatch_queue_t stateQueue;
- (instancetype)initWithOriginURL:(NSURL *)originURL authorization:(NSString *)authorization allowsCellularAccess:(BOOL)allowsCellularAccess;
- (instancetype)initWithOriginURL:(NSURL *)originURL allowedOrigins:(NSArray<NSString *> *)allowedOrigins routePolicy:(NSDictionary *)routePolicy authorization:(NSString *)authorization allowsCellularAccess:(BOOL)allowsCellularAccess;
- (void)updateAuthorization:(NSString *)authorization;
- (dispatch_queue_t)stateQueue;
@end

static BOOL PorticoSameOrigin(NSURL *left, NSURL *right) {
  if (!left || !right || !left.host.length || !right.host.length) return NO;
  NSString *leftScheme = left.scheme.lowercaseString;
  NSString *rightScheme = right.scheme.lowercaseString;
  if (![leftScheme isEqualToString:rightScheme]) return NO;
  if (![left.host.lowercaseString isEqualToString:right.host.lowercaseString]) return NO;
  NSInteger leftPort = left.port.integerValue ?: ([leftScheme isEqualToString:@"https"] ? 443 : 80);
  NSInteger rightPort = right.port.integerValue ?: ([rightScheme isEqualToString:@"https"] ? 443 : 80);
  return leftPort == rightPort;
}

static BOOL PorticoTrustedInsecureHost(NSString *host) {
  NSString *normalized = host.lowercaseString;
  if ([normalized isEqualToString:@"localhost"] || [normalized isEqualToString:@"::1"]) return YES;
  NSArray<NSString *> *parts = [normalized componentsSeparatedByString:@"."];
  if (parts.count != 4) return [normalized hasPrefix:@"fe80:"];
  NSInteger a = parts[0].integerValue;
  NSInteger b = parts[1].integerValue;
  if (a == 127 || a == 10 || (a == 172 && b >= 16 && b <= 31) ||
      (a == 192 && b == 168) || (a == 169 && b == 254)) return YES;
  return NO;
}

static NSURL *PorticoOriginalURL(NSURL *url, NSURL *originURL) {
  if (!url || ![url.scheme.lowercaseString isEqualToString:PorticoResourceLoaderScheme]) return nil;
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  components.scheme = originURL.scheme;
  return components.URL;
}

static NSURL *PorticoSyntheticURL(NSURL *url) {
  NSString *scheme = url.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return url;
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  components.scheme = PorticoResourceLoaderScheme;
  return components.URL;
}

static BOOL PorticoOriginInAllowlist(NSURL *url, NSArray<NSString *> *allowedOrigins, NSDictionary *routePolicy) {
  if (!url || !url.host.length) return NO;
  if ([url.scheme.lowercaseString isEqualToString:@"http"] &&
      (![routePolicy[@"allowInsecureLan"] boolValue] || !PorticoTrustedInsecureHost(url.host))) return NO;
  for (NSString *candidate in allowedOrigins) {
    NSURL *origin = [NSURL URLWithString:candidate];
    if (origin && PorticoSameOrigin(url, origin)) return YES;
  }
  return NO;
}

static BOOL PorticoApprovedResourceURL(NSURL *url, NSArray<NSString *> *allowedOrigins, NSDictionary *routePolicy) {
  if (!PorticoOriginInAllowlist(url, allowedOrigins, routePolicy)) return NO;
  return [url.path hasPrefix:@"/api/"];
}

static BOOL PorticoIsPlaylist(NSURL *url, NSURLResponse *response) {
  NSString *mime = response.MIMEType.lowercaseString ?: @"";
  return [url.pathExtension.lowercaseString isEqualToString:@"m3u8"] ||
    [mime containsString:@"mpegurl"] || [mime containsString:@"m3u"];
}

static NSString *PorticoContentType(NSURLResponse *response, NSURL *url, BOOL playlist) {
  if (playlist || [url.pathExtension.lowercaseString isEqualToString:@"m3u8"]) return @"com.apple.mpegurl";
  NSString *mime = response.MIMEType.lowercaseString ?: @"";
  if ([mime containsString:@"mpeg-4"] || [mime containsString:@"mp4"]) return AVFileTypeMPEG4;
  if ([mime containsString:@"mpeg"] || [url.pathExtension.lowercaseString isEqualToString:@"mp3"]) return @"public.mp3";
  if ([mime containsString:@"vtt"] || [url.pathExtension.lowercaseString isEqualToString:@"vtt"]) return @"public.text";
  if ([mime containsString:@"mp2t"] || [url.pathExtension.lowercaseString isEqualToString:@"ts"]) return @"public.mpeg-2-transport-stream";
  return response.MIMEType ?: @"public.data";
}

static NSData *PorticoPlaylistData(NSData *data, NSArray<NSString *> *allowedOrigins, NSDictionary *routePolicy) {
  NSString *playlist = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (!playlist.length) return data;
  NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:@"https?://[^\\s\\\"']+" options:NSRegularExpressionCaseInsensitive error:nil];
  NSMutableString *rewritten = [playlist mutableCopy];
  NSArray<NSTextCheckingResult *> *matches = [expression matchesInString:playlist options:0 range:NSMakeRange(0, playlist.length)];
  for (NSTextCheckingResult *match in [matches reverseObjectEnumerator]) {
    NSString *value = [playlist substringWithRange:match.range];
    NSURL *url = [NSURL URLWithString:value];
    if (!PorticoApprovedResourceURL(url, allowedOrigins, routePolicy)) continue;
    NSURL *synthetic = PorticoSyntheticURL(url);
    if (synthetic) [rewritten replaceCharactersInRange:match.range withString:synthetic.absoluteString];
  }
  return [rewritten dataUsingEncoding:NSUTF8StringEncoding] ?: data;
}

static NSDictionary *PorticoApplePlaybackProfile(void) {
  BOOL hevc = VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC);
  UIScreen *screen = UIScreen.mainScreen;
  NSInteger pixelWidth = (NSInteger)llround(screen.bounds.size.width * screen.nativeScale);
  NSInteger pixelHeight = (NSInteger)llround(screen.bounds.size.height * screen.nativeScale);
  NSInteger maxWidth = MAX(pixelWidth, pixelHeight);
  NSInteger maxHeight = MIN(pixelWidth, pixelHeight);
  NSISO8601DateFormatter *observationFormatter = [NSISO8601DateFormatter new];
  NSString *observedAt = [observationFormatter stringFromDate:NSDate.date];
  NSMutableArray *videoCodecs = [NSMutableArray arrayWithObjects:@"h264", nil];
  NSMutableArray *videoProfiles = [NSMutableArray arrayWithObjects:@"h264:baseline", @"h264:main", @"h264:high", nil];
  if (hevc) {
    [videoCodecs addObject:@"hevc"];
    [videoProfiles addObject:@"hevc:main"];
  }
  return @{
    @"device": TARGET_OS_TV ? @"Portico Apple TV" : @"Portico iPhone",
    @"platform": TARGET_OS_TV ? @"tvOS" : @"iOS",
    @"clientVersion": UIDevice.currentDevice.systemVersion ?: @"unknown",
    @"observedAt": observedAt ?: @"",
    @"supportsHls": @YES,
    @"supportsMse": @NO,
    @"supportsMpegTs": @YES,
    @"supportedContainers": @[@"hls", @"mp4", @"m4v", @"mov", @"mpegts"],
    @"supportedVideoCodecs": videoCodecs,
    @"supportedAudioCodecs": @[@"aac", @"mp3"],
    // The screen and audio-session maxima are not proof of the current
    // display mode, decoder profile, or output route. Keep HDR and
    // multichannel false until the native player can report exact runtime
    // observations for the active playback route.
    @"maxAudioChannels": @2,
    @"maxWidth": @(MAX(maxWidth, 1)),
    @"maxHeight": @(MAX(maxHeight, 1)),
    @"maxFrameRate": @(MAX(screen.maximumFramesPerSecond, 30)),
    @"maxVideoBitDepth": @8,
    @"supportsHevc": @(hevc),
    @"supportsHdr": @NO,
    @"supportsAc3": @NO,
    @"supportsEac3": @NO,
    @"supportedVideoProfiles": videoProfiles,
    @"supportedPixelFormats": @[@"yuv420p", @"yuvj420p"],
    @"supportedHdrFormats": @[],
    @"supportedDolbyVisionProfiles": @[],
    @"prefersServerProxy": @YES,
    @"requiresServerProxy": @YES,
  };
}

@implementation PorticoResourceLoader

- (instancetype)initWithOriginURL:(NSURL *)originURL authorization:(NSString *)authorization allowsCellularAccess:(BOOL)allowsCellularAccess {
  NSURLComponents *components = [NSURLComponents componentsWithURL:originURL resolvingAgainstBaseURL:NO];
  NSString *origin = [NSString stringWithFormat:@"%@://%@%@",
    components.scheme ?: @"", components.host ?: @"", components.port ? [NSString stringWithFormat:@":%@", components.port] : @""];
  return [self initWithOriginURL:originURL
                    allowedOrigins:origin.length ? @[origin] : @[]
                       routePolicy:@{ @"allowInsecureLan": @NO }
                    authorization:authorization
             allowsCellularAccess:allowsCellularAccess];
}

- (instancetype)initWithOriginURL:(NSURL *)originURL allowedOrigins:(NSArray<NSString *> *)allowedOrigins routePolicy:(NSDictionary *)routePolicy authorization:(NSString *)authorization allowsCellularAccess:(BOOL)allowsCellularAccess {
  if ((self = [super init])) {
    _originURL = originURL;
    _allowedOrigins = [allowedOrigins copy];
    _routePolicy = [routePolicy copy] ?: @{};
    _authorization = [authorization copy];
    _allowsCellularAccess = allowsCellularAccess;
    _loads = [NSMutableDictionary dictionary];
    _stateQueue = dispatch_queue_create("tv.getportico.apple-playback-resource-loader", DISPATCH_QUEUE_SERIAL);
    NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration defaultSessionConfiguration];
    configuration.allowsCellularAccess = allowsCellularAccess;
    NSOperationQueue *delegateQueue = [NSOperationQueue new];
    delegateQueue.maxConcurrentOperationCount = 1;
    delegateQueue.underlyingQueue = _stateQueue;
    _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:delegateQueue];
  }
  return self;
}

- (dispatch_queue_t)stateQueue {
  return _stateQueue;
}

- (void)updateAuthorization:(NSString *)authorization {
  dispatch_async(_stateQueue, ^{
    self->_authorization = [authorization copy];
  });
}

- (BOOL)resourceLoader:(AVAssetResourceLoader *)resourceLoader shouldWaitForLoadingOfRequestedResource:(AVAssetResourceLoadingRequest *)loadingRequest {
  NSURL *originalURL = PorticoOriginalURL(loadingRequest.request.URL, self.originURL);
  if (!PorticoApprovedResourceURL(originalURL, self.allowedOrigins, self.routePolicy)) {
    [loadingRequest finishLoadingWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorNoPermissionsToReadFile userInfo:nil]];
    return NO;
  }

  PorticoResourceLoad *load = [PorticoResourceLoad new];
  load.loadingRequest = loadingRequest;
  load.originalURL = originalURL;
  load.data = [NSMutableData data];
  AVAssetResourceLoadingDataRequest *dataRequest = loadingRequest.dataRequest;
  if (dataRequest) {
    load.requestedOffset = dataRequest.requestedOffset;
    load.currentOffset = dataRequest.currentOffset;
    load.requestedLength = dataRequest.requestedLength;
    load.requestsAllDataToEnd = dataRequest.requestsAllDataToEndOfResource;
  }

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:originalURL];
  request.cachePolicy = NSURLRequestUseProtocolCachePolicy;
  request.HTTPShouldHandleCookies = NO;
  if (self.authorization.length &&
      [self.authorization hasPrefix:@"PorticoMedia "] &&
      PorticoOriginInAllowlist(originalURL, self.allowedOrigins, self.routePolicy)) {
    [request setValue:self.authorization forHTTPHeaderField:@"Authorization"];
  }
  if (dataRequest && (load.requestedLength > 0 || load.requestsAllDataToEnd)) {
    long long start = (long long)load.currentOffset;
    long long remaining = MAX(0, (long long)load.requestedLength - (start - load.requestedOffset));
    long long end = start + remaining - 1;
    NSString *range = load.requestsAllDataToEnd
      ? [NSString stringWithFormat:@"bytes=%lld-", start]
      : [NSString stringWithFormat:@"bytes=%lld-%lld", start, end];
    [request setValue:range forHTTPHeaderField:@"Range"];
  }

  NSURLSessionDataTask *task = [self.session dataTaskWithRequest:request];
  load.task = task;
  self.loads[@(task.taskIdentifier)] = load;
  [task resume];
  return YES;
}

- (void)resourceLoader:(AVAssetResourceLoader *)resourceLoader didCancelLoadingRequest:(AVAssetResourceLoadingRequest *)loadingRequest {
  NSNumber *identifier = nil;
  for (NSNumber *key in self.loads) {
    if (self.loads[key].loadingRequest == loadingRequest) {
      identifier = key;
      break;
    }
  }
  if (!identifier) return;
  [self.loads[identifier].task cancel];
  [self.loads removeObjectForKey:identifier];
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  PorticoResourceLoad *load = self.loads[@(dataTask.taskIdentifier)];
  if (!load || ![response isKindOfClass:NSHTTPURLResponse.class]) {
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  load.response = (NSHTTPURLResponse *)response;
  load.isPlaylist = PorticoIsPlaylist(load.originalURL, response);
  if (load.response.statusCode < 200 || load.response.statusCode >= 400) {
    NSString *category = (load.response.statusCode == 401 || load.response.statusCode == 403) ? @"grant" : @"server-product";
    NSError *httpError = [NSError errorWithDomain:@"PorticoPlaybackHTTPError"
                                               code:load.response.statusCode
                                           userInfo:@{@"PorticoPlaybackCategory": category}];
    [load.loadingRequest finishLoadingWithError:httpError];
    [self.loads removeObjectForKey:@(dataTask.taskIdentifier)];
    completionHandler(NSURLSessionResponseCancel);
    return;
  }
  AVAssetResourceLoadingContentInformationRequest *content = load.loadingRequest.contentInformationRequest;
  if (content && !load.isPlaylist) {
    content.contentType = PorticoContentType(response, load.originalURL, load.isPlaylist);
    content.contentLength = response.expectedContentLength;
    if (content.contentLength < 0) content.contentLength = 0;
    NSString *contentRange = load.response.allHeaderFields[@"Content-Range"] ?: load.response.allHeaderFields[@"content-range"];
    NSRegularExpression *rangeExpression = [NSRegularExpression regularExpressionWithPattern:@"/([0-9]+)$" options:0 error:nil];
    NSTextCheckingResult *rangeMatch = [rangeExpression firstMatchInString:contentRange ?: @"" options:0 range:NSMakeRange(0, contentRange.length)];
    if (rangeMatch) {
      content.contentLength = [[contentRange substringWithRange:[rangeMatch rangeAtIndex:1]] longLongValue];
    }
    NSString *acceptRanges = load.response.allHeaderFields[@"Accept-Ranges"] ?: load.response.allHeaderFields[@"accept-ranges"];
    content.byteRangeAccessSupported = load.response.statusCode == 206 || [acceptRanges.lowercaseString isEqualToString:@"bytes"];
  }
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
  PorticoResourceLoad *load = self.loads[@(dataTask.taskIdentifier)];
  if (!load) return;
  BOOL serverHonoredRange = load.response.statusCode == 206;
  BOOL boundedUnrangedResponse = load.response.statusCode == 200 &&
    load.requestedLength > 0 && !load.requestsAllDataToEnd;
  BOOL canStreamDirectly = !load.isPlaylist && load.loadingRequest.dataRequest &&
    (serverHonoredRange || (!boundedUnrangedResponse && load.currentOffset == 0));
  if (!canStreamDirectly) {
    [load.data appendData:data];
  } else {
    // AVFoundation may issue a follow-up request with a non-zero
    // currentOffset. Responding incrementally lets it advance that offset
    // without buffering an entire direct-play resource in memory.
    load.currentOffset = load.loadingRequest.dataRequest.currentOffset;
    [load.loadingRequest.dataRequest respondWithData:data];
  }
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
  PorticoResourceLoad *load = self.loads[@(task.taskIdentifier)];
  if (!load) {
    completionHandler(nil);
    return;
  }
  // The loader owns only the server's exact origin. External HLS origins are
  // left to AVFoundation when they appear as child URIs, but an HTTP redirect
  // cannot silently expand this loader's authorization boundary.
  if (!PorticoApprovedResourceURL(request.URL, self.allowedOrigins, self.routePolicy)) {
    completionHandler(nil);
    return;
  }
  NSMutableURLRequest *redirect = [request mutableCopy];
  if (self.authorization.length && [self.authorization hasPrefix:@"PorticoMedia "]) {
    [redirect setValue:self.authorization forHTTPHeaderField:@"Authorization"];
  }
  if (load.requestedLength > 0 || load.requestsAllDataToEnd) {
    long long start = (long long)load.currentOffset;
    long long remaining = MAX(0, (long long)load.requestedLength - (start - load.requestedOffset));
    long long end = start + remaining - 1;
    NSString *range = load.requestsAllDataToEnd
      ? [NSString stringWithFormat:@"bytes=%lld-", start]
      : [NSString stringWithFormat:@"bytes=%lld-%lld", start, end];
    [redirect setValue:range forHTTPHeaderField:@"Range"];
  }
  completionHandler(redirect);
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  PorticoResourceLoad *load = self.loads[@(task.taskIdentifier)];
  if (!load) return;
  [self.loads removeObjectForKey:@(task.taskIdentifier)];
  if (error) {
    [load.loadingRequest finishLoadingWithError:error];
    return;
  }
  if (load.isPlaylist) {
    NSData *rewritten = PorticoPlaylistData(load.data, self.allowedOrigins, self.routePolicy);
    AVAssetResourceLoadingContentInformationRequest *content = load.loadingRequest.contentInformationRequest;
    if (content) {
      content.contentType = @"com.apple.mpegurl";
      content.contentLength = rewritten.length;
      content.byteRangeAccessSupported = NO;
    }
    [load.loadingRequest.dataRequest respondWithData:rewritten];
  } else if (load.loadingRequest.dataRequest && load.data.length > 0) {
    NSData *data = load.data;
    if (load.response.statusCode == 200 && load.currentOffset > 0 && load.currentOffset < data.length) {
      NSUInteger length = load.requestsAllDataToEnd
        ? data.length - load.currentOffset
        : MIN(load.requestedLength, data.length - load.currentOffset);
      data = [data subdataWithRange:NSMakeRange((NSUInteger)load.currentOffset, length)];
    } else if (load.response.statusCode == 200 && load.requestedLength > 0 && data.length > load.currentOffset) {
      data = [data subdataWithRange:NSMakeRange((NSUInteger)load.currentOffset, MIN(load.requestedLength, data.length - load.currentOffset))];
    }
    [load.loadingRequest.dataRequest respondWithData:data];
  }
  [load.loadingRequest finishLoading];
}
@end

#if TARGET_OS_TV
@interface PorticoPlayerView : UIView
#else
@interface PorticoPlayerView : UIView <AVPictureInPictureControllerDelegate>
#endif
@property (nonatomic, copy) NSString *sourceURL;
@property (nonatomic, copy) NSString *authorization;
@property (nonatomic, copy) NSDictionary *playbackDescriptor;
@property (nonatomic, assign) BOOL autoplay;
@property (nonatomic, assign) BOOL allowsCellularAccess;
@property (nonatomic, assign) BOOL allowsPictureInPicture;
@property (nonatomic, assign) BOOL isLive;
@property (nonatomic, copy) NSString *contentMode;
@property (nonatomic, copy) NSString *metadataTitle;
@property (nonatomic, copy) NSString *metadataSubtitle;
@property (nonatomic, copy) NSString *watchWithFriendsControlPolicy;
@property (nonatomic, assign) double seekIntervalSeconds;
@property (nonatomic, assign) double startPositionSeconds;
@property (nonatomic, assign) double playbackGeneration;
@property (nonatomic, copy) RCTDirectEventBlock onPlaybackState;
@property (nonatomic, copy) RCTDirectEventBlock onPlaybackProgress;
@property (nonatomic, copy) RCTDirectEventBlock onPlaybackError;
@property (nonatomic, copy) RCTDirectEventBlock onPlaybackEnd;
@property (nonatomic, copy) RCTDirectEventBlock onPlaybackCapabilities;
@property (nonatomic, copy) RCTDirectEventBlock onPictureInPictureChange;
@property (nonatomic, copy) RCTDirectEventBlock onPlaybackInterruption;
@property (nonatomic, copy) RCTDirectEventBlock onRemotePlaybackCommand;
- (void)play;
- (void)pause;
- (void)seekTo:(double)seconds;
- (void)setPlaybackRate:(double)rate;
- (void)setVolume:(double)volume;
- (void)setSleepTimerDeadline:(double)deadlineMilliseconds;
- (void)startPictureInPicture;
- (void)stopPictureInPicture;
- (void)completePictureInPictureRestore:(NSString *)requestID restored:(BOOL)restored;
@end

@interface PorticoPlayerView ()
- (BOOL)backgroundAudioEligible;
- (BOOL)configureAudioSession:(NSError **)error;
- (void)emitCapabilities;
- (void)emitPlaybackError:(NSError *)error fallback:(NSString *)fallback;
- (void)releaseAudioSessionOwnership;
- (void)maybeRenewGrantInBackground;
- (void)rotatePlaybackContinuation;
- (void)revokePlaybackContinuation;
#if !TARGET_OS_TV
- (void)updatePictureInPictureController;
#endif
- (void)activateNowPlayingSession;
- (void)deactivateNowPlayingSession;
- (void)installRemoteCommandsIfNeeded;
- (void)updateNowPlayingInfo;
- (void)updateRemoteCommandAvailability;
@end

static __weak PorticoPlayerView *PorticoActivePlayerView;
static BOOL PorticoRemoteCommandsInstalled = NO;
static NSHashTable<PorticoPlayerView *> *PorticoAudioSessionOwners;

@implementation PorticoPlayerView {
  AVPlayer *_player;
  AVPlayerLayer *_playerLayer;
  PorticoResourceLoader *_resourceLoader;
  id _timeObserver;
  id _endObserver;
  id _failedToEndObserver;
  id _interruptionObserver;
  id _routeChangeObserver;
  BOOL _didApplyInitialSeek;
  BOOL _observingItem;
  BOOL _playbackIntended;
  BOOL _audioSessionActive;
  BOOL _terminalItemFailure;
  BOOL _heartbeatInFlight;
  double _effectiveGrantExpiresAt;
  NSURL *_continuationURL;
  NSString *_heartbeatContinuationCredential;
  NSDate *_continuationExpiresAt;
  NSDictionary *_pendingContinuationEvent;
  NSInteger _continuationNextEventSequence;
  NSTimeInterval _lastContinuationProgressAt;
  NSURLSession *_heartbeatSession;
  NSString *_descriptorRevision;
  NSArray<NSString *> *_descriptorAllowedOrigins;
  NSDictionary *_descriptorRoutePolicy;
  BOOL _wasPlayingBeforeInterruption;
  NSInteger _itemGeneration;
  RCTDirectEventBlock _capabilitiesEvent;
  double _desiredPlaybackRate;
  double _sleepTimerDeadlineMilliseconds;
#if !TARGET_OS_TV
  AVPictureInPictureController *_pictureInPictureController;
  BOOL _pictureInPictureStarting;
  BOOL _observingPictureInPicturePossible;
  NSString *_pictureInPictureRestoreRequestID;
  void (^_pictureInPictureRestoreCompletion)(BOOL);
#endif
  id _backgroundObserver;
}

- (RCTDirectEventBlock)onPlaybackCapabilities { return _capabilitiesEvent; }
- (void)setOnPlaybackCapabilities:(RCTDirectEventBlock)onPlaybackCapabilities {
  _capabilitiesEvent = [onPlaybackCapabilities copy];
  [self emitCapabilities];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.backgroundColor = UIColor.blackColor;
    _allowsCellularAccess = YES;
    _seekIntervalSeconds = 15;
    _desiredPlaybackRate = 1.0;
    _watchWithFriendsControlPolicy = @"independent";
    AVAudioSession *audioSession = AVAudioSession.sharedInstance;
    _player = [AVPlayer playerWithPlayerItem:nil];
    NSURLSessionConfiguration *heartbeatConfiguration = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    heartbeatConfiguration.HTTPShouldSetCookies = NO;
    heartbeatConfiguration.HTTPCookieStorage = nil;
    _heartbeatSession = [NSURLSession sessionWithConfiguration:heartbeatConfiguration];
    _player.automaticallyWaitsToMinimizeStalling = YES;
    _player.allowsExternalPlayback = YES;
    _player.usesExternalPlaybackWhileExternalScreenIsActive = YES;
    _playerLayer = [AVPlayerLayer playerLayerWithPlayer:_player];
    _playerLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    [self.layer addSublayer:_playerLayer];
    [self installRemoteCommandsIfNeeded];
    __weak typeof(self) backgroundWeakSelf = self;
    _backgroundObserver = [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidEnterBackgroundNotification
                                                                           object:nil
                                                                            queue:NSOperationQueue.mainQueue
                                                                       usingBlock:^(__unused NSNotification *note) {
      typeof(self) strongSelf = backgroundWeakSelf;
      if (!strongSelf) return;
#if !TARGET_OS_TV
      BOOL pictureInPictureActive = strongSelf->_pictureInPictureController.pictureInPictureActive || strongSelf->_pictureInPictureStarting;
#else
      BOOL pictureInPictureActive = NO;
#endif
      if (![strongSelf backgroundAudioEligible] && !pictureInPictureActive) [strongSelf pause];
    }];
    __weak typeof(self) weakSelf = self;
    _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(1, NSEC_PER_SEC)
                                                        queue:dispatch_get_main_queue()
                                                   usingBlock:^(CMTime time) {
      typeof(self) strongSelf = weakSelf;
      if (!strongSelf) return;
      if (strongSelf->_sleepTimerDeadlineMilliseconds > 0 &&
          NSDate.date.timeIntervalSince1970 * 1000.0 >= strongSelf->_sleepTimerDeadlineMilliseconds) {
        strongSelf->_sleepTimerDeadlineMilliseconds = 0;
        [strongSelf pause];
      }
      [strongSelf emitProgressAt:time];
    }];
    [_player addObserver:self forKeyPath:@"timeControlStatus" options:NSKeyValueObservingOptionInitial | NSKeyValueObservingOptionNew context:NULL];
    _interruptionObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVAudioSessionInterruptionNotification
                                                                            object:audioSession
                                                                             queue:NSOperationQueue.mainQueue
                                                                        usingBlock:^(NSNotification *note) {
      typeof(self) strongSelf = weakSelf;
      if (!strongSelf) return;
      AVAudioSessionInterruptionType type = [note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue];
      if (type == AVAudioSessionInterruptionTypeBegan) {
        strongSelf->_wasPlayingBeforeInterruption = strongSelf->_playbackIntended;
        [strongSelf->_player pause];
        if (strongSelf.onPlaybackInterruption) strongSelf.onPlaybackInterruption(@{
          @"phase": @"began",
          @"shouldResume": @(strongSelf->_wasPlayingBeforeInterruption),
          @"recovered": @NO,
        });
        return;
      }
      AVAudioSessionInterruptionOptions options = [note.userInfo[AVAudioSessionInterruptionOptionKey] unsignedIntegerValue];
      BOOL shouldResume = strongSelf->_wasPlayingBeforeInterruption && strongSelf->_playbackIntended && (options & AVAudioSessionInterruptionOptionShouldResume);
      NSError *activationError = nil;
      BOOL recovered = !shouldResume || ([strongSelf configureAudioSession:&activationError] && [audioSession setActive:YES error:&activationError]);
      BOOL groupControlled = ![strongSelf.watchWithFriendsControlPolicy isEqualToString:@"independent"];
      if (shouldResume && recovered && !groupControlled) {
        [strongSelf activateNowPlayingSession];
        [strongSelf->_player playImmediatelyAtRate:strongSelf->_desiredPlaybackRate];
      } else if (shouldResume && recovered && [strongSelf.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
        if (strongSelf.onRemotePlaybackCommand) strongSelf.onRemotePlaybackCommand(@{
          @"action": @"play",
          @"positionSeconds": @(MAX(0, CMTimeGetSeconds(strongSelf->_player.currentTime))),
        });
      } else if (shouldResume) {
        strongSelf->_playbackIntended = NO;
      }
      if (strongSelf.onPlaybackInterruption) strongSelf.onPlaybackInterruption(@{
        @"phase": @"ended",
        @"shouldResume": @(shouldResume),
        @"recovered": @(recovered),
      });
      strongSelf->_wasPlayingBeforeInterruption = NO;
    }];
    _routeChangeObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVAudioSessionRouteChangeNotification
                                                                           object:audioSession
                                                                            queue:NSOperationQueue.mainQueue
                                                                       usingBlock:^(NSNotification *note) {
      typeof(self) strongSelf = weakSelf;
      if (!strongSelf) return;
      AVAudioSessionRouteChangeReason reason = [note.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue];
      if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) [strongSelf pause];
    }];
  }
  return self;
}

- (void)dealloc {
#if !TARGET_OS_TV
  if (_pictureInPictureRestoreCompletion) {
    void (^completion)(BOOL) = _pictureInPictureRestoreCompletion;
    _pictureInPictureRestoreCompletion = nil;
    completion(NO);
  }
  if (_observingPictureInPicturePossible) [_pictureInPictureController removeObserver:self forKeyPath:@"pictureInPicturePossible"];
#endif
  if (_backgroundObserver) [NSNotificationCenter.defaultCenter removeObserver:_backgroundObserver];
  if (PorticoActivePlayerView == self) {
    PorticoActivePlayerView = nil;
    MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
    [self updateRemoteCommandAvailability];
  }
  if (_timeObserver) [_player removeTimeObserver:_timeObserver];
  if (_endObserver) [NSNotificationCenter.defaultCenter removeObserver:_endObserver];
  if (_failedToEndObserver) [NSNotificationCenter.defaultCenter removeObserver:_failedToEndObserver];
  if (_interruptionObserver) [NSNotificationCenter.defaultCenter removeObserver:_interruptionObserver];
  if (_routeChangeObserver) [NSNotificationCenter.defaultCenter removeObserver:_routeChangeObserver];
  if (_observingItem && _player.currentItem) [_player.currentItem removeObserver:self forKeyPath:@"status"];
  [_player removeObserver:self forKeyPath:@"timeControlStatus"];
  [self revokePlaybackContinuation];
  [_resourceLoader.session invalidateAndCancel];
  [_heartbeatSession invalidateAndCancel];
  _resourceLoader = nil;
  [self releaseAudioSessionOwnership];
}

- (void)releaseAudioSessionOwnership {
  @synchronized (PorticoPlayerView.class) {
    [PorticoAudioSessionOwners removeObject:self];
    if (PorticoAudioSessionOwners.count == 0 && _audioSessionActive) {
      [AVAudioSession.sharedInstance setActive:NO error:nil];
    }
    _audioSessionActive = NO;
  }
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _playerLayer.frame = self.bounds;
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  [self emitCapabilities];
}

- (void)setSourceURL:(NSString *)sourceURL {
  if ((_sourceURL == sourceURL) || [_sourceURL isEqualToString:sourceURL]) return;
  NSString *previousURL = _sourceURL;
  _sourceURL = [sourceURL copy];
  // Online playback is activated only by a complete descriptor. File-backed
  // offline playback remains compatible with the existing source-only path.
  if ([sourceURL hasPrefix:@"file:"] || [sourceURL hasPrefix:@"asset:"]) [self loadSource];
  else if (previousURL.length) {
    // Source navigation can precede the descriptor prop. Invalidate the old
    // item so stale media cannot continue while the new revision is assembled.
    _playbackDescriptor = nil;
    _descriptorRevision = nil;
    _descriptorAllowedOrigins = nil;
    _descriptorRoutePolicy = nil;
    [_player replaceCurrentItemWithPlayerItem:nil];
  }
}

- (void)setAllowsCellularAccess:(BOOL)allowsCellularAccess {
  if (_allowsCellularAccess == allowsCellularAccess) return;
  _allowsCellularAccess = allowsCellularAccess;
  NSURL *url = [NSURL URLWithString:_sourceURL ?: @""];
  BOOL localAsset = [url.scheme.lowercaseString isEqualToString:@"file"] || [url.scheme.lowercaseString isEqualToString:@"asset"];
  if (localAsset || (_playbackDescriptor && _descriptorRevision.length)) [self loadSource];
}

- (void)setAuthorization:(NSString *)authorization {
  if ((_authorization == authorization) || [_authorization isEqualToString:authorization]) return;
  _authorization = [authorization copy];
  // A healthy item must survive normal grant extension/rotation. The
  // resource loader reads this value for subsequent manifests, ranges,
  // segments, subtitles, and trick-play requests without replacing the item.
  [_resourceLoader updateAuthorization:_authorization];
  if (_terminalItemFailure && _playbackDescriptor) {
    _terminalItemFailure = NO;
    [self loadSource];
  }
}

- (void)setPlaybackDescriptor:(NSDictionary *)playbackDescriptor {
  if (![playbackDescriptor isKindOfClass:NSDictionary.class]) return;
  NSString *revision = playbackDescriptor[@"revision"];
  NSString *descriptorURL = playbackDescriptor[@"url"];
  NSString *grant = playbackDescriptor[@"mediaGrant"];
  NSString *sessionID = playbackDescriptor[@"sessionId"];
  NSString *continuationURL = playbackDescriptor[@"continuationURL"];
  NSDictionary *continuation = [playbackDescriptor[@"continuationCredential"] isKindOfClass:NSDictionary.class]
    ? playbackDescriptor[@"continuationCredential"]
    : nil;
  NSNumber *position = playbackDescriptor[@"resumePositionSeconds"];
  NSNumber *generation = playbackDescriptor[@"playbackGeneration"];
  NSNumber *nextEventSequence = playbackDescriptor[@"nextEventSequence"];
  NSNumber *playbackRevision = playbackDescriptor[@"playbackRevision"];
  NSArray *origins = playbackDescriptor[@"serverOrigins"];
  NSDictionary *routePolicy = playbackDescriptor[@"routePolicy"];
  BOOL complete = revision.length && descriptorURL.length && grant.length && sessionID.length && continuationURL.length &&
    continuation[@"token"] && continuation[@"expiresAt"] && continuation[@"origin"] &&
    [position isKindOfClass:NSNumber.class] && position.doubleValue >= 0 &&
    [generation isKindOfClass:NSNumber.class] && generation.integerValue >= 0 &&
    [nextEventSequence isKindOfClass:NSNumber.class] && nextEventSequence.integerValue > 0 &&
    [playbackRevision isKindOfClass:NSNumber.class] && playbackRevision.integerValue >= 0 &&
    [origins isKindOfClass:NSArray.class] && origins.count > 0 &&
    [routePolicy isKindOfClass:NSDictionary.class] &&
    [routePolicy[@"allowInsecureLan"] isKindOfClass:NSNumber.class];
  if (!complete) {
    // React Native may deliver individual props before the descriptor object.
    // Never activate from a partial revision or tear down a healthy item while
    // the next immutable descriptor is still being assembled.
    return;
  }
  if ([_descriptorRevision isEqualToString:revision]) return;
  NSURL *continuationURLObject = [NSURL URLWithString:continuationURL];
  NSURL *continuationOrigin = [NSURL URLWithString:continuation[@"origin"]];
  NSString *expectedContinuationPath = [NSString stringWithFormat:@"/api/playback-sessions/%@/continuation", sessionID];
  NSNumber *continuationGeneration = continuation[@"generation"];
  NSDate *continuationExpiry = PorticoISO8601Date(continuation[@"expiresAt"]);
  if (![continuationURLObject.path isEqualToString:expectedContinuationPath] || continuationURLObject.query.length || continuationURLObject.fragment.length ||
      ![continuationOrigin isKindOfClass:NSURL.class] || !PorticoSameOrigin(continuationURLObject, continuationOrigin) ||
      !PorticoOriginInAllowlist(continuationURLObject, origins, routePolicy) ||
      !PorticoOriginInAllowlist(continuationOrigin, origins, routePolicy) ||
      ![continuationGeneration isKindOfClass:NSNumber.class] || continuationGeneration.integerValue != generation.integerValue ||
      !continuationExpiry || continuationExpiry.timeIntervalSince1970 <= NSDate.date.timeIntervalSince1970) return;
  BOOL sameResource = _playbackDescriptor &&
    [_sourceURL isEqualToString:descriptorURL] &&
    _itemGeneration == generation.integerValue &&
    [_descriptorAllowedOrigins isEqualToArray:origins];
  BOOL preserveContinuationMailbox = sameResource && [_playbackDescriptor[@"sessionId"] isEqualToString:sessionID];
  if (_playbackDescriptor && !sameResource) [self revokePlaybackContinuation];
  _playbackDescriptor = [playbackDescriptor copy];
  _descriptorRevision = [revision copy];
  _descriptorAllowedOrigins = [origins copy];
  _descriptorRoutePolicy = [routePolicy copy];
  _sourceURL = [descriptorURL copy];
  _authorization = [grant copy];
  if (![_authorization hasPrefix:@"PorticoMedia "]) _authorization = [@"PorticoMedia " stringByAppendingString:_authorization];
  _continuationURL = continuationURLObject;
  _heartbeatContinuationCredential = [continuation[@"token"] copy];
  _continuationExpiresAt = PorticoISO8601Date(continuation[@"expiresAt"]);
  _continuationNextEventSequence = nextEventSequence.integerValue;
  if (!preserveContinuationMailbox) {
    _pendingContinuationEvent = nil;
    _lastContinuationProgressAt = 0;
  }
  id effectiveExpiry = playbackDescriptor[@"effectiveGrantExpiresAt"];
  if ([effectiveExpiry isKindOfClass:NSString.class]) {
    _effectiveGrantExpiresAt = PorticoISO8601Date(effectiveExpiry).timeIntervalSince1970;
  } else {
    _effectiveGrantExpiresAt = [effectiveExpiry doubleValue] / 1000.0;
  }
  self.startPositionSeconds = position.doubleValue;
  self.playbackGeneration = generation.doubleValue;
  if (sameResource && !_terminalItemFailure) {
    [_resourceLoader updateAuthorization:_authorization];
    return;
  }
  _terminalItemFailure = NO;
  [self loadSource];
}

- (void)maybeRenewGrantInBackground {
  if (!_continuationURL || !_heartbeatContinuationCredential || _heartbeatInFlight || _terminalItemFailure) return;
  NSTimeInterval now = NSDate.date.timeIntervalSince1970;
  if (_lastContinuationProgressAt > 0 && now - _lastContinuationProgressAt < 10.0 &&
      (!_continuationExpiresAt || _continuationExpiresAt.timeIntervalSince1970 - now > 60.0)) return;
  _lastContinuationProgressAt = now;
  if (!_pendingContinuationEvent) {
    double position = CMTimeGetSeconds(_player.currentTime);
    double duration = CMTimeGetSeconds(_player.currentItem.duration);
    if (!isfinite(position) || position < 0) position = 0;
    if (!isfinite(duration) || duration < 0) duration = 0;
    NSString *state = _player.timeControlStatus == AVPlayerTimeControlStatusPlaying
      ? @"playing"
      : _player.timeControlStatus == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate
        ? @"buffering"
        : @"paused";
    _pendingContinuationEvent = @{
      @"eventSequence": @(_continuationNextEventSequence),
      @"recordedAt": [[NSISO8601DateFormatter new] stringFromDate:NSDate.date],
      @"progressSeconds": @(position),
      @"durationSeconds": @(duration),
      @"isPlaying": @([state isEqualToString:@"playing"]),
      @"state": state,
    };
  }
  _heartbeatInFlight = YES;
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_continuationURL];
  request.HTTPMethod = @"PATCH";
  request.HTTPShouldHandleCookies = NO;
  [request setValue:[@"PorticoPlayback " stringByAppendingString:_heartbeatContinuationCredential]
    forHTTPHeaderField:@"Authorization"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:_pendingContinuationEvent options:0 error:nil];
  __weak typeof(self) weakSelf = self;
  NSURLSessionDataTask *task = [_heartbeatSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) strongSelf = weakSelf;
      if (!strongSelf) return;
      strongSelf->_heartbeatInFlight = NO;
      NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? [(NSHTTPURLResponse *)response statusCode] : 0;
      if (error || status < 200 || status >= 300) {
        if (strongSelf->_continuationExpiresAt.timeIntervalSince1970 - NSDate.date.timeIntervalSince1970 <= 30.0)
          [strongSelf rotatePlaybackContinuation];
        return;
      }
      NSDictionary *payload = data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      NSNumber *highest = [payload[@"highestEventSequence"] isKindOfClass:NSNumber.class] ? payload[@"highestEventSequence"] : nil;
      NSNumber *mediaGrantExpiry = [payload[@"mediaGrantExpiresAt"] isKindOfClass:NSString.class]
        ? @(PorticoISO8601Date(payload[@"mediaGrantExpiresAt"]).timeIntervalSince1970)
        : nil;
      if (mediaGrantExpiry.doubleValue > 0) strongSelf->_effectiveGrantExpiresAt = mediaGrantExpiry.doubleValue;
      if (highest && highest.integerValue >= [strongSelf->_pendingContinuationEvent[@"eventSequence"] integerValue]) {
        strongSelf->_continuationNextEventSequence = highest.integerValue + 1;
        strongSelf->_pendingContinuationEvent = nil;
      }
      if (strongSelf->_continuationExpiresAt.timeIntervalSince1970 - NSDate.date.timeIntervalSince1970 <= 90.0)
        [strongSelf rotatePlaybackContinuation];
    });
  }];
  [task resume];
}

- (void)rotatePlaybackContinuation {
  if (!_continuationURL || !_heartbeatContinuationCredential || _heartbeatInFlight) return;
  _heartbeatInFlight = YES;
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_continuationURL];
  request.HTTPMethod = @"POST";
  request.HTTPShouldHandleCookies = NO;
  [request setValue:[@"PorticoPlayback " stringByAppendingString:_heartbeatContinuationCredential]
    forHTTPHeaderField:@"Authorization"];
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{@"requestId": NSUUID.UUID.UUIDString} options:0 error:nil];
  __weak typeof(self) weakSelf = self;
  NSURLSessionDataTask *task = [_heartbeatSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) strongSelf = weakSelf;
      if (!strongSelf) return;
      strongSelf->_heartbeatInFlight = NO;
      if (error || ![response isKindOfClass:NSHTTPURLResponse.class] || [(NSHTTPURLResponse *)response statusCode] < 200 || [(NSHTTPURLResponse *)response statusCode] >= 300) return;
      NSDictionary *payload = data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      NSString *token = [payload[@"token"] isKindOfClass:NSString.class] ? payload[@"token"] : nil;
      NSString *expiresAt = [payload[@"expiresAt"] isKindOfClass:NSString.class] ? payload[@"expiresAt"] : nil;
      NSString *origin = [payload[@"origin"] isKindOfClass:NSString.class] ? payload[@"origin"] : nil;
      NSDate *expiry = PorticoISO8601Date(expiresAt);
      if (!token.length || !expiry || !origin.length || !PorticoOriginInAllowlist([NSURL URLWithString:origin], strongSelf->_descriptorAllowedOrigins, strongSelf->_descriptorRoutePolicy)) return;
      strongSelf->_heartbeatContinuationCredential = [token copy];
      strongSelf->_continuationExpiresAt = expiry;
    });
  }];
  [task resume];
}

- (void)revokePlaybackContinuation {
  if (!_continuationURL || !_heartbeatContinuationCredential) return;
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:_continuationURL];
  request.HTTPMethod = @"DELETE";
  request.HTTPShouldHandleCookies = NO;
  [request setValue:[@"PorticoPlayback " stringByAppendingString:_heartbeatContinuationCredential]
    forHTTPHeaderField:@"Authorization"];
  NSURLSessionDataTask *task = [_heartbeatSession dataTaskWithRequest:request];
  [task resume];
  _continuationURL = nil;
  _heartbeatContinuationCredential = nil;
  _continuationExpiresAt = nil;
  _pendingContinuationEvent = nil;
}

- (void)setPlaybackGeneration:(double)playbackGeneration {
  _playbackGeneration = playbackGeneration;
}

- (void)setAllowsPictureInPicture:(BOOL)allowsPictureInPicture {
  if (_allowsPictureInPicture == allowsPictureInPicture) return;
  _allowsPictureInPicture = allowsPictureInPicture;
#if !TARGET_OS_TV
  [self updatePictureInPictureController];
#else
  [self emitCapabilities];
#endif
}

- (void)setContentMode:(NSString *)contentMode {
  _contentMode = [contentMode copy] ?: @"";
#if !TARGET_OS_TV
  [self updatePictureInPictureController];
#endif
  [self updateNowPlayingInfo];
  [self emitCapabilities];
}

- (void)setMetadataTitle:(NSString *)metadataTitle {
  _metadataTitle = [metadataTitle copy] ?: @"";
  [self updateNowPlayingInfo];
}

- (void)setMetadataSubtitle:(NSString *)metadataSubtitle {
  _metadataSubtitle = [metadataSubtitle copy] ?: @"";
  [self updateNowPlayingInfo];
}

- (void)setIsLive:(BOOL)isLive {
  _isLive = isLive;
  [self updateRemoteCommandAvailability];
  [self updateNowPlayingInfo];
}

- (void)setSeekIntervalSeconds:(double)seekIntervalSeconds {
  _seekIntervalSeconds = MAX(1, seekIntervalSeconds);
  [self updateRemoteCommandAvailability];
}

- (void)setWatchWithFriendsControlPolicy:(NSString *)watchWithFriendsControlPolicy {
  NSString *normalized = [watchWithFriendsControlPolicy isEqualToString:@"host"] ||
      [watchWithFriendsControlPolicy isEqualToString:@"participant"]
    ? watchWithFriendsControlPolicy
    : @"independent";
  if ([_watchWithFriendsControlPolicy isEqualToString:normalized]) return;
  _watchWithFriendsControlPolicy = [normalized copy];
  [self updateRemoteCommandAvailability];
}

- (BOOL)musicEligible {
  return [self.contentMode isEqualToString:@"music"];
}

- (BOOL)audiobookEligible {
  return [self.contentMode isEqualToString:@"audiobook"];
}

- (BOOL)videoEligible {
  return [self.contentMode isEqualToString:@"video"] || [self.contentMode isEqualToString:@"live"];
}

- (BOOL)backgroundAudioEligible {
  return self.musicEligible || self.audiobookEligible;
}

- (BOOL)configureAudioSession:(NSError **)error {
  NSString *mode = self.audiobookEligible
    ? AVAudioSessionModeSpokenAudio
    : self.musicEligible ? AVAudioSessionModeDefault : AVAudioSessionModeMoviePlayback;
  return [AVAudioSession.sharedInstance setCategory:AVAudioSessionCategoryPlayback
                                               mode:mode
                                            options:0
                                              error:error];
}

- (void)loadSource {
  _playbackIntended = NO;
  [self deactivateNowPlayingSession];
  if (_observingItem && _player.currentItem) {
    [_player.currentItem removeObserver:self forKeyPath:@"status"];
    _observingItem = NO;
  }
  if (_endObserver) {
    [NSNotificationCenter.defaultCenter removeObserver:_endObserver];
    _endObserver = nil;
  }
  if (_failedToEndObserver) {
    [NSNotificationCenter.defaultCenter removeObserver:_failedToEndObserver];
    _failedToEndObserver = nil;
  }
  _didApplyInitialSeek = NO;
  _itemGeneration = (NSInteger)self.playbackGeneration;
  NSURL *url = [NSURL URLWithString:_sourceURL ?: @""];
  if (!url || !url.scheme.length) {
    [_player replaceCurrentItemWithPlayerItem:nil];
    [self emitPlaybackError:nil fallback:@"Portico received an invalid playback URL."];
    return;
  }
  NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
  for (NSURLQueryItem *item in components.queryItems) {
    if ([item.name isEqualToString:@"media_grant"] ||
        [item.name isEqualToString:@"download_grant"] ||
        [item.name isEqualToString:@"access_token"]) {
      [_player replaceCurrentItemWithPlayerItem:nil];
      [self emitPlaybackError:nil fallback:@"Portico rejected a playback URL containing credentials."];
      return;
    }
  }
  BOOL hasMediaAuthorization = [_authorization hasPrefix:@"PorticoMedia "] &&
    _authorization.length > @"PorticoMedia ".length;
  NSArray *allowedOrigins = _descriptorAllowedOrigins ?: @[];
  NSDictionary *routePolicy = _descriptorRoutePolicy ?: @{};
  BOOL approvedResource = _playbackDescriptor
    ? PorticoApprovedResourceURL(url, allowedOrigins, routePolicy)
    : NO;
  if (hasMediaAuthorization && !approvedResource) {
    [_player replaceCurrentItemWithPlayerItem:nil];
    [self emitPlaybackError:nil fallback:@"Portico rejected an untrusted playback resource."];
    return;
  }
  [_resourceLoader.session invalidateAndCancel];
  _resourceLoader = approvedResource
    ? [[PorticoResourceLoader alloc] initWithOriginURL:url
                                        allowedOrigins:allowedOrigins
                                           routePolicy:routePolicy
                                         authorization:_authorization
                                  allowsCellularAccess:self.allowsCellularAccess]
    : nil;
  NSURL *assetURL = approvedResource ? PorticoSyntheticURL(url) : url;
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:assetURL options:@{
    AVURLAssetAllowsCellularAccessKey: @(self.allowsCellularAccess)
  }];
  if (_resourceLoader) {
    [asset.resourceLoader setDelegate:_resourceLoader queue:_resourceLoader.stateQueue];
  }
  AVPlayerItem *item = [AVPlayerItem playerItemWithAsset:asset];
  [_player replaceCurrentItemWithPlayerItem:item];
  [item addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionInitial | NSKeyValueObservingOptionNew context:NULL];
  _observingItem = YES;
  __weak typeof(self) weakSelf = self;
  _endObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification
                                                                 object:item
                                                                  queue:NSOperationQueue.mainQueue
                                                             usingBlock:^(__unused NSNotification *note) {
    typeof(self) strongSelf = weakSelf;
    if (!strongSelf) return;
    strongSelf->_playbackIntended = NO;
    [strongSelf releaseAudioSessionOwnership];
    strongSelf->_terminalItemFailure = YES;
    [strongSelf revokePlaybackContinuation];
    [strongSelf deactivateNowPlayingSession];
    if (strongSelf.onPlaybackEnd) strongSelf.onPlaybackEnd(@{});
  }];
  _failedToEndObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemFailedToPlayToEndTimeNotification
                                                                          object:item
                                                                           queue:NSOperationQueue.mainQueue
                                                                     usingBlock:^(NSNotification *note) {
    typeof(self) strongSelf = weakSelf;
    if (!strongSelf) return;
    strongSelf->_playbackIntended = NO;
    [strongSelf releaseAudioSessionOwnership];
    strongSelf->_terminalItemFailure = YES;
    [strongSelf revokePlaybackContinuation];
    [strongSelf deactivateNowPlayingSession];
    NSError *error = note.userInfo[AVPlayerItemFailedToPlayToEndTimeErrorKey];
    [strongSelf emitPlaybackError:error fallback:@"This stream stopped unexpectedly."];
  }];
}

- (void)emitCapabilities {
#if TARGET_OS_TV
  NSString *mediaFamily = self.musicEligible ? @"music" : self.audiobookEligible ? @"audiobook" : self.videoEligible ? @"video" : @"unknown";
  BOOL activeIntegration = PorticoActivePlayerView == self;
  if (self.onPlaybackCapabilities) self.onPlaybackCapabilities(@{
    @"backgroundAudio": @(self.backgroundAudioEligible),
    @"mediaFamily": mediaFamily,
    @"nowPlaying": @(activeIntegration),
    @"pictureInPictureActive": @NO,
    @"pictureInPictureEligible": @NO,
    @"pictureInPicturePossible": @NO,
    @"pictureInPictureSupported": @NO,
    @"remoteCommands": @(activeIntegration),
  });
#else
  NSString *mediaFamily = self.musicEligible ? @"music" : self.audiobookEligible ? @"audiobook" : self.videoEligible ? @"video" : @"unknown";
  BOOL supported = [AVPictureInPictureController isPictureInPictureSupported];
  BOOL activeIntegration = PorticoActivePlayerView == self;
  if (self.onPlaybackCapabilities) self.onPlaybackCapabilities(@{
    @"backgroundAudio": @(self.backgroundAudioEligible),
    @"mediaFamily": mediaFamily,
    @"nowPlaying": @(activeIntegration),
    @"pictureInPictureActive": @(_pictureInPictureController.pictureInPictureActive),
    @"pictureInPictureEligible": @(self.allowsPictureInPicture && self.videoEligible),
    @"pictureInPicturePossible": @(supported && _pictureInPictureController.pictureInPicturePossible),
    @"pictureInPictureSupported": @(supported),
    @"remoteCommands": @(activeIntegration),
  });
#endif
}

#if !TARGET_OS_TV
- (void)updatePictureInPictureController {
  BOOL shouldExist = self.allowsPictureInPicture && self.videoEligible && [AVPictureInPictureController isPictureInPictureSupported];
  if (!shouldExist && _pictureInPictureController) {
    if (_pictureInPictureController.pictureInPictureActive) [_pictureInPictureController stopPictureInPicture];
    _pictureInPictureStarting = NO;
    if (_observingPictureInPicturePossible) {
      [_pictureInPictureController removeObserver:self forKeyPath:@"pictureInPicturePossible"];
      _observingPictureInPicturePossible = NO;
    }
    _pictureInPictureController.delegate = nil;
    _pictureInPictureController = nil;
  } else if (shouldExist && !_pictureInPictureController) {
    _pictureInPictureController = [[AVPictureInPictureController alloc] initWithPlayerLayer:_playerLayer];
    _pictureInPictureController.delegate = self;
    _pictureInPictureController.canStartPictureInPictureAutomaticallyFromInline = YES;
    [_pictureInPictureController addObserver:self
                                  forKeyPath:@"pictureInPicturePossible"
                                     options:NSKeyValueObservingOptionInitial | NSKeyValueObservingOptionNew
                                     context:NULL];
    _observingPictureInPicturePossible = YES;
  }
  [self emitCapabilities];
}

- (void)emitPictureInPictureState:(NSString *)state {
  if (self.onPictureInPictureChange) self.onPictureInPictureChange(@{@"state": state});
  [self emitCapabilities];
}

- (void)startPictureInPicture {
  if (!_pictureInPictureController.pictureInPicturePossible) {
    [self emitPictureInPictureState:@"failed"];
    return;
  }
  _pictureInPictureStarting = YES;
  [self emitPictureInPictureState:@"starting"];
  [_pictureInPictureController startPictureInPicture];
}

- (void)stopPictureInPicture {
  if (!_pictureInPictureController.pictureInPictureActive) return;
  _pictureInPictureStarting = NO;
  [self emitPictureInPictureState:@"stopping"];
  [_pictureInPictureController stopPictureInPicture];
}

- (void)pictureInPictureControllerDidStartPictureInPicture:(AVPictureInPictureController *)pictureInPictureController {
  _pictureInPictureStarting = NO;
  [self emitPictureInPictureState:@"active"];
}

- (void)pictureInPictureControllerWillStartPictureInPicture:(AVPictureInPictureController *)pictureInPictureController {
  if (!_pictureInPictureStarting) {
    _pictureInPictureStarting = YES;
    [self emitPictureInPictureState:@"starting"];
  }
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController failedToStartPictureInPictureWithError:(NSError *)error {
  _pictureInPictureStarting = NO;
  [self emitPictureInPictureState:@"failed"];
}

- (void)pictureInPictureControllerDidStopPictureInPicture:(AVPictureInPictureController *)pictureInPictureController {
  _pictureInPictureStarting = NO;
  [self emitPictureInPictureState:@"inactive"];
}

- (void)pictureInPictureController:(AVPictureInPictureController *)pictureInPictureController restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:(void (^)(BOOL restored))completionHandler {
  if (_pictureInPictureRestoreCompletion) {
    void (^priorCompletion)(BOOL) = _pictureInPictureRestoreCompletion;
    _pictureInPictureRestoreCompletion = nil;
    priorCompletion(NO);
  }
  NSString *requestID = [NSUUID UUID].UUIDString;
  _pictureInPictureRestoreRequestID = requestID;
  _pictureInPictureRestoreCompletion = [completionHandler copy];
  if (self.onPictureInPictureChange) self.onPictureInPictureChange(@{
    @"state": @"restore-requested",
    @"requestId": requestID,
  });
  __weak typeof(self) weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    typeof(self) strongSelf = weakSelf;
    if (!strongSelf || ![strongSelf->_pictureInPictureRestoreRequestID isEqualToString:requestID]) return;
    [strongSelf completePictureInPictureRestore:requestID restored:NO];
  });
}

- (void)completePictureInPictureRestore:(NSString *)requestID restored:(BOOL)restored {
  if (!requestID.length || ![_pictureInPictureRestoreRequestID isEqualToString:requestID] || !_pictureInPictureRestoreCompletion) return;
  BOOL visiblyRestored = restored && self.window != nil && self.superview != nil && !self.hidden && self.alpha > 0.01;
  void (^completion)(BOOL) = _pictureInPictureRestoreCompletion;
  _pictureInPictureRestoreCompletion = nil;
  _pictureInPictureRestoreRequestID = nil;
  completion(visiblyRestored);
  if (!visiblyRestored) [self emitPictureInPictureState:@"restore-required"];
}
#endif

- (void)installRemoteCommandsIfNeeded {
  if (PorticoRemoteCommandsInstalled) return;
  PorticoRemoteCommandsInstalled = YES;
  MPRemoteCommandCenter *commands = MPRemoteCommandCenter.sharedCommandCenter;
  [commands.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) {
    PorticoPlayerView *target = PorticoActivePlayerView;
    if (!target) return MPRemoteCommandHandlerStatusNoSuchContent;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"participant"]) return MPRemoteCommandHandlerStatusCommandFailed;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (target.onRemotePlaybackCommand) target.onRemotePlaybackCommand(@{@"action": @"play"});
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [target play]; });
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [commands.pauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) {
    PorticoPlayerView *target = PorticoActivePlayerView;
    if (!target) return MPRemoteCommandHandlerStatusNoSuchContent;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"participant"]) return MPRemoteCommandHandlerStatusCommandFailed;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (target.onRemotePlaybackCommand) target.onRemotePlaybackCommand(@{@"action": @"pause"});
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [target pause]; });
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [commands.togglePlayPauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) {
    PorticoPlayerView *target = PorticoActivePlayerView;
    if (!target) return MPRemoteCommandHandlerStatusNoSuchContent;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"participant"]) return MPRemoteCommandHandlerStatusCommandFailed;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (target.onRemotePlaybackCommand) target.onRemotePlaybackCommand(@{@"action": @"toggle"});
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      target->_playbackIntended ? [target pause] : [target play];
    });
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [commands.changePlaybackPositionCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
    PorticoPlayerView *target = PorticoActivePlayerView;
    if (!target || target.isLive || ![event isKindOfClass:MPChangePlaybackPositionCommandEvent.class]) return MPRemoteCommandHandlerStatusCommandFailed;
    double position = ((MPChangePlaybackPositionCommandEvent *)event).positionTime;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"participant"]) return MPRemoteCommandHandlerStatusCommandFailed;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (target.onRemotePlaybackCommand) target.onRemotePlaybackCommand(@{@"action": @"seek", @"positionSeconds": @(MAX(0, position))});
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [target seekTo:position]; });
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [commands.skipForwardCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) {
    PorticoPlayerView *target = PorticoActivePlayerView;
    if (!target || target.isLive) return MPRemoteCommandHandlerStatusCommandFailed;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"participant"]) return MPRemoteCommandHandlerStatusCommandFailed;
    double position = CMTimeGetSeconds(target->_player.currentTime) + target.seekIntervalSeconds;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (target.onRemotePlaybackCommand) target.onRemotePlaybackCommand(@{@"action": @"seek", @"positionSeconds": @(MAX(0, position))});
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [target seekTo:position]; });
    return MPRemoteCommandHandlerStatusSuccess;
  }];
  [commands.skipBackwardCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(__unused MPRemoteCommandEvent *event) {
    PorticoPlayerView *target = PorticoActivePlayerView;
    if (!target || target.isLive) return MPRemoteCommandHandlerStatusCommandFailed;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"participant"]) return MPRemoteCommandHandlerStatusCommandFailed;
    double position = CMTimeGetSeconds(target->_player.currentTime) - target.seekIntervalSeconds;
    if ([target.watchWithFriendsControlPolicy isEqualToString:@"host"]) {
      dispatch_async(dispatch_get_main_queue(), ^{
        if (target.onRemotePlaybackCommand) target.onRemotePlaybackCommand(@{@"action": @"seek", @"positionSeconds": @(MAX(0, position))});
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }
    dispatch_async(dispatch_get_main_queue(), ^{ [target seekTo:position]; });
    return MPRemoteCommandHandlerStatusSuccess;
  }];
}

- (void)activateNowPlayingSession {
  PorticoActivePlayerView = self;
  [self updateRemoteCommandAvailability];
  [self updateNowPlayingInfo];
}

- (void)deactivateNowPlayingSession {
  if (PorticoActivePlayerView != self) return;
  PorticoActivePlayerView = nil;
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
  [self updateRemoteCommandAvailability];
  [self emitCapabilities];
}

- (void)updateRemoteCommandAvailability {
  MPRemoteCommandCenter *commands = MPRemoteCommandCenter.sharedCommandCenter;
  BOOL active = PorticoActivePlayerView != nil;
  BOOL groupParticipant = active && [PorticoActivePlayerView.watchWithFriendsControlPolicy isEqualToString:@"participant"];
  BOOL controllable = active && !groupParticipant;
  BOOL seekable = controllable && !PorticoActivePlayerView.isLive;
  commands.playCommand.enabled = controllable;
  commands.pauseCommand.enabled = controllable;
  commands.togglePlayPauseCommand.enabled = controllable;
  commands.changePlaybackPositionCommand.enabled = seekable;
  commands.skipForwardCommand.enabled = seekable;
  commands.skipBackwardCommand.enabled = seekable;
  if (active) {
    NSNumber *interval = @(MAX(1, PorticoActivePlayerView.seekIntervalSeconds));
    commands.skipForwardCommand.preferredIntervals = @[interval];
    commands.skipBackwardCommand.preferredIntervals = @[interval];
  }
}

- (void)updateNowPlayingInfo {
  if (PorticoActivePlayerView != self) return;
  double position = CMTimeGetSeconds(_player.currentTime);
  double duration = CMTimeGetSeconds(_player.currentItem.duration);
  NSMutableDictionary *info = [NSMutableDictionary new];
  if (self.metadataTitle.length) info[MPMediaItemPropertyTitle] = self.metadataTitle;
  if (self.metadataSubtitle.length) info[MPMediaItemPropertyAlbumTitle] = self.metadataSubtitle;
  info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(isfinite(position) ? MAX(0, position) : 0);
  info[MPNowPlayingInfoPropertyPlaybackRate] = @(_player.timeControlStatus == AVPlayerTimeControlStatusPlaying ? 1 : 0);
  info[MPNowPlayingInfoPropertyIsLiveStream] = @(self.isLive);
  if (!self.isLive && isfinite(duration) && duration > 0) info[MPMediaItemPropertyPlaybackDuration] = @(duration);
  MPMediaType mediaType = self.audiobookEligible ? MPMediaTypeAudioBook : self.musicEligible ? MPMediaTypeMusic : MPMediaTypeAnyVideo;
  info[MPMediaItemPropertyMediaType] = @(mediaType);
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = info;
}
#if TARGET_OS_TV
- (void)startPictureInPicture { [self emitCapabilities]; }
- (void)stopPictureInPicture { [self emitCapabilities]; }
- (void)completePictureInPictureRestore:(NSString *)requestID restored:(BOOL)restored { [self emitCapabilities]; }
#endif

- (BOOL)isNestedAuthorizationError:(NSError *)error seen:(NSHashTable<NSError *> *)seen {
  if (!error || [seen containsObject:error]) return NO;
  [seen addObject:error];
  if ([error.domain isEqualToString:@"PorticoPlaybackHTTPError"] &&
      (error.code == 401 || error.code == 403)) return YES;
  if ([error.domain isEqualToString:NSURLErrorDomain] &&
      (error.code == NSURLErrorUserAuthenticationRequired || error.code == NSURLErrorUserCancelledAuthentication)) return YES;
  NSError *nested = error.userInfo[NSUnderlyingErrorKey] ?: error.userInfo[@"underlyingError"];
  return [self isNestedAuthorizationError:nested seen:seen];
}

- (void)emitPlaybackError:(NSError *)error fallback:(NSString *)fallback {
  if (!self.onPlaybackError) return;
  NSString *message = error.localizedDescription.length ? error.localizedDescription : fallback;
  NSString *category = @"decoder";
  if ([self isNestedAuthorizationError:error seen:[NSHashTable weakObjectsHashTable]]) {
    category = @"grant";
  } else if ([error.domain isEqualToString:@"PorticoPlaybackHTTPError"]) {
    category = [error.userInfo[@"PorticoPlaybackCategory"] isEqualToString:@"grant"] ? @"grant" : @"server-product";
  } else if ([error.domain isEqualToString:NSURLErrorDomain]) {
    category = (error.code == NSURLErrorUserAuthenticationRequired ||
                error.code == NSURLErrorUserCancelledAuthentication)
      ? @"grant"
      : @"route";
  } else if ([error.domain isEqualToString:@"AVAudioSessionErrorDomain"]) {
    category = @"configuration";
  }
  self.onPlaybackError(@{
    @"kind": @"playback",
    @"category": category,
    @"message": message ?: @"This stream could not be played.",
    @"domain": error.domain ?: @"AVFoundation",
    @"code": @(error ? error.code : 0),
  });
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary<NSKeyValueChangeKey,id> *)change context:(void *)context {
  if (object == _player && [keyPath isEqualToString:@"timeControlStatus"]) {
    [self emitState];
    return;
  }
  if (object == _player.currentItem && [keyPath isEqualToString:@"status"]) {
    [self itemStatusChanged:(AVPlayerItem *)object];
    return;
  }
#if !TARGET_OS_TV
  if (object == _pictureInPictureController && [keyPath isEqualToString:@"pictureInPicturePossible"]) {
    [self emitCapabilities];
    return;
  }
#endif
  [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}

- (void)itemStatusChanged:(AVPlayerItem *)item {
  if (item.status == AVPlayerItemStatusFailed) {
    _playbackIntended = NO;
    _terminalItemFailure = YES;
    [self releaseAudioSessionOwnership];
    [self revokePlaybackContinuation];
    [self deactivateNowPlayingSession];
    [self emitPlaybackError:item.error fallback:@"This stream could not be played."];
    return;
  }
  if (item.status != AVPlayerItemStatusReadyToPlay) return;
  if (!_didApplyInitialSeek && self.startPositionSeconds > 0) {
    _didApplyInitialSeek = YES;
    CMTime target = CMTimeMakeWithSeconds(self.startPositionSeconds, NSEC_PER_SEC);
    NSInteger generation = _itemGeneration;
    __weak typeof(self) weakSelf = self;
    [_player seekToTime:target
       toleranceBefore:kCMTimeZero
        toleranceAfter:kCMTimeZero
     completionHandler:^(BOOL finished) {
      dispatch_async(dispatch_get_main_queue(), ^{
        typeof(self) strongSelf = weakSelf;
        if (!strongSelf || !finished || strongSelf->_player.currentItem != item ||
            strongSelf->_itemGeneration != generation ||
            (NSInteger)strongSelf.playbackGeneration != generation) return;
        if (strongSelf.autoplay) [strongSelf play];
        [strongSelf emitState];
      });
    }];
  } else if (self.autoplay) {
    [self play];
  }
  [self emitState];
}

- (void)emitProgressAt:(CMTime)time {
  if (!CMTIME_IS_NUMERIC(time)) return;
  double position = MAX(0, CMTimeGetSeconds(time));
  double duration = CMTimeGetSeconds(_player.currentItem.duration);
  if (self.onPlaybackProgress) {
    self.onPlaybackProgress(@{
      @"positionSeconds": @(isfinite(position) ? position : 0),
      @"durationSeconds": @(isfinite(duration) ? MAX(0, duration) : 0),
      @"isPlaying": @(_player.timeControlStatus == AVPlayerTimeControlStatusPlaying),
    });
  }
  [self maybeRenewGrantInBackground];
  [self updateNowPlayingInfo];
}

- (void)emitState {
  NSString *state = @"paused";
  if (_player.timeControlStatus == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate) state = @"buffering";
  else if (_player.timeControlStatus == AVPlayerTimeControlStatusPlaying) state = @"playing";
  else if (_player.currentItem.status == AVPlayerItemStatusUnknown) state = @"loading";
  if (self.onPlaybackState) self.onPlaybackState(@{@"state": state});
  [self updateRemoteCommandAvailability];
  [self updateNowPlayingInfo];
}

- (void)play {
  NSError *error = nil;
  if (![self configureAudioSession:&error] || ![AVAudioSession.sharedInstance setActive:YES error:&error]) {
    _playbackIntended = NO;
    [self releaseAudioSessionOwnership];
    [self deactivateNowPlayingSession];
    if (self.onPlaybackError) self.onPlaybackError(@{
      @"kind": @"audio-session",
      @"category": @"configuration",
      @"message": error.localizedDescription.length ? error.localizedDescription : @"Portico could not activate audio playback.",
      @"domain": error.domain ?: @"AVAudioSession",
      @"code": @(error ? error.code : 0),
    });
    return;
  }
  _playbackIntended = YES;
  _audioSessionActive = YES;
  @synchronized (PorticoPlayerView.class) {
    if (!PorticoAudioSessionOwners) {
      PorticoAudioSessionOwners = [NSHashTable weakObjectsHashTable];
    }
    [PorticoAudioSessionOwners addObject:self];
  }
  [self activateNowPlayingSession];
  [_player playImmediatelyAtRate:_desiredPlaybackRate];
}
- (void)setPlaybackRate:(double)rate {
  if (!isfinite(rate) || rate < 0.5 || rate > 2.0) return;
  _desiredPlaybackRate = rate;
  if (_player.timeControlStatus == AVPlayerTimeControlStatusPlaying) {
    _player.rate = rate;
  }
  [self updateNowPlayingInfo];
}
- (void)setVolume:(double)volume {
  _player.volume = fmax(0.0, fmin(1.0, volume));
}
- (void)setSleepTimerDeadline:(double)deadlineMilliseconds {
  _sleepTimerDeadlineMilliseconds =
    isfinite(deadlineMilliseconds) && deadlineMilliseconds > NSDate.date.timeIntervalSince1970 * 1000.0
      ? deadlineMilliseconds
      : 0;
}
- (void)pause {
  _playbackIntended = NO;
  [_player pause];
  [self updateNowPlayingInfo];
}
- (void)seekTo:(double)seconds {
  if (self.isLive || !isfinite(seconds)) return;
  CMTime target = CMTimeMakeWithSeconds(MAX(0, seconds), NSEC_PER_SEC);
  [_player seekToTime:target toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero];
  [self updateNowPlayingInfo];
}
@end

@interface PorticoPlayerViewManager : RCTViewManager
@end

@implementation PorticoPlayerViewManager
RCT_EXPORT_MODULE(PorticoPlayerView)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (NSDictionary *)constantsToExport {
  return @{ @"applePlaybackProfile": PorticoApplePlaybackProfile() };
}
- (UIView *)view { return [PorticoPlayerView new]; }
RCT_EXPORT_METHOD(probeCapabilities:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(PorticoApplePlaybackProfile());
}
RCT_EXPORT_VIEW_PROPERTY(sourceURL, NSString)
RCT_EXPORT_VIEW_PROPERTY(authorization, NSString)
RCT_EXPORT_VIEW_PROPERTY(playbackDescriptor, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(autoplay, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsCellularAccess, BOOL)
RCT_EXPORT_VIEW_PROPERTY(allowsPictureInPicture, BOOL)
RCT_EXPORT_VIEW_PROPERTY(isLive, BOOL)
RCT_EXPORT_VIEW_PROPERTY(contentMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(metadataTitle, NSString)
RCT_EXPORT_VIEW_PROPERTY(metadataSubtitle, NSString)
RCT_EXPORT_VIEW_PROPERTY(watchWithFriendsControlPolicy, NSString)
RCT_EXPORT_VIEW_PROPERTY(seekIntervalSeconds, double)
RCT_EXPORT_VIEW_PROPERTY(startPositionSeconds, double)
RCT_EXPORT_VIEW_PROPERTY(playbackGeneration, double)
RCT_EXPORT_VIEW_PROPERTY(onPlaybackState, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPlaybackProgress, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPlaybackError, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPlaybackEnd, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPlaybackCapabilities, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPictureInPictureChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPlaybackInterruption, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onRemotePlaybackCommand, RCTDirectEventBlock)

RCT_EXPORT_METHOD(play:(nonnull NSNumber *)reactTag) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view play];
  }];
}
RCT_EXPORT_METHOD(pause:(nonnull NSNumber *)reactTag) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view pause];
  }];
}
RCT_EXPORT_METHOD(seekTo:(nonnull NSNumber *)reactTag seconds:(double)seconds) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view seekTo:seconds];
  }];
}
RCT_EXPORT_METHOD(setPlaybackRate:(nonnull NSNumber *)reactTag rate:(double)rate) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view setPlaybackRate:rate];
  }];
}
RCT_EXPORT_METHOD(setVolume:(nonnull NSNumber *)reactTag volume:(double)volume) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view setVolume:volume];
  }];
}
RCT_EXPORT_METHOD(setSleepTimerDeadline:(nonnull NSNumber *)reactTag deadlineMilliseconds:(double)deadlineMilliseconds) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view setSleepTimerDeadline:deadlineMilliseconds];
  }];
}
RCT_EXPORT_METHOD(startPictureInPicture:(nonnull NSNumber *)reactTag) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view startPictureInPicture];
  }];
}
RCT_EXPORT_METHOD(stopPictureInPicture:(nonnull NSNumber *)reactTag) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view stopPictureInPicture];
  }];
}
RCT_EXPORT_METHOD(completePictureInPictureRestore:(nonnull NSNumber *)reactTag requestID:(NSString *)requestID restored:(BOOL)restored) {
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *manager, NSDictionary<NSNumber *, UIView *> *registry) {
    UIView *view = registry[reactTag];
    if ([view isKindOfClass:PorticoPlayerView.class]) [(PorticoPlayerView *)view completePictureInPictureRestore:requestID restored:restored];
  }];
}
@end
