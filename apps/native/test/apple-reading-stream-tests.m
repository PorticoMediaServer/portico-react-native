#import "../Native/PorticoQueueTransport.h"
#import <sys/socket.h>
#import <netinet/in.h>
#import <unistd.h>

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wincomplete-implementation"
@implementation PorticoServerTrust
+ (void)handleChallenge:(NSURLAuthenticationChallenge *)challenge completion:(void (^)(NSURLSessionAuthChallengeDisposition,NSURLCredential *))completion {completion(NSURLSessionAuthChallengePerformDefaultHandling,nil);}
+ (BOOL)isRefusal:(NSError *)error {return [error.domain isEqual:@"test_refused_certificate"];}
@end
#pragma clang diagnostic pop

@interface ReadingStreamTask : NSURLSessionDataTask
@property(nonatomic,copy) NSString *testID;
@property(nonatomic) NSUInteger resumes,suspends,cancels;
@property(nonatomic) NSURLSessionTaskState testState;
@end
@implementation ReadingStreamTask
- (NSString *)taskDescription{return _testID;}
- (NSURLSessionTaskState)state{return _testState;}
- (void)suspend{_suspends++;_testState=NSURLSessionTaskStateSuspended;}
- (void)resume{_resumes++;_testState=NSURLSessionTaskStateRunning;}
- (void)cancel{_cancels++;_testState=NSURLSessionTaskStateCanceling;}
@end

static NSUInteger checks,opened,openRejected;
static NSDictionary *opening;
static NSString *openError;
static NSObject *owner;
static PorticoQueueTransport *transport;
static void check(BOOL value,const char *name){checks++;if(!value){fprintf(stderr,"FAIL %s\n",name);exit(1);}}
static PorticoQueueRequest *make(void){
 opened=openRejected=0;opening=nil;openError=nil;
 return PorticoReadingStreamRequest(NSUUID.UUID.UUIDString,@"https://server.example/v1/reading/sessions/s-1/source",@{@"If-Match":@"\"revision\"",@"Authorization":@"synthetic-test-token"},owner,
  ^(id value){opened++;opening=value;},^(NSString *code,NSString *message,NSError *error){openRejected++;openError=code;});
}
static ReadingStreamTask *install(PorticoQueueRequest *request){
 ReadingStreamTask *task=[ReadingStreamTask new];task.testID=request.identifier;task.testState=NSURLSessionTaskStateRunning;request.task=task;request.started=YES;
 if(!PorticoQueueRequests)PorticoQueueRequests=[NSMutableDictionary new];
 PorticoQueueRequests[request.identifier]=request;PorticoQueueActive++;PorticoQueueReads++;return task;
}
static void headers(ReadingStreamTask *task,NSInteger status){
 __block NSURLSessionResponseDisposition disposition=-1;
 NSHTTPURLResponse *response=[[NSHTTPURLResponse alloc]initWithURL:[NSURL URLWithString:@"https://server.example/v1/reading/sessions/s-1/source"] statusCode:status HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Length":@"2147483648",@"Content-Type":@"application/pdf",@"ETag":@"\"revision\""}];
 [transport URLSession:nil dataTask:task didReceiveResponse:response completionHandler:^(NSURLSessionResponseDisposition value){disposition=value;}];
 check(disposition==NSURLSessionResponseAllow,"stream headers admit large resources without whole-body buffering");
}
static void pull(PorticoQueueRequest *request,NSMutableArray *replies,NSMutableArray *errors){
 PorticoReadingStreamRead(request.identifier,owner,^(id value){[replies addObject:value];},^(NSString *code,NSString *message,NSError *error){[errors addObject:code];});
}
static void cancel(PorticoQueueRequest *request){request.failureCode=@"cancelled";[request finish:@"network_stream_cancelled"];}

static BOOL waitFor(BOOL (^ready)(void)) {
 NSDate *until=[NSDate dateWithTimeIntervalSinceNow:8];
 while(!ready()&&until.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];
 return ready();
}
/** Real NSURLSession data/delegate scheduling and suspension, without a device,
 * auth state or TLS claim. The loopback peer generates bytes, never stores a PDF. */
