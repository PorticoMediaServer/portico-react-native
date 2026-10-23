#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <TargetConditionals.h>
#import <UIKit/UIKit.h>
#if !TARGET_OS_TV
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#endif

#if TARGET_OS_TV
@interface PorticoSubtitleFiles : NSObject<RCTBridgeModule> @end
#else
@interface PorticoSubtitleFiles : NSObject<RCTBridgeModule,UIDocumentPickerDelegate> @end
#endif
@implementation PorticoSubtitleFiles {
 RCTPromiseResolveBlock _resolve;RCTPromiseRejectBlock _reject;
}
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup{return YES;}
- (dispatch_queue_t)methodQueue{return dispatch_get_main_queue();}
RCT_REMAP_METHOD(pick,pickResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
#if TARGET_OS_TV
 reject(@"subtitle_picker_unavailable",@"subtitle_picker_unavailable",nil);
#else
 if(_resolve){reject(@"subtitle_picker_busy",@"subtitle_picker_busy",nil);return;}
 UIViewController *presenter=RCTPresentedViewController();if(!presenter){reject(@"subtitle_picker_unavailable",@"subtitle_picker_unavailable",nil);return;}
 _resolve=[resolve copy];_reject=[reject copy];
 NSMutableArray<UTType *> *types=[NSMutableArray new];
 for(NSString *extension in @[@"srt",@"vtt",@"ass",@"ssa",@"sup",@"idx",@"sub"]){[types addObject:[UTType typeWithFilenameExtension:extension]?:UTTypeData];}
 UIDocumentPickerViewController *picker=[[UIDocumentPickerViewController alloc]initForOpeningContentTypes:types asCopy:NO];picker.delegate=self;picker.allowsMultipleSelection=YES;[presenter presentViewController:picker animated:YES completion:nil];
#endif
}
#if !TARGET_OS_TV
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
 RCTPromiseRejectBlock reject=_reject;_resolve=nil;_reject=nil;if(reject)reject(@"cancelled",@"cancelled",nil);
}
- (NSData *)readSubtitle:(NSURL *)url limit:(NSUInteger)limit error:(NSError **)error {
 BOOL scoped=[url startAccessingSecurityScopedResource];__block NSData *data=nil;__block NSError *readError=nil;
 NSFileCoordinator *coordinator=[[NSFileCoordinator alloc]initWithFilePresenter:nil];
 [coordinator coordinateReadingItemAtURL:url options:0 error:&readError byAccessor:^(NSURL *coordinated){
  NSFileHandle *file=[NSFileHandle fileHandleForReadingFromURL:coordinated error:&readError];if(!file)return;
  NSMutableData *bounded=[NSMutableData new];
  while(bounded.length<=limit&&!readError){NSData *chunk=[file readDataUpToLength:MIN((NSUInteger)65536,limit+1-bounded.length) error:&readError];if(!chunk.length)break;[bounded appendData:chunk];}
  data=bounded;[file closeAndReturnError:nil];
 }];
 if(scoped)[url stopAccessingSecurityScopedResource];if(error)*error=readError;
 return !readError&&data.length>0&&data.length<=limit?data:nil;
}
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
 NSURL *url=nil,*paired=nil;
 for(NSURL *candidate in urls){if([candidate.pathExtension.lowercaseString isEqualToString:@"sub"])paired=candidate;else url=candidate;}
 NSString *format=url.pathExtension.lowercaseString;
 BOOL pair=[format isEqualToString:@"idx"];
 BOOL valid=urls.count==(pair?2:1)&&url.isFileURL&&[@[@"srt",@"vtt",@"ass",@"ssa",@"sup",@"idx"] containsObject:format];
 if(pair)valid=valid&&paired.isFileURL&&[paired.lastPathComponent.lowercaseString isEqualToString:[[url.lastPathComponent stringByDeletingPathExtension].lowercaseString stringByAppendingString:@".sub"]];
 if(!valid){RCTPromiseRejectBlock reject=_reject;_resolve=nil;_reject=nil;if(reject)reject(@"subtitle_format",@"subtitle_format",nil);return;}
 // Every selected security-scoped URL is coordinated and bounded separately.
 // Only bytes cross the bridge; neither paths nor long-lived URL access escape.
 dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
  NSError *error=nil;NSUInteger limit=[format isEqualToString:@"sup"]?33554432:4194304;
  NSData *data=[self readSubtitle:url limit:limit error:&error];NSData *companion=nil;
  if(data&&pair)companion=[self readSubtitle:paired limit:33554432-data.length error:&error];
  NSMutableDictionary *result=nil;
  if(data&&(!pair||companion)&&!error){result=[@{@"data":[data base64EncodedStringWithOptions:0],@"format":format,@"title":[url.lastPathComponent substringToIndex:MIN((NSUInteger)160,url.lastPathComponent.length)]} mutableCopy];if(companion)result[@"companion"]=[companion base64EncodedStringWithOptions:0];}
  dispatch_async(dispatch_get_main_queue(),^{RCTPromiseResolveBlock resolve=self->_resolve;RCTPromiseRejectBlock reject=self->_reject;self->_resolve=nil;self->_reject=nil;
   if(!result){if(reject)reject(@"subtitle_file",@"subtitle_file",nil);return;}if(resolve)resolve(result);
  });
 });
}

#endif
@end
