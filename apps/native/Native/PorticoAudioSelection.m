#import "PorticoAudioSelection.h"
@implementation PorticoAudioSelection {
 AVPlayerItem *_item; AVMediaSelectionGroup *_group; NSDictionary *_command; NSDictionary<NSString *,AVMediaSelectionOption *> *_options;
#if DEBUG
 BOOL _testDropped; NSInteger _testDroppedRevision;
#endif
 NSUInteger _lifetime; NSInteger _sequence; NSInteger _handledRevision; id _observer; id _errorObserver; BOOL _loading; BOOL _attempted;
}
- (void)invalidate {
 _lifetime++;if(_errorObserver){[[NSNotificationCenter defaultCenter]removeObserver:_errorObserver];_errorObserver=nil;}if(_observer){[[NSNotificationCenter defaultCenter]removeObserver:_observer];_observer=nil;}
 _item=nil;_group=nil;_options=nil;_command=nil;_sequence=0;_handledRevision=-1;_loading=NO;_attempted=NO;
}
- (void)emit:(NSString *)type extra:(NSDictionary *)extra {
 if(!_command||!self.onFact)return;
 NSMutableDictionary *fact=[@{@"type":type,@"audioBinding":_command[@"binding"],@"audioEpoch":_command[@"epoch"]}mutableCopy];[fact addEntriesFromDictionary:extra];self.onFact(fact);
}
- (void)sample {
 if(!_group||!_options||!_item)return;
#if DEBUG
 NSDictionary *testPending=[_command[@"pending"]isKindOfClass:NSDictionary.class]?_command[@"pending"]:nil;
 if(_testDropped&&testPending&&[testPending[@"revision"]integerValue]==_testDroppedRevision){[self emit:@"audioTestSuppressed" extra:@{@"audioRevision":@(_testDroppedRevision)}];return;}
#endif
 AVMediaSelectionOption *selected=[_item.currentMediaSelection selectedMediaOptionInMediaSelectionGroup:_group];NSString *observed=nil;
 for(NSString *key in _options)if(_options[key]==selected){observed=key;break;}
 [self emit:@"audioObserved" extra:@{@"audioSequence":@(++_sequence),@"renditionId":observed?:NSNull.null}];
 NSDictionary *pending=[_command[@"pending"]isKindOfClass:NSDictionary.class]?_command[@"pending"]:nil;
 if(pending&&[pending[@"revision"]integerValue]==_handledRevision&&[pending[@"renditionId"]isEqual:observed])
  [self emit:@"audioApplied" extra:@{@"audioRevision":pending[@"revision"],@"renditionId":observed}];
}
- (void)selectPending {
 if(!_group||!_options)return;
 NSDictionary *pending=[_command[@"pending"]isKindOfClass:NSDictionary.class]?_command[@"pending"]:nil;
 if(!pending)return;
 NSInteger revision=[pending[@"revision"]integerValue];if(revision==_handledRevision)return;
 _handledRevision=revision;NSString *target=pending[@"renditionId"];AVMediaSelectionOption *option=_options[target];
 if(!option){[self emit:@"audioFailed" extra:@{@"audioRevision":@(revision),@"error":@"audio_track_unavailable"}];return;}
#if DEBUG
 if(!_testDropped&&[NSProcessInfo.processInfo.environment[@"PORTICO_TEST_AUDIO_TIMEOUT"]isEqualToString:@"1"]){_testDropped=YES;_testDroppedRevision=revision;}
#endif
 [_item selectMediaOption:option inMediaSelectionGroup:_group];
 // A same-option retry need not emit a change notification. Observe the actual current object explicitly.
 [self sample];
}
- (void)apply:(NSDictionary *)command item:(AVPlayerItem *)item {
 if(![command isKindOfClass:NSDictionary.class]||![command[@"binding"]isKindOfClass:NSDictionary.class]||![command[@"epoch"]isKindOfClass:NSNumber.class]||![command[@"renditions"]isKindOfClass:NSArray.class]||!item){[self invalidate];return;}
 BOOL changed=item!=_item||![_command[@"binding"]isEqual:command[@"binding"]]||![_command[@"epoch"]isEqual:command[@"epoch"]];
 if(changed){[self invalidate];_item=item;}
 _command=[command copy];
 if(_group){[self selectPending];return;}
 if(_loading||_attempted)return;_loading=YES;_attempted=YES;
 NSUInteger lifetime=_lifetime;AVPlayerItem *captured=item;__weak PorticoAudioSelection *weakSelf=self;
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,15*NSEC_PER_SEC),dispatch_get_main_queue(),^{
  PorticoAudioSelection *view=weakSelf;if(view&&view->_lifetime==lifetime&&view->_item==captured&&view->_loading){view->_loading=NO;[view emit:@"audioMapped" extra:@{@"renditionIds":@[],@"audioMappingFailure":@"timeout"}];}
 });
 [item.asset loadMediaSelectionGroupForMediaCharacteristic:AVMediaCharacteristicAudible completionHandler:^(AVMediaSelectionGroup *group,NSError *error){
  dispatch_async(dispatch_get_main_queue(),^{
   PorticoAudioSelection *self=weakSelf;if(!self||self->_lifetime!=lifetime||self->_item!=captured||!self->_loading)return;
   self->_loading=NO;NSArray *renditions=self->_command[@"renditions"];NSMutableDictionary *mapped=[NSMutableDictionary new];BOOL valid=group&&renditions.count>=1&&renditions.count<=16&&group.options.count==renditions.count;
   NSHashTable *objects=[NSHashTable hashTableWithOptions:NSPointerFunctionsObjectPointerPersonality|NSPointerFunctionsStrongMemory];
   for(NSDictionary *rendition in renditions){
    NSString *rid=rendition[@"id"],*name=rendition[@"name"];AVMediaSelectionOption *match=nil;
    if(![rid isKindOfClass:NSString.class]||!rid.length||![name isKindOfClass:NSString.class]||!name.length||mapped[rid]){valid=NO;break;}
    for(AVMediaSelectionOption *option in group.options){
     BOOL exact=NO;for(AVMetadataItem *metadata in option.commonMetadata){
      if([metadata.identifier isEqualToString:@"m3u8/NAME"]&&[metadata.keySpace isEqualToString:@"m3u8"]&&[metadata.commonKey isEqual:AVMetadataCommonKeyTitle]&&[metadata.stringValue isEqualToString:name])exact=YES;
     }
     if(exact){if(match){valid=NO;break;}match=option;}
    }
    if(!match||[objects containsObject:match]){valid=NO;break;}mapped[rid]=match;[objects addObject:match];
   }
   if(!valid||mapped.count!=renditions.count||objects.count!=group.options.count){[self emit:@"audioMapped" extra:@{@"renditionIds":@[],@"audioMappingFailure":error?@"load_failed":@"unsupported_metadata"}];return;}
   self->_group=group;self->_options=[mapped copy];
   self->_observer=[[NSNotificationCenter defaultCenter]addObserverForName:AVPlayerItemMediaSelectionDidChangeNotification object:captured queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note){
    PorticoAudioSelection *view=weakSelf;if(view&&view->_lifetime==lifetime&&view->_item==captured)[view sample];
   }];
   self->_errorObserver=[[NSNotificationCenter defaultCenter]addObserverForName:AVPlayerItemNewErrorLogEntryNotification object:captured queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note){
    PorticoAudioSelection *view=weakSelf;if(!view||view->_lifetime!=lifetime||view->_item!=captured)return;
    AVPlayerItemErrorLogEvent *event=captured.errorLog.events.lastObject;
    if(event.errorStatusCode!=422)return;
    NSString *file=[NSURL URLWithString:event.URI].lastPathComponent,*fallback=view->_command[@"defaultRenditionId"];
    for(NSString *rid in view->_options){
     if([rid isEqual:fallback]||![rid hasPrefix:@"audio-"])continue;
     if([file isEqual:[rid stringByAppendingString:@".m3u8"]]||[file hasPrefix:[rid stringByAppendingString:@"-"]]){
      [view emit:@"audioUnavailable" extra:@{@"renditionId":rid}];
      AVMediaSelectionOption *option=view->_options[fallback];if(option){[captured selectMediaOption:option inMediaSelectionGroup:view->_group];[view sample];}break;
     }
    }
   }];
   [self emit:@"audioMapped" extra:@{@"renditionIds":mapped.allKeys}];[self sample];[self selectPending];
  });
 }];
}
- (void)dealloc{if(_errorObserver)[[NSNotificationCenter defaultCenter]removeObserver:_errorObserver];if(_observer)[[NSNotificationCenter defaultCenter]removeObserver:_observer];}
@end
