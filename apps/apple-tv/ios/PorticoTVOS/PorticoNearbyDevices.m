#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <arpa/inet.h>
#import <fcntl.h>
#import <netdb.h>
#import <sys/socket.h>
#import <unistd.h>

static NSString *const PorticoNearbyEvent = @"PorticoNearbyDeviceChanged";
static NSString *const PorticoSetupServiceType = @"_portico-setup._tcp.";
static NSString *const PorticoServerServiceType = @"_portico._tcp.";
static NSString *const PorticoReceiverServiceType = @"_portico-receiver._tcp.";
static NSString *const PorticoReceiverCommandEvent = @"PorticoPlaybackReceiverCommand";
static const NSUInteger PorticoReceiverMaximumFrameBytes = 65536;

static NSArray<NSString *> *PorticoNumericAddresses(NSNetService *service) {
  NSMutableOrderedSet<NSString *> *addresses = [NSMutableOrderedSet orderedSet];
  for (NSData *data in service.addresses ?: @[]) {
    if (data.length < sizeof(struct sockaddr)) continue;
    const struct sockaddr *address = data.bytes;
    if (address->sa_family != AF_INET && address->sa_family != AF_INET6) continue;
    char host[NI_MAXHOST] = {0};
    if (getnameinfo(address, (socklen_t)data.length, host, sizeof(host), NULL, 0, NI_NUMERICHOST) == 0) {
      NSString *value = [NSString stringWithUTF8String:host];
      if (value.length > 0) [addresses addObject:value];
    }
  }
  return addresses.array;
}

static BOOL PorticoSendFrame(int descriptor, NSData *frame) {
  const uint8_t *bytes = frame.bytes; NSUInteger offset = 0;
  while (offset < frame.length) {
    ssize_t count = send(descriptor, bytes + offset, frame.length - offset, 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return NO;
    offset += (NSUInteger)count;
  }
  return YES;
}

@interface PorticoNearbyDevices : RCTEventEmitter <RCTBridgeModule, NSNetServiceBrowserDelegate, NSNetServiceDelegate>
@property(nonatomic, strong) NSMutableArray<NSNetServiceBrowser *> *browsers;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSNetService *> *services;
@property(nonatomic, strong) NSNetService *advertisedSetup;
@property(nonatomic, strong) NSData *advertisedSetupTXT;
@property(nonatomic, strong) NSNetService *advertisedReceiver;
@property(nonatomic, strong) NSData *advertisedReceiverTXT;
@property(nonatomic, assign) BOOL observing;
@property(nonatomic, strong) dispatch_queue_t receiverQueue;
@property(nonatomic, assign) int receiverListenerFD;
@property(nonatomic, strong) dispatch_source_t receiverListenerSource;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *receiverConnections;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableData *> *receiverBuffers;
@end

@implementation PorticoNearbyDevices
RCT_EXPORT_MODULE(PorticoNearbyDevices)
+ (BOOL)requiresMainQueueSetup { return YES; }

RCT_EXPORT_METHOD(logDiagnostic:(NSString *)stage details:(NSDictionary *)details) {
  NSLog(@"[PorticoDiagnostic] %@ %@", stage ?: @"unknown", details ?: @{});
}
- (instancetype)init { if ((self = [super init])) { _browsers = [NSMutableArray new]; _services = [NSMutableDictionary new]; _receiverQueue = dispatch_queue_create("tv.portico.receiver", DISPATCH_QUEUE_SERIAL); _receiverListenerFD = -1; _receiverConnections = [NSMutableDictionary new]; _receiverBuffers = [NSMutableDictionary new]; } return self; }
- (NSArray<NSString *> *)supportedEvents { return @[PorticoNearbyEvent, PorticoReceiverCommandEvent]; }
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }

