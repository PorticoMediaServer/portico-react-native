#import <React/RCTBridgeModule.h>
#import <stdatomic.h>
#import <React/RCTInvalidating.h>
#import <React/RCTUtils.h>
#import <TargetConditionals.h>
#import <UIKit/UIKit.h>
#if !TARGET_OS_TV
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#endif

@interface PorticoSubtitlePickRequest : NSObject
@property(nonatomic,copy) NSString *identifier;
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@property(nonatomic,strong) NSProgress *progress;
#if !TARGET_OS_TV
@property(nonatomic,strong) UIDocumentPickerViewController *picker;
@property(nonatomic,assign) BOOL reading;
#endif
@end
@implementation PorticoSubtitlePickRequest @end

#if TARGET_OS_TV
@interface PorticoSubtitleFiles : NSObject<RCTBridgeModule,RCTInvalidating> @end
#else
@interface PorticoSubtitleFiles : NSObject<RCTBridgeModule,RCTInvalidating,UIDocumentPickerDelegate> @end
#endif
@implementation PorticoSubtitleFiles {
 PorticoSubtitlePickRequest *_request;
 BOOL _invalidated;
}
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup{return YES;}
- (dispatch_queue_t)methodQueue{return dispatch_get_main_queue();}
- (void)finish:(PorticoSubtitlePickRequest *)request result:(NSDictionary *)result code:(NSString *)code {
 if(!request||_request!=request)return;
 _request=nil;[request.progress cancel];
#if !TARGET_OS_TV
 request.picker.delegate=nil;
 if(request.picker.presentingViewController)[request.picker dismissViewControllerAnimated:NO completion:nil];
 request.picker=nil;
#endif
 RCTPromiseResolveBlock resolve=request.resolve;RCTPromiseRejectBlock reject=request.reject;
 request.resolve=nil;request.reject=nil;
 if(result){if(resolve)resolve(result);}else if(reject)reject(code,code,nil);
}
- (void)invalidate {
 if(!NSThread.isMainThread){dispatch_async(dispatch_get_main_queue(),^{[self invalidate];});return;}
 _invalidated=YES;[self finish:_request result:nil code:@"cancelled"];
}
RCT_REMAP_METHOD(cancel,cancel:(NSString *)requestId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 BOOL current=[requestId isKindOfClass:NSString.class]&&[_request.identifier isEqualToString:requestId];
 if(current)[self finish:_request result:nil code:@"cancelled"];
 resolve(@(current));
}
RCT_REMAP_METHOD(pick,pick:(NSString *)requestId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 if(_invalidated){reject(@"bridge_closed",@"bridge_closed",nil);return;}
 if(![requestId isKindOfClass:NSString.class]||!requestId.length||requestId.length>128||[requestId rangeOfString:@"^[A-Za-z0-9_-]+$" options:NSRegularExpressionSearch].location==NSNotFound){reject(@"subtitle_request_invalid",@"subtitle_request_invalid",nil);return;}
#if TARGET_OS_TV
 reject(@"subtitle_picker_unavailable",@"subtitle_picker_unavailable",nil);
#else
 if(_request){reject(@"subtitle_picker_busy",@"subtitle_picker_busy",nil);return;}
 UIViewController *presenter=RCTPresentedViewController();if(!presenter){reject(@"subtitle_picker_unavailable",@"subtitle_picker_unavailable",nil);return;}
 PorticoSubtitlePickRequest *request=[PorticoSubtitlePickRequest new];request.identifier=requestId;request.resolve=resolve;request.reject=reject;request.progress=[NSProgress progressWithTotalUnitCount:1];_request=request;
 NSMutableArray<UTType *> *types=[NSMutableArray new];
 for(NSString *extension in @[@"srt",@"vtt",@"ass",@"ssa",@"sup",@"idx",@"sub"]){[types addObject:[UTType typeWithFilenameExtension:extension]?:UTTypeData];}
 UIDocumentPickerViewController *picker=[[UIDocumentPickerViewController alloc]initForOpeningContentTypes:types asCopy:NO];request.picker=picker;picker.delegate=self;picker.allowsMultipleSelection=YES;[presenter presentViewController:picker animated:YES completion:nil];
#endif
}
#if !TARGET_OS_TV
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
 if(controller==_request.picker)[self finish:_request result:nil code:@"cancelled"];
}
- (NSData *)readSubtitle:(NSURL *)url limit:(NSUInteger)limit progress:(NSProgress *)progress error:(NSError **)error {
 if(progress.cancelled)return nil;
 BOOL scoped=[url startAccessingSecurityScopedResource];__block NSData *data=nil;__block NSError *readError=nil;
 NSFileCoordinator *coordinator=[[NSFileCoordinator alloc]initWithFilePresenter:nil];
 progress.cancellationHandler=^{[coordinator cancel];};
 @try {
  if(progress.cancelled)[coordinator cancel];
  else [coordinator coordinateReadingItemAtURL:url options:0 error:&readError byAccessor:^(NSURL *coordinated){
   NSFileHandle *file=[NSFileHandle fileHandleForReadingFromURL:coordinated error:&readError];if(!file)return;
   @try {
    NSMutableData *bounded=[NSMutableData new];
    while(!progress.cancelled&&bounded.length<=limit&&!readError){NSData *chunk=[file readDataUpToLength:MIN((NSUInteger)65536,limit+1-bounded.length) error:&readError];if(!chunk.length)break;[bounded appendData:chunk];}
    data=bounded;
   } @finally {[file closeAndReturnError:nil];}
  }];
 } @catch(NSException *exception) {readError=[NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadUnknownError userInfo:nil];}
 @finally {progress.cancellationHandler=nil;if(scoped)[url stopAccessingSecurityScopedResource];}
 if(error)*error=readError;
 return !progress.cancelled&&!readError&&data.length>0&&data.length<=limit?data:nil;
}
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
 PorticoSubtitlePickRequest *request=_request;
 if(_invalidated||!request||request.picker!=controller||request.reading)return;
 request.reading=YES;
 NSURL *url=nil,*paired=nil;
 for(NSURL *candidate in urls){if([candidate.pathExtension.lowercaseString isEqualToString:@"sub"])paired=candidate;else url=candidate;}
 NSString *format=url.pathExtension.lowercaseString;
 BOOL pair=[format isEqualToString:@"idx"];
 BOOL valid=urls.count==(pair?2:1)&&url.isFileURL&&[@[@"srt",@"vtt",@"ass",@"ssa",@"sup",@"idx"] containsObject:format];
 if(pair)valid=valid&&paired.isFileURL&&[paired.lastPathComponent.lowercaseString isEqualToString:[[url.lastPathComponent stringByDeletingPathExtension].lowercaseString stringByAppendingString:@".sub"]];
 if(!valid){[self finish:request result:nil code:@"subtitle_format"];return;}
 // Every selected security-scoped URL is coordinated and bounded separately.
 // Only bytes cross the bridge; neither paths nor long-lived URL access escape.
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
  NSError *error=nil;NSUInteger limit=[format isEqualToString:@"sup"]?33554432:4194304;
  NSData *data=[self readSubtitle:url limit:limit progress:request.progress error:&error];NSData *companion=nil;
  if(data&&pair)companion=[self readSubtitle:paired limit:33554432-data.length progress:request.progress error:&error];
  NSMutableDictionary *result=nil;
  if(data&&(!pair||companion)&&!error){result=[@{@"data":[data base64EncodedStringWithOptions:0],@"format":format,@"title":[url.lastPathComponent substringToIndex:MIN((NSUInteger)160,url.lastPathComponent.length)]} mutableCopy];if(companion)result[@"companion"]=[companion base64EncodedStringWithOptions:0];}
  dispatch_async(dispatch_get_main_queue(),^{
   [self finish:request result:result code:@"subtitle_file"];
  });
 });
}

