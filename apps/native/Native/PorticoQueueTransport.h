#import <Foundation/Foundation.h>
#import <math.h>
#import <React/RCTBridgeModule.h>
#import "PorticoServerTrust.h"

// Queue HTTP requests carry a device proof. Never follow redirects, bypass TLS
// validation, or accumulate an unbounded response. There is no background media
// player here; Reading also uses this same transport for bounded binary reads.
//
// PERF-04: every request used to open its own NSURLSession, so each API call paid a new TCP
// connection and TLS handshake, and a 17th concurrent request was rejected outright. Now two
// shared, ephemeral, cookie-less, cache-less session (so connections and TLS sessions are
// reused), at most 12 requests in flight and up to 64 waiting, with control work first. The security bounds are
// unchanged and enforced per task: no redirects, at most 1 MB bodies (8 MB for API GETs), 15 s timeouts.
@interface PorticoQueueRequest : NSObject
@property(nonatomic,strong) NSURLSessionDataTask *task;
@property(nonatomic,strong) NSURLRequest *wire;
@property(nonatomic,strong) NSMutableData *data;
@property(nonatomic,strong) NSHTTPURLResponse *response;
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@property(nonatomic,copy) NSString *identifier;
@property(nonatomic,weak) id owner;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL started;
@property(nonatomic) BOOL critical;
@property(nonatomic) NSUInteger responseLimit;
@property(nonatomic) BOOL binaryResponse;
/** Set before -finish: when the failure was a refused certificate. */
@property(nonatomic,copy) NSString *failureCode;
- (void)finish:(NSString *)failure;
@end
static NSMutableDictionary<NSString *,PorticoQueueRequest *> *PorticoQueueRequests;
static NSMutableArray<PorticoQueueRequest *> *PorticoQueueWaiting;
static NSInteger PorticoQueueActive, PorticoQueueReads;
static const NSInteger PorticoQueueMaxActive=12;