RCT_REMAP_METHOD(startBrowsing, serviceTypes:(NSArray<NSString *> *)serviceTypes browserResolver:(RCTPromiseResolveBlock)resolve browserRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{ [self stopAllBrowsers]; for (NSString *rawType in serviceTypes) { NSString *type = [self normalizedServiceType:rawType]; if (![type isEqualToString:PorticoSetupServiceType] && ![type isEqualToString:PorticoServerServiceType] && ![type isEqualToString:PorticoReceiverServiceType]) continue; NSNetServiceBrowser *browser = [NSNetServiceBrowser new]; browser.delegate = self; [self.browsers addObject:browser]; [browser searchForServicesOfType:type inDomain:@"local."]; } resolve(nil); });
}
RCT_REMAP_METHOD(stopBrowsing, stopBrowserResolver:(RCTPromiseResolveBlock)resolve stopBrowserRejecter:(RCTPromiseRejectBlock)reject) { dispatch_async(dispatch_get_main_queue(), ^{ [self stopAllBrowsers]; resolve(nil); }); }
RCT_REMAP_METHOD(startAdvertisingSetup, instanceName:(NSString *)instanceName setupTXT:(NSDictionary<NSString *, NSString *> *)txt advertiseResolver:(RCTPromiseResolveBlock)resolve advertiseRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{ [self.advertisedSetup stop]; self.advertisedSetup = [[NSNetService alloc] initWithDomain:@"local." type:PorticoSetupServiceType name:instanceName port:9]; NSMutableDictionary<NSString *, NSData *> *encoded = [NSMutableDictionary new]; [txt enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) { if ([key isKindOfClass:NSString.class] && [value isKindOfClass:NSString.class]) encoded[key] = [value dataUsingEncoding:NSUTF8StringEncoding]; }]; self.advertisedSetupTXT = [NSNetService dataFromTXTRecordDictionary:encoded]; self.advertisedSetup.delegate = self; [self.advertisedSetup setTXTRecordData:self.advertisedSetupTXT]; [self.advertisedSetup publishWithOptions:NSNetServiceNoAutoRename]; resolve(nil); });
}
RCT_REMAP_METHOD(stopAdvertisingSetup, stopAdvertiseResolver:(RCTPromiseResolveBlock)resolve stopAdvertiseRejecter:(RCTPromiseRejectBlock)reject) { dispatch_async(dispatch_get_main_queue(), ^{ [self.advertisedSetup stop]; self.advertisedSetup = nil; self.advertisedSetupTXT = nil; resolve(nil); }); }
RCT_REMAP_METHOD(startAdvertisingReceiver, receiverInstanceName:(NSString *)instanceName receiverPort:(NSInteger)port receiverTXT:(NSDictionary<NSString *, NSString *> *)txt receiverAdvertiseResolver:(RCTPromiseResolveBlock)resolve receiverAdvertiseRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{ if (port < 1 || port > 65535) { reject(@"invalid_receiver_port", @"The playback receiver port is invalid.", nil); return; } [self.advertisedReceiver stop]; self.advertisedReceiver = [[NSNetService alloc] initWithDomain:@"local." type:PorticoReceiverServiceType name:instanceName port:(int)port]; NSMutableDictionary<NSString *, NSData *> *encoded = [NSMutableDictionary new]; [txt enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) { if ([key isKindOfClass:NSString.class] && [value isKindOfClass:NSString.class]) encoded[key] = [value dataUsingEncoding:NSUTF8StringEncoding]; }]; self.advertisedReceiverTXT = [NSNetService dataFromTXTRecordDictionary:encoded]; self.advertisedReceiver.delegate = self; [self.advertisedReceiver setTXTRecordData:self.advertisedReceiverTXT]; [self.advertisedReceiver publishWithOptions:NSNetServiceNoAutoRename]; resolve(nil); });
}
RCT_REMAP_METHOD(stopAdvertisingReceiver, stopReceiverResolver:(RCTPromiseResolveBlock)resolve stopReceiverRejecter:(RCTPromiseRejectBlock)reject) { dispatch_async(dispatch_get_main_queue(), ^{ [self.advertisedReceiver stop]; self.advertisedReceiver = nil; self.advertisedReceiverTXT = nil; resolve(nil); }); }