static void actualPullStream(void) {
 int listener=socket(AF_INET,SOCK_STREAM,0);check(listener>=0,"loopback socket");
 struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
 check(bind(listener,(struct sockaddr *)&address,sizeof(address))==0&&listen(listener,1)==0,"private ephemeral loopback listener");
 socklen_t size=sizeof(address);check(getsockname(listener,(struct sockaddr *)&address,&size)==0,"actual loopback port");
 dispatch_group_t served=dispatch_group_create();
 dispatch_group_async(served,dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{
  int peer=accept(listener,NULL,NULL);if(peer<0)return;
  int yes=1;setsockopt(peer,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof(yes));
  struct timeval timeout={5,0};setsockopt(peer,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));setsockopt(peer,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
  char request[8192]={0};ssize_t count=0;
  while(count<(ssize_t)sizeof(request)-1&&!strstr(request,"\r\n\r\n")){ssize_t next=recv(peer,request+count,sizeof(request)-1-count,0);if(next<=0)break;count+=next;}
  const char *header="HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 2097152\r\nConnection: close\r\n\r\n";
  if(strstr(request,"GET /v1/reading/sessions/live/source HTTP/1.1")&&!strstr(request,"Range:")){
   send(peer,header,strlen(header),0);unsigned char bytes[16384];for(NSUInteger i=0;i<sizeof(bytes);i++)bytes[i]=(uint8_t)i;
   NSUInteger sent=0;
   while(sent<2097152){ssize_t next=send(peer,bytes+sent%sizeof(bytes),MIN(sizeof(bytes)-sent%sizeof(bytes),2097152-sent),0);if(next<=0)break;sent+=(NSUInteger)next;}
  }
  shutdown(peer,SHUT_RDWR);close(peer);
 });
 NSMutableDictionary *state=[NSMutableDictionary new];NSObject *realOwner=[NSObject new];
 NSString *url=[NSString stringWithFormat:@"http://127.0.0.1:%u/v1/reading/sessions/live/source",ntohs(address.sin_port)];
 PorticoQueueRequest *request=PorticoReadingStreamRequest(NSUUID.UUID.UUIDString,url,@{},realOwner,^(id value){@synchronized(state){state[@"headers"]=value;}},^(NSString *c,NSString *m,NSError *e){@synchronized(state){state[@"error"]=c;}});
 [PorticoQueueTransport submit:request domain:@"queue_transport" busy:@"network_stream_busy"];
 BOOL opened=waitFor(^BOOL{@synchronized(state){return state[@"headers"]||state[@"error"];}});
 check(opened&&!state[@"error"]&&[state[@"headers"][@"status"]isEqual:@200],"actual task resolves headers before read");
 [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.1]];
 @synchronized(request){check(!request.completed&&request.streamPaused&&request.data.length<=PorticoStreamChunkLimit,"real task stays bounded while no pull is pending");}
 NSUInteger received=0,pulls=0;BOOL done=NO,valid=YES;
 while(!done&&pulls++<512){
  @synchronized(state){[state removeObjectForKey:@"read"];}
  PorticoReadingStreamRead(request.identifier,realOwner,^(id value){@synchronized(state){state[@"read"]=value;}},^(NSString *c,NSString *m,NSError *e){@synchronized(state){state[@"error"]=c;}});
  if(!waitFor(^BOOL{@synchronized(state){return state[@"read"]||state[@"error"];}})){valid=NO;break;}
  NSDictionary *reply;@synchronized(state){if(state[@"error"]){valid=NO;break;}reply=state[@"read"];}
  NSData *bytes=[[NSData alloc]initWithBase64EncodedString:reply[@"bodyBase64"] options:0];done=[reply[@"done"]isEqual:@YES];
  if(!bytes||(done?bytes.length!=0:bytes.length==0||bytes.length>PorticoStreamPullLimit)){valid=NO;break;}
  const uint8_t *raw=bytes.bytes;for(NSUInteger i=0;i<bytes.length;i++)if(raw[i]!=(uint8_t)(received+i)){valid=NO;break;}
  received+=bytes.length;
  @synchronized(request){if(request.data.length>PorticoStreamChunkLimit){valid=NO;break;}}
 }
 if(!done)cancel(request);
 close(listener);BOOL serverClosed=dispatch_group_wait(served,dispatch_time(DISPATCH_TIME_NOW,6*NSEC_PER_SEC))==0;
 check(valid&&done&&received==2097152&&pulls>42,"real two-MiB source arrives as exact demand-driven <=48KiB pulls and genuine EOF");
 check(serverClosed&&!PorticoQueueRequests[request.identifier]&&PorticoQueueActive==0&&PorticoQueueReads==0,"real peer, request and admission close");
}