#endif
@end


@interface PorticoDocumentPickRequest : NSObject
@property(nonatomic,copy) NSString *identifier;
@property(nonatomic,copy) NSString *kind;
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@property(nonatomic,strong) NSProgress *progress;
#if !TARGET_OS_TV
@property(nonatomic,strong) UIDocumentPickerViewController *picker;
@property(nonatomic,assign) BOOL reading;
#endif
@end
@implementation PorticoDocumentPickRequest @end

#if TARGET_OS_TV
@interface PorticoDocumentFiles : NSObject<RCTBridgeModule,RCTInvalidating> @end
#else
@interface PorticoDocumentFiles : NSObject<RCTBridgeModule,RCTInvalidating,UIDocumentPickerDelegate> @end
#endif
@implementation PorticoDocumentFiles {
 PorticoDocumentPickRequest *_request;
 atomic_bool _closed;
}
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup{return YES;}
- (instancetype)init {if((self=[super init]))atomic_init(&_closed,false);return self;}
- (dispatch_queue_t)methodQueue{return dispatch_get_main_queue();}
- (void)finish:(PorticoDocumentPickRequest *)request result:(NSDictionary *)result code:(NSString *)code terminal:(BOOL)terminal {
 if(!request||_request!=request)return;
 if(!terminal&&atomic_load(&_closed))return;
 _request=nil;[request.progress cancel];
#if !TARGET_OS_TV
 request.picker.delegate=nil;
 if(request.picker.presentingViewController)[request.picker dismissViewControllerAnimated:NO completion:nil];
 request.picker=nil;
#endif
 RCTPromiseResolveBlock resolve=request.resolve;RCTPromiseRejectBlock reject=request.reject;
 request.resolve=nil;request.reject=nil;
 if(result){if(resolve)resolve(result);}else if(reject)reject(code,code,nil);
}
- (void)invalidate {
 PorticoDocumentPickRequest *request;
 @synchronized(self){atomic_store(&_closed,true);request=_request;}
 if(!NSThread.isMainThread){dispatch_async(dispatch_get_main_queue(),^{[self finish:request result:nil code:@"cancelled" terminal:YES];});return;}
 [self finish:request result:nil code:@"cancelled" terminal:YES];
}
RCT_REMAP_METHOD(cancel,cancel:(NSString *)requestId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 if(atomic_load(&_closed)){resolve(@(NO));return;}
 PorticoDocumentPickRequest *request;
 @synchronized(self){request=_request;}
 BOOL current=[requestId isKindOfClass:NSString.class]&&[request.identifier isEqualToString:requestId];
 if(current)[self finish:request result:nil code:@"cancelled" terminal:NO];
 resolve(@(current));
}
RCT_REMAP_METHOD(pick,pick:(NSString *)requestId kind:(NSString *)kind resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 if(atomic_load(&_closed)){reject(@"bridge_closed",@"bridge_closed",nil);return;}
 if(![requestId isKindOfClass:NSString.class]||!requestId.length||requestId.length>128||[requestId rangeOfString:@"^[A-Za-z0-9_-]+$" options:NSRegularExpressionSearch].location==NSNotFound||
    ![kind isKindOfClass:NSString.class]||(![kind isEqualToString:@"playlist"]&&![kind isEqualToString:@"guide"])){reject(@"document_request_invalid",@"document_request_invalid",nil);return;}
#if TARGET_OS_TV
 reject(@"document_picker_unavailable",@"document_picker_unavailable",nil);
#else
 @synchronized(self) {
  if(atomic_load(&_closed)){reject(@"bridge_closed",@"bridge_closed",nil);return;}
  if(_request){reject(@"document_picker_busy",@"document_picker_busy",nil);return;}
  UIViewController *presenter=RCTPresentedViewController();if(!presenter){reject(@"document_picker_unavailable",@"document_picker_unavailable",nil);return;}
  PorticoDocumentPickRequest *request=[PorticoDocumentPickRequest new];
  request.identifier=requestId;request.kind=kind;request.resolve=resolve;request.reject=reject;request.progress=[NSProgress progressWithTotalUnitCount:1];
  NSMutableArray<UTType *> *types=[NSMutableArray new];
  for(NSString *extension in [kind isEqualToString:@"playlist"]?@[@"m3u",@"m3u8"]:@[@"xml"]){[types addObject:[UTType typeWithFilenameExtension:extension]?:UTTypeData];}
  UIDocumentPickerViewController *picker=[[UIDocumentPickerViewController alloc]initForOpeningContentTypes:types asCopy:NO];
  request.picker=picker;picker.delegate=self;picker.allowsMultipleSelection=NO;_request=request;
  // Recheck immediately before the one registration point.
  if(atomic_load(&_closed)){_request=nil;reject(@"bridge_closed",@"bridge_closed",nil);return;}
  [presenter presentViewController:picker animated:YES completion:nil];
 }
#endif
}
#if !TARGET_OS_TV
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
 PorticoDocumentPickRequest *request=_request;
 if(request&&controller==request.picker)[self finish:request result:nil code:@"cancelled" terminal:NO];
}
- (NSData *)readDocument:(NSURL *)url limit:(NSUInteger)limit request:(PorticoDocumentPickRequest *)request error:(NSError **)error {
 if(atomic_load(&_closed)||!request||request.progress.cancelled)return nil;
 BOOL scoped=[url startAccessingSecurityScopedResource];
 NSMutableData *bounded=[NSMutableData new];
 NSError *readError=nil;
 @try {
  NSFileHandle *file=[NSFileHandle fileHandleForReadingFromURL:url error:&readError];
  if(!file){if(error)*error=readError?:[NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadUnknownError userInfo:nil];return nil;}
  @try {
   while(!atomic_load(&_closed)&&!request.progress.cancelled&&bounded.length<=limit){
    NSData *chunk=[file readDataUpToLength:MIN((NSUInteger)65536,limit+1-bounded.length) error:&readError];
    if(!chunk){if(error)*error=readError?:[NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadUnknownError userInfo:nil];return nil;}
    if(!chunk.length)break;
    [bounded appendData:chunk];
   }
  } @finally {[file closeAndReturnError:nil];}
 } @finally {if(scoped)[url stopAccessingSecurityScopedResource];}
 if(error)*error=readError;
 return !atomic_load(&_closed)&&!request.progress.cancelled&&!readError&&bounded.length>0&&bounded.length<=limit?bounded:nil;
}
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
 PorticoDocumentPickRequest *request=_request;
 if(atomic_load(&_closed)||!request||controller!=request.picker||request.reading)return;
 request.reading=YES;
 NSURL *url=urls.count==1?urls.firstObject:nil;
 NSString *kind=request.kind;
 NSString *extension=url.pathExtension.lowercaseString;
 BOOL allowed=url.isFileURL&&([kind isEqualToString:@"playlist"]?[extension isEqualToString:@"m3u"]||[extension isEqualToString:@"m3u8"]:[extension isEqualToString:@"xml"]);
 if(!allowed){[self finish:request result:nil code:@"document_format" terminal:NO];return;}
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
  NSError *readError=nil;
  NSData *data=[self readDocument:url limit:16*1024*1024 request:request error:&readError];
  if(atomic_load(&_closed))return;
  NSString *text=data?[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding]:nil;
  NSDictionary *result=text.length?@{@"data":text,@"title":[url.lastPathComponent substringToIndex:MIN((NSUInteger)160,url.lastPathComponent.length)],@"bytes":@(data.length)}:nil;
  NSString *code=readError?@"document_file":(data&&!text?@"document_encoding":@"document_file");
  dispatch_async(dispatch_get_main_queue(),^{[self finish:request result:result code:code terminal:NO];});
 });
}
#endif
@end