RCT_REMAP_METHOD(startPlaybackReceiver, receiverStartResolver:(RCTPromiseResolveBlock)resolve receiverStartRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(self.receiverQueue, ^{
    [self stopPlaybackReceiverLocked];
    int listener = socket(AF_INET6, SOCK_STREAM, 0);
    if (listener < 0) { reject(@"receiver_socket_failed", @"The nearby playback receiver could not create a listener.", nil); return; }
    int enabled = 1, disabled = 0;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
    setsockopt(listener, IPPROTO_IPV6, IPV6_V6ONLY, &disabled, sizeof(disabled));
    struct sockaddr_in6 address = {0}; address.sin6_len = sizeof(address); address.sin6_family = AF_INET6; address.sin6_addr = in6addr_any; address.sin6_port = 0;
    if (bind(listener, (struct sockaddr *)&address, sizeof(address)) != 0 || listen(listener, 8) != 0) { close(listener); reject(@"receiver_bind_failed", @"The nearby playback receiver could not bind its local listener.", nil); return; }
    fcntl(listener, F_SETFL, O_NONBLOCK);
    socklen_t length = sizeof(address);
    if (getsockname(listener, (struct sockaddr *)&address, &length) != 0) { close(listener); reject(@"receiver_port_failed", @"The nearby playback receiver could not determine its local port.", nil); return; }
    self.receiverListenerFD = listener;
    self.receiverListenerSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)listener, 0, self.receiverQueue);
    __weak typeof(self) weakSelf = self;
    dispatch_source_set_event_handler(self.receiverListenerSource, ^{ [weakSelf acceptPlaybackReceiverConnections]; });
    dispatch_source_set_cancel_handler(self.receiverListenerSource, ^{ close(listener); });
    dispatch_resume(self.receiverListenerSource);
    resolve(@{@"port": @(ntohs(address.sin6_port))});
  });
}

RCT_REMAP_METHOD(stopPlaybackReceiver, receiverStopResolver:(RCTPromiseResolveBlock)resolve receiverStopRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(self.receiverQueue, ^{ [self stopPlaybackReceiverLocked]; resolve(nil); });
}

RCT_REMAP_METHOD(replyToPlaybackReceiver, receiverConnectionId:(NSString *)connectionId receiverReply:(NSDictionary *)reply receiverReplyResolver:(RCTPromiseResolveBlock)resolve receiverReplyRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(self.receiverQueue, ^{
    NSNumber *descriptor = self.receiverConnections[connectionId];
    if (!descriptor) { reject(@"receiver_connection_closed", @"The nearby playback command connection is closed.", nil); return; }
    NSError *error = nil; NSData *json = [NSJSONSerialization dataWithJSONObject:reply options:0 error:&error];
    if (!json || json.length > PorticoReceiverMaximumFrameBytes) { [self closeReceiverConnection:connectionId]; reject(@"receiver_reply_invalid", @"The nearby playback reply was invalid.", error); return; }
    NSMutableData *frame = [json mutableCopy]; uint8_t newline = '\n'; [frame appendBytes:&newline length:1];
    BOOL sent = PorticoSendFrame(descriptor.intValue, frame);
    [self closeReceiverConnection:connectionId];
    if (!sent) { reject(@"receiver_reply_failed", @"The nearby playback reply could not be sent.", nil); return; }
    resolve(nil);
  });
}

RCT_REMAP_METHOD(sendPlaybackReceiverCommand, receiverHost:(NSString *)host receiverCommandPort:(NSInteger)port receiverSealedCommand:(NSDictionary *)sealed receiverCommandResolver:(RCTPromiseResolveBlock)resolve receiverCommandRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{ [self sendPlaybackReceiverCommandToHost:host port:port sealed:sealed resolve:resolve reject:reject]; });
}

- (void)acceptPlaybackReceiverConnections {
  while (self.receiverListenerFD >= 0) {
    int descriptor = accept(self.receiverListenerFD, NULL, NULL);
    if (descriptor < 0) break;
    int noPipe = 1; setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, sizeof(noPipe));
    NSString *connectionId = NSUUID.UUID.UUIDString;
    self.receiverConnections[connectionId] = @(descriptor);
    self.receiverBuffers[connectionId] = [NSMutableData new];
    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)descriptor, 0, self.receiverQueue);
    __weak typeof(self) weakSelf = self;
    dispatch_source_set_event_handler(source, ^{ [weakSelf readPlaybackReceiverConnection:connectionId source:source]; });
    dispatch_resume(source);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), self.receiverQueue, ^{ [weakSelf closeReceiverConnection:connectionId]; });
  }
}

