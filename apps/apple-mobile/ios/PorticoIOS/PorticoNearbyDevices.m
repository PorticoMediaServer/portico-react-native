#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <arpa/inet.h>
#import <netdb.h>
#import <sys/socket.h>
#import <unistd.h>

static NSString *const PorticoNearbyEvent = @"PorticoNearbyDeviceChanged";
static NSString *const PorticoSetupServiceType = @"_portico-setup._tcp.";
static NSString *const PorticoServerServiceType = @"_portico._tcp.";
static NSString *const PorticoReceiverServiceType = @"_portico-receiver._tcp.";
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
@end

@implementation PorticoNearbyDevices

RCT_EXPORT_MODULE(PorticoNearbyDevices)
+ (BOOL)requiresMainQueueSetup { return YES; }

RCT_EXPORT_METHOD(logDiagnostic:(NSString *)stage details:(NSDictionary *)details) {
  NSLog(@"[PorticoDiagnostic] %@ %@", stage ?: @"unknown", details ?: @{});
}

- (instancetype)init {
  if ((self = [super init])) {
    _browsers = [NSMutableArray new];
    _services = [NSMutableDictionary new];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents { return @[PorticoNearbyEvent]; }
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }

RCT_REMAP_METHOD(startBrowsing,
                 serviceTypes:(NSArray<NSString *> *)serviceTypes
                 browserResolver:(RCTPromiseResolveBlock)resolve
                 browserRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopAllBrowsers];
    for (NSString *rawType in serviceTypes) {
      NSString *type = [self normalizedServiceType:rawType];
      if (![type isEqualToString:PorticoSetupServiceType] && ![type isEqualToString:PorticoServerServiceType] && ![type isEqualToString:PorticoReceiverServiceType]) continue;
      NSNetServiceBrowser *browser = [NSNetServiceBrowser new];
      browser.delegate = self;
      [self.browsers addObject:browser];
      [browser searchForServicesOfType:type inDomain:@"local."];
    }
    resolve(nil);
  });
}

RCT_REMAP_METHOD(stopBrowsing,
                 stopBrowserResolver:(RCTPromiseResolveBlock)resolve
                 stopBrowserRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopAllBrowsers];
    resolve(nil);
  });
}

RCT_REMAP_METHOD(startAdvertisingSetup,
                 instanceName:(NSString *)instanceName
                 setupTXT:(NSDictionary<NSString *, NSString *> *)txt
                 advertiseResolver:(RCTPromiseResolveBlock)resolve
                 advertiseRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.advertisedSetup stop];
    self.advertisedSetup = [[NSNetService alloc] initWithDomain:@"local."
                                                           type:PorticoSetupServiceType
                                                           name:instanceName
                                                           port:9];
    NSMutableDictionary<NSString *, NSData *> *encoded = [NSMutableDictionary new];
    [txt enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) {
      if ([key isKindOfClass:NSString.class] && [value isKindOfClass:NSString.class]) {
        encoded[key] = [value dataUsingEncoding:NSUTF8StringEncoding];
      }
    }];
    self.advertisedSetupTXT = [NSNetService dataFromTXTRecordDictionary:encoded];
    self.advertisedSetup.delegate = self;
    [self.advertisedSetup setTXTRecordData:self.advertisedSetupTXT];
    [self.advertisedSetup publishWithOptions:NSNetServiceNoAutoRename];
    resolve(nil);
  });
}

RCT_REMAP_METHOD(stopAdvertisingSetup,
                 stopAdvertiseResolver:(RCTPromiseResolveBlock)resolve
                 stopAdvertiseRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.advertisedSetup stop];
    self.advertisedSetup = nil;
    self.advertisedSetupTXT = nil;
    resolve(nil);
  });
}