int main(void){@autoreleasepool{
 transport=[PorticoQueueTransport new];owner=[NSObject new];
 for(NSString *url in @[@"https://server.example/v1/reading/sessions/s/source?x=1",@"https://server.example/v1/reading/sessions/s/assets",@"https://server.example/v1/reading/sessions/s/pages/0",@"https://server.example/v1/reading/sessions/s/%73ource",@"https://server.example/v1/system",@"file:///v1/reading/sessions/s/source",@"https://user:pass@server.example/v1/reading/sessions/s/source",@"https://server.example/v1/reading/sessions/s/source#f"]){
  __block NSUInteger failures=0;PorticoQueueRequest *bad=PorticoReadingStreamRequest(@"id",url,@{},owner,^(id value){},^(NSString *c,NSString *m,NSError *e){failures++;});check(!bad&&failures==1,"source-only canonical URL rejected before any task");
 }
 for(NSString *name in @[@"Range",@"range",@"rAnGe"]){
  __block NSUInteger failures=0;check(!PorticoReadingStreamRequest(@"id",@"https://server.example/v1/reading/sessions/s/source",@{name:@"bytes=0-4"},owner,^(id value){},^(NSString *c,NSString *m,NSError *e){failures++;})&&failures==1,"Range never enters sequential stream");
 }
 PorticoQueueRequest *request=make();ReadingStreamTask *task=install(request);headers(task,200);
 check(opened==1&&!openRejected&&[opening[@"status"]isEqual:@200]&&[opening[@"headers"] count]==3&&!opening[@"bodyBase64"],"open resolves actual headers only");
 check(request.wire.timeoutInterval==15&&[request.wire.HTTPMethod isEqual:@"GET"]&&!request.wire.HTTPBody&&[[request.wire valueForHTTPHeaderField:@"If-Match"]isEqual:@"\"revision\""],"same deadline, captured precondition and GET request");
 check(task.suspends==1&&task.resumes==0&&request.data.length==0,"headers suspend upstream before consumer demand");
 NSMutableArray *replies=[NSMutableArray new],*errors=[NSMutableArray new];
 pull(request,replies,errors);check(!replies.count&&!errors.count&&task.resumes==1,"one pull resumes the existing task");
 pull(request,replies,errors);check(errors.count==1&&[errors.lastObject isEqual:@"queue_transport"]&&task.resumes==1,"second pending pull rejects without replacing first");[errors removeAllObjects];
 NSMutableData *source=[NSMutableData dataWithLength:100000];for(NSUInteger i=0;i<source.length;i++)((uint8_t *)source.mutableBytes)[i]=(uint8_t)i;
 [transport URLSession:nil dataTask:task didReceiveData:source];
 check(replies.count==1&&task.suspends==2&&request.data.length==100000-49152,"one incoming chunk suspends and delivers at most 48KiB");
 NSMutableData *received=[NSMutableData new];
 while(request.data.length){NSDictionary *last=replies.lastObject;check([last[@"done"]isEqual:@NO],"buffered bytes never claim EOF");[received appendData:[[NSData alloc]initWithBase64EncodedString:last[@"bodyBase64"] options:0]];pull(request,replies,errors);}
 [received appendData:[[NSData alloc]initWithBase64EncodedString:replies.lastObject[@"bodyBase64"] options:0]];
 check([received isEqual:source]&&replies.count==3&&task.resumes==1,"ordered raw bytes survive slicing without premature upstream resume");
 pull(request,replies,errors);check(replies.count==3&&task.resumes==2,"drained body still awaits genuine upstream EOF");
 [transport URLSession:nil task:task didCompleteWithError:nil];
 check([replies.lastObject isEqual:@{@"done":@YES,@"bodyBase64":@""}]&&!errors.count&&request.completed&&!PorticoQueueRequests[request.identifier],"only actual EOF emits done and closes handle");
 pull(request,replies,errors);check([errors.lastObject isEqual:@"cancelled"],"closed handle never fabricates another EOF");

 request=make();task=install(request);headers(task,403);[replies removeAllObjects];[errors removeAllObjects];
 [transport URLSession:nil dataTask:task didReceiveData:[@"denied" dataUsingEncoding:NSUTF8StringEncoding]];
 check(opened==1&&[opening[@"status"]isEqual:@403]&&!replies.count,"HTTP error headers/body are not replaced with a transport success");
 pull(request,replies,errors);check([replies.lastObject[@"bodyBase64"]isEqual:@"ZGVuaWVk"],"HTTP error body remains original bytes");cancel(request);pull(request,replies,errors);check([errors.lastObject isEqual:@"cancelled"],"cancel after headers reaches the next pull");

 for(NSString *domain in @[@"test_refused_certificate",NSURLErrorDomain,@"synthetic_other_failure"]){
  request=make();task=install(request);headers(task,200);[replies removeAllObjects];[errors removeAllObjects];
  NSError *error=[NSError errorWithDomain:domain code:[domain isEqual:NSURLErrorDomain]?NSURLErrorTimedOut:1 userInfo:nil];
  [transport URLSession:nil task:task didCompleteWithError:error];
  check(request.completed&&request.streamTerminalFailure&&!request.data&&!request.wire&&!request.task,"post-header failure retains only bounded terminal metadata");
  pull(request,replies,errors);NSString *expected=[domain isEqual:@"test_refused_certificate"]?@"certificate_untrusted":[domain isEqual:NSURLErrorDomain]?@"timeout":@"queue_transport";
  check(!replies.count&&[errors.lastObject isEqual:expected]&&!PorticoQueueRequests[request.identifier],"next pull sees original failure code, never EOF or retry");
 }
 request=make();task=install(request);headers(task,200);[replies removeAllObjects];[errors removeAllObjects];pull(request,replies,errors);cancel(request);
 check(!replies.count&&[errors.lastObject isEqual:@"cancelled"]&&!PorticoQueueRequests[request.identifier],"pending read is rejected exactly on cancellation");
 [transport URLSession:nil task:task didCompleteWithError:nil];check(!replies.count&&errors.count==1,"late completion after cancellation cannot become EOF");

 request=make();task=install(request);cancel(request);check(openRejected==1&&[openError isEqual:@"cancelled"]&&!opened,"pre-header cancellation rejects open");
 request=make();task=install(request);headers(task,200);[replies removeAllObjects];[errors removeAllObjects];
 PorticoReadingStreamRead(request.identifier,[NSObject new],^(id value){[replies addObject:value];},^(NSString *c,NSString *m,NSError *e){[errors addObject:c];});
 check([errors.lastObject isEqual:@"cancelled"]&&!request.completed&&!task.resumes,"another runtime owner cannot read or resume this request");
 [PorticoQueueTransport cancelOwnedBy:owner];check(request.completed&&!PorticoQueueRequests[request.identifier],"owner invalidation removes even an unopened read handle");

 for(NSUInteger size=PorticoStreamChunkLimit;size<=PorticoStreamChunkLimit+1;size++){
  request=make();task=install(request);headers(task,200);[replies removeAllObjects];[errors removeAllObjects];
  [transport URLSession:nil dataTask:task didReceiveData:[NSMutableData dataWithLength:size]];
  if(size==PorticoStreamChunkLimit){check(!request.completed&&request.data.length==PorticoStreamChunkLimit,"one upstream window is bounded at one MiB");[transport URLSession:nil dataTask:task didReceiveData:[NSData dataWithBytes:"x" length:1]];}
  check(request.completed&&!request.data&&task.cancels==1,"oversized or undrained incoming window fails closed");pull(request,replies,errors);check([errors.lastObject isEqual:@"queue_transport"]&&!replies.count,"overflow is an error rather than truncated EOF");
 }
 request=make();task=install(request);headers(task,200);[replies removeAllObjects];[errors removeAllObjects];
 __block BOOL followed=YES;[transport URLSession:nil task:task willPerformHTTPRedirection:nil newRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://elsewhere.example"]] completionHandler:^(NSURLRequest *next){followed=next!=nil;}];
 pull(request,replies,errors);check(!followed&&!replies.count&&[errors.lastObject isEqual:@"queue_transport"],"same transport refuses redirects after headers");
 check(PorticoQueueActive==0&&PorticoQueueReads==0&&!PorticoQueueRequests.count,"all admission slots/handles released exactly once");
 actualPullStream();
 printf("Apple Reading pull stream: %lu checks passed\n",(unsigned long)checks);return 0;
}}