- (void)readPlaybackReceiverConnection:(NSString *)connectionId source:(dispatch_source_t)source {
  NSNumber *descriptor = self.receiverConnections[connectionId]; if (!descriptor) { dispatch_source_cancel(source); return; }
  uint8_t bytes[4096]; ssize_t count = recv(descriptor.intValue, bytes, sizeof(bytes), 0);
  if (count <= 0) { if (count == 0 || errno != EAGAIN) [self closeReceiverConnection:connectionId]; return; }
  NSMutableData *buffer = self.receiverBuffers[connectionId]; [buffer appendBytes:bytes length:(NSUInteger)count];
  if (buffer.length > PorticoReceiverMaximumFrameBytes) { [self closeReceiverConnection:connectionId]; return; }
  const uint8_t *raw = buffer.bytes; NSUInteger newline = NSNotFound;
  for (NSUInteger index = 0; index < buffer.length; index++) if (raw[index] == '\n') { newline = index; break; }
  if (newline == NSNotFound) return;
  NSData *frame = [buffer subdataWithRange:NSMakeRange(0, newline)];
  NSDictionary *sealed = [NSJSONSerialization JSONObjectWithData:frame options:0 error:nil];
  if (![sealed isKindOfClass:NSDictionary.class]) { [self closeReceiverConnection:connectionId]; return; }
  dispatch_source_cancel(source);
  dispatch_async(dispatch_get_main_queue(), ^{ if (self.observing) [self sendEventWithName:PorticoReceiverCommandEvent body:@{@"connectionId": connectionId, @"sealed": sealed}]; });
}

- (void)closeReceiverConnection:(NSString *)connectionId {
  NSNumber *descriptor = self.receiverConnections[connectionId];
  if (descriptor) close(descriptor.intValue);
  [self.receiverConnections removeObjectForKey:connectionId]; [self.receiverBuffers removeObjectForKey:connectionId];
}

- (void)stopPlaybackReceiverLocked {
  if (self.receiverListenerSource) { dispatch_source_cancel(self.receiverListenerSource); self.receiverListenerSource = nil; }
  self.receiverListenerFD = -1;
  for (NSString *connectionId in self.receiverConnections.allKeys) [self closeReceiverConnection:connectionId];
}

- (void)sendPlaybackReceiverCommandToHost:(NSString *)host port:(NSInteger)port sealed:(NSDictionary *)sealed resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  if (port < 1 || port > 65535 || host.length == 0) { reject(@"receiver_target_invalid", @"The nearby playback receiver target is invalid.", nil); return; }
  struct addrinfo hints = {0}, *results = NULL; hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
  NSString *service = [NSString stringWithFormat:@"%ld", (long)port];
  if (getaddrinfo(host.UTF8String, service.UTF8String, &hints, &results) != 0) { reject(@"receiver_resolve_failed", @"The nearby playback receiver could not be resolved.", nil); return; }
  int descriptor = -1; for (struct addrinfo *entry = results; entry; entry = entry->ai_next) { descriptor = socket(entry->ai_family, entry->ai_socktype, entry->ai_protocol); if (descriptor >= 0 && connect(descriptor, entry->ai_addr, entry->ai_addrlen) == 0) break; if (descriptor >= 0) close(descriptor); descriptor = -1; } freeaddrinfo(results);
  if (descriptor < 0) { reject(@"receiver_connect_failed", @"The nearby playback receiver could not be reached.", nil); return; }
  struct timeval timeout = {.tv_sec = 10, .tv_usec = 0}; setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)); setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)); int noPipe = 1; setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, sizeof(noPipe));
  NSData *json = [NSJSONSerialization dataWithJSONObject:sealed options:0 error:nil]; NSMutableData *frame = [json mutableCopy]; uint8_t newline = '\n'; [frame appendBytes:&newline length:1];
  if (!json || !PorticoSendFrame(descriptor, frame)) { close(descriptor); reject(@"receiver_send_failed", @"The nearby playback command could not be sent.", nil); return; }
  NSMutableData *reply = [NSMutableData new]; uint8_t bytes[4096];
  while (reply.length <= PorticoReceiverMaximumFrameBytes) { ssize_t count = recv(descriptor, bytes, sizeof(bytes), 0); if (count <= 0) break; [reply appendBytes:bytes length:(NSUInteger)count]; if (memchr(bytes, '\n', (size_t)count)) break; }
  close(descriptor);
  const uint8_t *raw = reply.bytes; NSUInteger length = 0; while (length < reply.length && raw[length] != '\n') length++;
  NSDictionary *decoded = length ? [NSJSONSerialization JSONObjectWithData:[reply subdataWithRange:NSMakeRange(0, length)] options:0 error:nil] : nil;
  if (![decoded isKindOfClass:NSDictionary.class]) { reject(@"receiver_reply_invalid", @"The nearby playback receiver returned an invalid reply.", nil); return; }
  resolve(decoded);
}