RCT_REMAP_METHOD(startAdvertisingReceiver,
                 receiverInstanceName:(NSString *)instanceName
                 receiverPort:(NSInteger)port
                 receiverTXT:(NSDictionary<NSString *, NSString *> *)txt
                 receiverAdvertiseResolver:(RCTPromiseResolveBlock)resolve
                 receiverAdvertiseRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (port < 1 || port > 65535) { reject(@"invalid_receiver_port", @"The playback receiver port is invalid.", nil); return; }
    [self.advertisedReceiver stop];
    self.advertisedReceiver = [[NSNetService alloc] initWithDomain:@"local." type:PorticoReceiverServiceType name:instanceName port:(int)port];
    NSMutableDictionary<NSString *, NSData *> *encoded = [NSMutableDictionary new];
    [txt enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) {
      if ([key isKindOfClass:NSString.class] && [value isKindOfClass:NSString.class]) encoded[key] = [value dataUsingEncoding:NSUTF8StringEncoding];
    }];
    self.advertisedReceiverTXT = [NSNetService dataFromTXTRecordDictionary:encoded];
    self.advertisedReceiver.delegate = self;
    [self.advertisedReceiver setTXTRecordData:self.advertisedReceiverTXT];
    [self.advertisedReceiver publishWithOptions:NSNetServiceNoAutoRename];
    resolve(nil);
  });
}

RCT_REMAP_METHOD(stopAdvertisingReceiver,
                 stopReceiverResolver:(RCTPromiseResolveBlock)resolve
                 stopReceiverRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.advertisedReceiver stop];
    self.advertisedReceiver = nil;
    self.advertisedReceiverTXT = nil;
    resolve(nil);
  });
}

RCT_REMAP_METHOD(sendPlaybackReceiverCommand,
                 receiverHost:(NSString *)host
                 receiverCommandPort:(NSInteger)port
                 receiverSealedCommand:(NSDictionary *)sealed
                 receiverCommandResolver:(RCTPromiseResolveBlock)resolve
                 receiverCommandRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    if (port < 1 || port > 65535 || host.length == 0) { reject(@"receiver_target_invalid", @"The nearby playback receiver target is invalid.", nil); return; }
    struct addrinfo hints = {0}, *results = NULL; hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
    NSString *service = [NSString stringWithFormat:@"%ld", (long)port];
    if (getaddrinfo(host.UTF8String, service.UTF8String, &hints, &results) != 0) { reject(@"receiver_resolve_failed", @"The nearby playback receiver could not be resolved.", nil); return; }
    int descriptor = -1;
    for (struct addrinfo *entry = results; entry; entry = entry->ai_next) {
      descriptor = socket(entry->ai_family, entry->ai_socktype, entry->ai_protocol);
      if (descriptor >= 0 && connect(descriptor, entry->ai_addr, entry->ai_addrlen) == 0) break;
      if (descriptor >= 0) close(descriptor); descriptor = -1;
    }
    freeaddrinfo(results);
    if (descriptor < 0) { reject(@"receiver_connect_failed", @"The nearby playback receiver could not be reached.", nil); return; }
    struct timeval timeout = {.tv_sec = 10, .tv_usec = 0};
    setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)); setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)); int noPipe = 1; setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, sizeof(noPipe));
    NSData *json = [NSJSONSerialization dataWithJSONObject:sealed options:0 error:nil]; NSMutableData *frame = [json mutableCopy]; uint8_t newline = '\n'; [frame appendBytes:&newline length:1];
    if (!json || !PorticoSendFrame(descriptor, frame)) { close(descriptor); reject(@"receiver_send_failed", @"The nearby playback command could not be sent.", nil); return; }
    NSMutableData *reply = [NSMutableData new]; uint8_t bytes[4096];
    while (reply.length <= PorticoReceiverMaximumFrameBytes) { ssize_t count = recv(descriptor, bytes, sizeof(bytes), 0); if (count <= 0) break; [reply appendBytes:bytes length:(NSUInteger)count]; if (memchr(bytes, '\n', (size_t)count)) break; }
    close(descriptor);
    const uint8_t *raw = reply.bytes; NSUInteger length = 0; while (length < reply.length && raw[length] != '\n') length++;
    NSDictionary *decoded = length ? [NSJSONSerialization JSONObjectWithData:[reply subdataWithRange:NSMakeRange(0, length)] options:0 error:nil] : nil;
    if (![decoded isKindOfClass:NSDictionary.class]) { reject(@"receiver_reply_invalid", @"The nearby playback receiver returned an invalid reply.", nil); return; }
    resolve(decoded);
  });
}