@interface PorticoQueueTransport : NSObject<NSURLSessionDataDelegate,NSURLSessionTaskDelegate> @end
@implementation PorticoQueueTransport
+ (NSURLSession *)sessionFor:(BOOL)critical {
 static NSURLSession *reads,*writes;static dispatch_once_t once;
 dispatch_once(&once,^{
  // Separate socket pools keep ten slow reads from occupying the control connections.
  for(NSInteger lane=0;lane<2;lane++){
   NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
   configuration.timeoutIntervalForRequest=15;configuration.timeoutIntervalForResource=15;configuration.HTTPShouldSetCookies=NO;configuration.HTTPCookieStorage=nil;configuration.URLCredentialStorage=nil;configuration.URLCache=nil;configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;configuration.HTTPMaximumConnectionsPerHost=lane?2:10;
   NSOperationQueue *queue=[NSOperationQueue new];queue.maxConcurrentOperationCount=1;queue.name=lane?@"tv.getportico.control":@"tv.getportico.reads";
   NSURLSession *session=[NSURLSession sessionWithConfiguration:configuration delegate:[PorticoQueueTransport new] delegateQueue:queue];
   if(lane)writes=session;else reads=session;
  }
 });
 return critical?writes:reads;
}
/** Caller holds the class lock. */
+ (void)start:(PorticoQueueRequest *)request {
 request.started=YES;PorticoQueueActive++;if(!request.critical)PorticoQueueReads++;
 NSURLSessionDataTask *task=[[self sessionFor:request.critical] dataTaskWithRequest:request.wire];request.task=task;
 task.taskDescription=request.identifier;
 [task resume];
}
/** Caller holds the class lock. Two slots and eight waiting places are reserved for writes. */
+ (void)pump {
 while(PorticoQueueActive<PorticoQueueMaxActive&&PorticoQueueWaiting.count){
  NSUInteger index=[PorticoQueueWaiting indexOfObjectPassingTest:^BOOL(PorticoQueueRequest *r,NSUInteger i,BOOL *stop){return r.critical;}];
  if(index==NSNotFound){if(PorticoQueueReads>=10)break;index=0;}
  PorticoQueueRequest *next=PorticoQueueWaiting[index];[PorticoQueueWaiting removeObjectAtIndex:index];[self start:next];
 }
}
+ (void)submit:(PorticoQueueRequest *)request domain:(NSString *)domain busy:(NSString *)busy {
 @synchronized(PorticoQueueRequest.class){
  if(!PorticoQueueRequests)PorticoQueueRequests=[NSMutableDictionary dictionary];if(!PorticoQueueWaiting)PorticoQueueWaiting=[NSMutableArray array];
  request.critical=![@[@"GET",@"HEAD"] containsObject:request.wire.HTTPMethod];
  NSUInteger reads=0;for(PorticoQueueRequest *r in PorticoQueueRequests.allValues)if(!r.critical)reads++;
  if(PorticoQueueRequests[request.identifier]||PorticoQueueRequests.count>=76||(!request.critical&&reads>=66)){request.reject(domain,busy,nil);return;}
  PorticoQueueRequests[request.identifier]=request;[PorticoQueueWaiting addObject:request];[self pump];
  // Include queue residence in the operation's deadline. Cancellation releases admission once.
  NSTimeInterval timeout=request.wire.timeoutInterval;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,(int64_t)(timeout*NSEC_PER_SEC)),dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{@synchronized(request){if(!request.completed)request.failureCode=@"timeout";}[request finish:@"The request took too long."];});
 }
}
/** Caller holds the class lock. */
+ (void)release:(PorticoQueueRequest *)request {
 if(PorticoQueueRequests[request.identifier]==request)[PorticoQueueRequests removeObjectForKey:request.identifier];
 if(!request.started){[PorticoQueueWaiting removeObjectIdenticalTo:request];return;}
 PorticoQueueActive=MAX(0,PorticoQueueActive-1);if(!request.critical)PorticoQueueReads=MAX(0,PorticoQueueReads-1);
 [self pump];
}
+ (void)cancelOwnedBy:(id)owner {
 NSArray<PorticoQueueRequest *> *owned;
 @synchronized(PorticoQueueRequest.class){owned=[PorticoQueueRequests.allValues filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(PorticoQueueRequest *r,NSDictionary *b){return r.owner==owner||r.owner==nil;}]];}
 for(PorticoQueueRequest *request in owned)[request finish:@"The app reloaded."];
}
- (PorticoQueueRequest *)requestFor:(NSURLSessionTask *)task {@synchronized(PorticoQueueRequest.class){PorticoQueueRequest *request=PorticoQueueRequests[task.taskDescription];return request.task==task?request:nil;}}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
 completionHandler(nil);[[self requestFor:task] finish:@"Queue control redirects are not allowed."];
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
 PorticoQueueRequest *request=[self requestFor:task];
 // HEAD describes the complete resource, not bytes transferred in this response.
 BOOL head=[request.wire.HTTPMethod isEqualToString:@"HEAD"];
 if(!request||![response isKindOfClass:NSHTTPURLResponse.class]||(!head&&response.expectedContentLength>(long long)(request.responseLimit?:1048576))){completionHandler(NSURLSessionResponseCancel);[request finish:@"Queue response exceeded its limit."];return;}
 @synchronized(request){if(request.completed){completionHandler(NSURLSessionResponseCancel);return;}request.response=(NSHTTPURLResponse *)response;completionHandler(NSURLSessionResponseAllow);}
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
 PorticoQueueRequest *request=[self requestFor:task];if(!request)return;
 BOOL over=NO;@synchronized(request){if(request.completed)return;NSUInteger limit=request.responseLimit?:1048576;if(request.data.length>limit||data.length>limit-request.data.length)over=YES;else [request.data appendData:data];}
 if(over)[request finish:@"Queue response exceeded its limit."];
}
- (void)URLSession:(NSURLSession *)session didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completionHandler {
 [PorticoServerTrust handleChallenge:challenge completion:completionHandler];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
 PorticoQueueRequest *request=[self requestFor:task];
 if([PorticoServerTrust isRefusal:error]){request.failureCode=@"certificate_untrusted";[request finish:@"The server's certificate is not trusted yet."];return;}
 // What the failure means to the person, as Android reports it: no answer in time, or nothing reached
 // the server. Anything else keeps the transport's own code (a write's outcome stays unknown).
 if([error.domain isEqualToString:NSURLErrorDomain])switch(error.code){
  case NSURLErrorTimedOut:request.failureCode=@"timeout";[request finish:@"The request took too long."];return;
  case NSURLErrorCannotFindHost:case NSURLErrorCannotConnectToHost:case NSURLErrorDNSLookupFailed:case NSURLErrorNotConnectedToInternet:
   request.failureCode=@"network";[request finish:@"The server could not be reached."];return;
  default:break;
 }
 [request finish:error?@"The queue request could not be confirmed.":nil];
}
@end