- (void)netServiceDidPublish:(NSNetService *)sender { if (sender == self.advertisedSetup && self.advertisedSetupTXT.length > 0) [sender setTXTRecordData:self.advertisedSetupTXT]; else if (sender == self.advertisedReceiver && self.advertisedReceiverTXT.length > 0) [sender setTXTRecordData:self.advertisedReceiverTXT]; }
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didFindService:(NSNetService *)service moreComing:(BOOL)moreComing { NSString *identifier = [self identifierForService:service]; self.services[identifier] = service; service.delegate = self; [service resolveWithTimeout:5.0]; }
- (void)netServiceBrowser:(NSNetServiceBrowser *)browser didRemoveService:(NSNetService *)service moreComing:(BOOL)moreComing { [self.services removeObjectForKey:[self identifierForService:service]]; [self emit:@{@"action": @"removed", @"instanceName": service.name ?: @"", @"serviceType": service.type ?: @""}]; }
- (void)netServiceDidResolveAddress:(NSNetService *)sender { NSDictionary *raw = sender.TXTRecordData ? [NSNetService dictionaryFromTXTRecordData:sender.TXTRecordData] : @{}; NSMutableDictionary<NSString *, NSString *> *txt = [NSMutableDictionary new]; [raw enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSData *value, BOOL *stop) { NSString *decoded = [[NSString alloc] initWithData:value encoding:NSUTF8StringEncoding]; if (decoded) txt[key.lowercaseString] = decoded; }]; [self emit:@{@"action": @"found", @"instanceName": sender.name ?: @"", @"serviceType": sender.type ?: @"", @"hostName": sender.hostName ?: @"", @"addresses": PorticoNumericAddresses(sender), @"port": @(sender.port), @"txt": txt}]; }
- (void)netService:(NSNetService *)sender didUpdateTXTRecordData:(NSData *)data { [self netServiceDidResolveAddress:sender]; }
- (void)stopAllBrowsers { for (NSNetServiceBrowser *browser in self.browsers) [browser stop]; [self.browsers removeAllObjects]; for (NSNetService *service in self.services.allValues) { [self emit:@{@"action": @"removed", @"instanceName": service.name ?: @"", @"serviceType": service.type ?: @""}]; [service stop]; } [self.services removeAllObjects]; }
- (NSString *)normalizedServiceType:(NSString *)raw { NSString *type = raw.lowercaseString; if ([type hasSuffix:@".local."]) type = [type substringToIndex:type.length - 7]; else if ([type hasSuffix:@".local"]) type = [type substringToIndex:type.length - 6]; if (![type hasSuffix:@"."]) type = [type stringByAppendingString:@"."]; return type; }
- (NSString *)identifierForService:(NSNetService *)service { return [NSString stringWithFormat:@"%@:%@", service.type ?: @"", service.name ?: @""]; }
- (void)emit:(NSDictionary *)body { if (self.observing) [self sendEventWithName:PorticoNearbyEvent body:body]; }
@end