- (void)netServiceDidPublish:(NSNetService *)sender {
  if (sender == self.advertisedSetup && self.advertisedSetupTXT.length > 0) {
    [sender setTXTRecordData:self.advertisedSetupTXT];
  } else if (sender == self.advertisedReceiver && self.advertisedReceiverTXT.length > 0) {
    [sender setTXTRecordData:self.advertisedReceiverTXT];
  }
}

- (void)netServiceBrowser:(NSNetServiceBrowser *)browser
           didFindService:(NSNetService *)service
               moreComing:(BOOL)moreComing {
  NSString *identifier = [self identifierForService:service];
  self.services[identifier] = service;
  service.delegate = self;
  [service resolveWithTimeout:5.0];
}

- (void)netServiceBrowser:(NSNetServiceBrowser *)browser
         didRemoveService:(NSNetService *)service
               moreComing:(BOOL)moreComing {
  NSString *identifier = [self identifierForService:service];
  [self.services removeObjectForKey:identifier];
  [self emit:@{ @"action": @"removed", @"instanceName": service.name ?: @"", @"serviceType": service.type ?: @"" }];
}

- (void)netServiceDidResolveAddress:(NSNetService *)sender {
  NSDictionary *raw = sender.TXTRecordData ? [NSNetService dictionaryFromTXTRecordData:sender.TXTRecordData] : @{};
  NSMutableDictionary<NSString *, NSString *> *txt = [NSMutableDictionary new];
  [raw enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSData *value, BOOL *stop) {
    NSString *decoded = [[NSString alloc] initWithData:value encoding:NSUTF8StringEncoding];
    if (decoded) txt[key.lowercaseString] = decoded;
  }];
  [self emit:@{
    @"action": @"found",
    @"instanceName": sender.name ?: @"",
    @"serviceType": sender.type ?: @"",
    @"hostName": sender.hostName ?: @"",
    @"addresses": PorticoNumericAddresses(sender),
    @"port": @(sender.port),
    @"txt": txt,
  }];
}

- (void)netService:(NSNetService *)sender didUpdateTXTRecordData:(NSData *)data {
  [self netServiceDidResolveAddress:sender];
}

- (void)stopAllBrowsers {
  for (NSNetServiceBrowser *browser in self.browsers) [browser stop];
  [self.browsers removeAllObjects];
  for (NSNetService *service in self.services.allValues) {
    [self emit:@{ @"action": @"removed", @"instanceName": service.name ?: @"", @"serviceType": service.type ?: @"" }];
    [service stop];
  }
  [self.services removeAllObjects];
}

- (NSString *)normalizedServiceType:(NSString *)raw {
  NSString *type = raw.lowercaseString;
  if ([type hasSuffix:@".local."]) type = [type substringToIndex:type.length - 7];
  else if ([type hasSuffix:@".local"]) type = [type substringToIndex:type.length - 6];
  if (![type hasSuffix:@"."]) type = [type stringByAppendingString:@"."];
  return type;
}

- (NSString *)identifierForService:(NSNetService *)service {
  return [NSString stringWithFormat:@"%@:%@", service.type ?: @"", service.name ?: @""];
}

- (void)emit:(NSDictionary *)body {
  if (self.observing) [self sendEventWithName:PorticoNearbyEvent body:body];
}

@end
