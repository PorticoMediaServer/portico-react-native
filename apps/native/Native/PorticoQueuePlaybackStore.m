#import "PorticoQueuePlaybackStore.h"
#import <Security/Security.h>
#import <limits.h>
#import <math.h>
static NSError *StoreError(void) { return [NSError errorWithDomain:@"PorticoQueuePlaybackStore" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Durable playback storage is unavailable or invalid."}]; }
static BOOL ID(id v) { return [v isKindOfClass:NSString.class] && [v length]>0 && [v length]<=128 && [v rangeOfString:@"^[A-Za-z0-9_-]+$" options:NSRegularExpressionSearch].location!=NSNotFound; }
static NSDictionary *Query(NSString *key) { return @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.queues",(__bridge id)kSecAttrAccount:key}; }
@implementation PorticoQueuePlaybackStore
+ (BOOL)counter:(id)value {
 if(![value isKindOfClass:NSString.class] || [value rangeOfString:@"^(0|[1-9][0-9]{0,18})$" options:NSRegularExpressionSearch].location==NSNotFound)return NO;
 return [value length]<19 || ([value length]==19 && [value compare:@"9223372036854775807"]!=NSOrderedDescending);
}
+ (NSString *)next:(NSString *)local high:(NSString *)high {
 if(![self counter:local]||![self counter:high])return nil;
 long long n=MAX(local.longLongValue,high.longLongValue);return n==LLONG_MAX?nil:[NSString stringWithFormat:@"%lld",n+1];
}
+ (BOOL)validKey:(NSString *)key scope:(NSDictionary *)scope {
 if(![key isKindOfClass:NSString.class]||![key hasPrefix:@"queue-v1:"]||key.length>4096||![scope isKindOfClass:NSDictionary.class])return NO;
 id outer=[NSJSONSerialization JSONObjectWithData:[[key substringFromIndex:9] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
 if(![outer isKindOfClass:NSArray.class]||[outer count]!=3||![outer[0] isKindOfClass:NSString.class]||![outer[1] isEqual:@"play"]||![outer[2] isEqual:@""])return NO;
 id values=[NSJSONSerialization JSONObjectWithData:[outer[0] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
 NSArray *fields=@[@"serverId",@"authority",@"accountId",@"profileId",@"controllerId",@"controllerEpoch",@"commandLaneId"];
 if(![values isKindOfClass:NSArray.class]||[values count]!=fields.count)return NO;
 for(NSUInteger i=0;i<fields.count;i++)if(!ID(scope[fields[i]])||![values[i] isEqual:scope[fields[i]]])return NO;
 return [@[@"local",@"hosted"] containsObject:scope[@"authority"]];
}
+ (id)read:(NSString *)key error:(NSError **)error {
 NSMutableDictionary *q=[Query(key) mutableCopy];q[(__bridge id)kSecReturnData]=@YES;CFTypeRef result=NULL;
 OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)q,&result);
 if(status==errSecItemNotFound)return NSNull.null;
 if(status!=errSecSuccess){if(result)CFRelease(result);if(error)*error=StoreError();return nil;}
 NSData *bytes=CFBridgingRelease(result);id value=bytes.length<=262144?[NSJSONSerialization JSONObjectWithData:bytes options:NSJSONReadingFragmentsAllowed error:nil]:nil;
 if(!value&&error)*error=StoreError();return value;
}
+ (BOOL)write:(NSString *)key value:(id)value error:(NSError **)error {
 NSData *bytes=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
 if(!bytes||bytes.length>262144){if(error)*error=StoreError();return NO;}
 NSDictionary *q=Query(key),*attributes=@{(__bridge id)kSecValueData:bytes,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};
 OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)q,(__bridge CFDictionaryRef)attributes);
 if(status==errSecItemNotFound){NSMutableDictionary *insert=[q mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}
 if(status!=errSecSuccess&&error)*error=StoreError();return status==errSecSuccess;
}
+ (id)transaction:(NSString *)key operation:(NSString *)operation payload:(NSDictionary *)p error:(NSError **)error {
 @synchronized(self) {
  if(![p isKindOfClass:NSDictionary.class]||![self validKey:key scope:p[@"scope"]]){if(error)*error=StoreError();return nil;}
  id raw=[self read:key error:error];if(!raw)return nil;
  if(raw==NSNull.null)raw=@{@"highest":@"0",@"pending":NSNull.null,@"controls":@{}};
  if(![raw isKindOfClass:NSDictionary.class]||![self counter:raw[@"highest"]]||!raw[@"pending"]||(raw[@"controls"]&&![raw[@"controls"] isKindOfClass:NSDictionary.class])){if(error)*error=StoreError();return nil;}
  NSMutableDictionary *row=[raw mutableCopy],*controls=[(row[@"controls"]?:@{}) mutableCopy];id result=NSNull.null;
  if([operation isEqual:@"pendingControls"])return controls.allValues;
  if([operation isEqual:@"pendingPlay"])return row[@"pending"];
  if([operation isEqual:@"reserveControl"]) {
   if(controls.count>=64||!ID(p[@"requestId"])||!ID(p[@"playbackId"])||!ID(p[@"operation"])||![p[@"body"] isKindOfClass:NSDictionary.class]||p[@"body"][@"command"]||controls[p[@"requestId"]])goto invalid;
   NSString *seq=[self next:row[@"highest"] high:p[@"high"]];if(!seq)goto invalid;
   NSDictionary *scope=p[@"scope"],*command=@{@"controllerId":scope[@"controllerId"],@"controllerEpoch":scope[@"controllerEpoch"],@"commandLaneId":scope[@"commandLaneId"],@"sequence":seq,@"requestId":p[@"requestId"]};
   NSMutableDictionary *body=[p[@"body"] mutableCopy];body[@"command"]=command;
   controls[p[@"requestId"]]=@{@"playbackId":p[@"playbackId"],@"operation":p[@"operation"],@"envelope":body};row[@"highest"]=seq;row[@"controls"]=controls;result=body;
  } else if([operation isEqual:@"acknowledgeControl"]) {
   NSString *identifier=p[@"body"][@"command"][@"requestId"];if(!ID(identifier))goto invalid;
   NSDictionary *saved=controls[identifier];if(saved&&![saved[@"envelope"][@"command"] isEqual:p[@"body"][@"command"]])goto invalid;
   [controls removeObjectForKey:identifier];row[@"controls"]=controls;
  } else if([operation isEqual:@"reservePlay"]) {
   if(row[@"pending"]!=NSNull.null)return @{@"pending":row[@"pending"],@"recovered":@YES};
   NSDictionary *intent=p[@"intent"];if(![intent isKindOfClass:NSDictionary.class]||!ID(p[@"queueId"])||!ID(p[@"requestId"])||![self counter:intent[@"expectedRevision"]]||![intent[@"expectedRevision"] longLongValue]||![@[@"entry",@"manual",@"completion"] containsObject:intent[@"reason"]]||!([intent[@"reason"] isEqual:@"entry"]?ID(intent[@"entryId"]):[intent[@"entryId"] isEqual:@""])||!(intent[@"currentPlaybackId"]==NSNull.null||ID(intent[@"currentPlaybackId"])))goto invalid;
   id start=intent[@"startSeconds"];if(start!=NSNull.null&&(![start isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)start)==CFBooleanGetTypeID()||!isfinite([start doubleValue])||[start doubleValue]<0||[start doubleValue]>1e9))goto invalid;
   id prepared=intent[@"prepareAudio"];
   if(prepared&&(![prepared isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)prepared)!=CFBooleanGetTypeID()||([prepared boolValue]&&(![intent[@"reason"]isEqual:@"completion"]||!ID(intent[@"currentPlaybackId"])||(start!=NSNull.null&&[start doubleValue]!=0)))))goto invalid;
   id choice=intent[@"prepared"];
   if(choice){
    if(![choice isKindOfClass:NSDictionary.class]||[choice count]!=3||![intent[@"reason"]isEqual:@"entry"]||[prepared boolValue]||!ID(choice[@"versionId"]))goto invalid;
    id revision=choice[@"expectedRevision"];NSString *offers=choice[@"offersRevision"];
    if(![revision isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)revision)==CFBooleanGetTypeID()||!isfinite([revision doubleValue])||[revision doubleValue]<1||[revision doubleValue]>9007199254740991.0||floor([revision doubleValue])!=[revision doubleValue]||![offers isKindOfClass:NSString.class]||[offers rangeOfString:@"^[0-9a-f]{64}$" options:NSRegularExpressionSearch].location==NSNotFound)goto invalid;
   }
   NSString *seq=[self next:row[@"highest"] high:p[@"high"]];if(!seq)goto invalid;
   NSMutableDictionary *command=[intent mutableCopy];command[@"requestId"]=p[@"requestId"];command[@"sequence"]=seq;
   NSDictionary *pending=@{@"queueId":p[@"queueId"],@"command":command,@"cancelled":@NO};row[@"highest"]=seq;row[@"pending"]=pending;result=@{@"pending":pending,@"recovered":@NO};
  } else if([operation isEqual:@"cancelPlay"]||[operation isEqual:@"acknowledgePlay"]) {
   NSDictionary *saved=row[@"pending"]==NSNull.null?nil:row[@"pending"],*pending=p[@"pending"];
   if(![pending isKindOfClass:NSDictionary.class])goto invalid;
   if(saved&&[saved[@"queueId"] isEqual:pending[@"queueId"]]&&[saved[@"command"] isEqual:pending[@"command"]]) {
    if([operation isEqual:@"cancelPlay"]){NSMutableDictionary *cancelled=[saved mutableCopy];cancelled[@"cancelled"]=@YES;row[@"pending"]=cancelled;}else row[@"pending"]=NSNull.null;
   }
  } else goto invalid;
  if(![self write:key value:row error:error])return nil;return result;
 invalid:
  if(error)*error=StoreError();return nil;
 }
}
@end