@implementation PorticoQueueRequest
- (void)finish:(NSString *)failure {
 @synchronized(self) {if(self.completed)return;self.completed=YES;
 if(self.task.state==NSURLSessionTaskStateRunning||self.task.state==NSURLSessionTaskStateSuspended)[self.task cancel];
 @synchronized(PorticoQueueRequest.class){[PorticoQueueTransport release:self];}
 if(failure){self.reject(self.failureCode?:@"queue_transport",failure,nil);}else{
  NSString *body=self.binaryResponse?[self.data base64EncodedStringWithOptions:0]:[[NSString alloc] initWithData:self.data encoding:NSUTF8StringEncoding];
  if(!body||!self.response){self.reject(@"queue_transport",@"Invalid queue response.",nil);}else{
   NSMutableDictionary *headers=[NSMutableDictionary dictionary];for(id key in self.response.allHeaderFields)headers[[key description]]=[self.response.allHeaderFields[key] description];
   self.resolve(@{@"status":@(self.response.statusCode),@"headers":headers,self.binaryResponse?@"bodyBase64":@"body":body});
  }
 }
 self.resolve=nil;self.reject=nil;self.task=nil;self.wire=nil;self.data=nil;self.response=nil;
 }
}
@end

/** Reading byte reads use the existing queue/trust/session/cancel machinery. This builder
 * grants no authority: the normal identity/certificate gate and server session still apply. */
static PorticoQueueRequest *PorticoReadingBytesRequest(id identifier,id rawURL,id method,id headers,id byteLimit,id owner,RCTPromiseResolveBlock resolve,RCTPromiseRejectBlock reject) {
 BOOL valid=[identifier isKindOfClass:NSString.class]&&[identifier length]>0&&[identifier length]<=128&&[rawURL isKindOfClass:NSString.class]&&[rawURL length]>0&&[rawURL length]<=8192&&[method isKindOfClass:NSString.class]&&[@[@"GET",@"HEAD"] containsObject:method]&&[headers isKindOfClass:NSDictionary.class]&&[byteLimit isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)byteLimit)!=CFBooleanGetTypeID();
 double limit=valid?[byteLimit doubleValue]:0;
 valid=valid&&isfinite(limit)&&floor(limit)==limit&&limit>=1&&limit<=33554432;
 NSURLComponents *parts=valid?[NSURLComponents componentsWithString:rawURL]:nil;
 NSString *path=parts.percentEncodedPath;
 BOOL source=path&&[path rangeOfString:@"^/v1/reading/sessions/[A-Za-z0-9_-]{1,128}/source$" options:NSRegularExpressionSearch].location!=NSNotFound;
 BOOL asset=path&&[path rangeOfString:@"^/v1/reading/sessions/[A-Za-z0-9_-]{1,128}/(?:assets|pages/(?:0|[1-9][0-9]*))$" options:NSRegularExpressionSearch].location!=NSNotFound;
 valid=valid&&parts.URL&&parts.host.length&&[@[@"https",@"http"] containsObject:parts.scheme]&&!parts.user&&!parts.password&&!parts.fragment&&(source||([method isEqualToString:@"GET"]&&asset));
 if(valid)for(id name in headers)if(![name isKindOfClass:NSString.class]||![headers[name] isKindOfClass:NSString.class]){valid=NO;break;}
 if(!valid){reject(@"queue_transport",@"network_bytes_request_invalid",nil);return nil;}
 PorticoQueueRequest *request=[PorticoQueueRequest new];request.identifier=identifier;request.resolve=resolve;request.reject=reject;request.data=[NSMutableData data];request.owner=owner;request.binaryResponse=YES;request.responseLimit=(NSUInteger)limit;
 NSMutableURLRequest *wire=[NSMutableURLRequest requestWithURL:parts.URL cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:15];wire.HTTPMethod=method;
 for(NSString *name in headers)[wire setValue:headers[name] forHTTPHeaderField:name];
 request.wire=wire;return request;
}

