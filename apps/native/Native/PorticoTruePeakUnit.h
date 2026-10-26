#pragma once
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#include "PorticoTruePeak.h"
#include <stddef.h>
#include <stdatomic.h>

/* One engine-local effect AFTER the main mixer. A stable C render state is configured only while
 * the engine is stopped; the real-time block allocates nothing and captures no owner/player. */
typedef struct PorticoTruePeakRenderState {
 PorticoTruePeak *dsp;float *input,*output,*work;AudioBufferList *pull;
 AUAudioFrameCount capacity;AVAudioChannelCount channels;
 atomic_bool pendingTail;
} PorticoTruePeakRenderState;
@interface PorticoTruePeakUnit : AUAudioUnit
- (BOOL)hasPendingTail;
@end
@implementation PorticoTruePeakUnit {
 AUAudioUnitBus *_input,*_output;AUAudioUnitBusArray *_inputs,*_outputs;
 PorticoTruePeakRenderState *_state;
}
- (instancetype)initWithComponentDescription:(AudioComponentDescription)description options:(AudioComponentInstantiationOptions)options error:(NSError **)error {
 if((self=[super initWithComponentDescription:description options:options error:error])){
  AVAudioFormat *format=[[AVAudioFormat alloc]initStandardFormatWithSampleRate:44100 channels:2];
  _input=[[AUAudioUnitBus alloc]initWithFormat:format error:error];_output=[[AUAudioUnitBus alloc]initWithFormat:format error:error];
  if(!_input||!_output)return nil;
  _input.maximumChannelCount=32;_output.maximumChannelCount=32;
  _inputs=[[AUAudioUnitBusArray alloc]initWithAudioUnit:self busType:AUAudioUnitBusTypeInput busses:@[_input]];
  _outputs=[[AUAudioUnitBusArray alloc]initWithAudioUnit:self busType:AUAudioUnitBusTypeOutput busses:@[_output]];
  _state=calloc(1,sizeof(*_state));if(!_state)return nil;
  atomic_init(&_state->pendingTail,false);
  self.maximumFramesToRender=8192;
 }return self;
}
- (AUAudioUnitBusArray *)inputBusses {return _inputs;}
- (AUAudioUnitBusArray *)outputBusses {return _outputs;}
- (NSArray<NSNumber *> *)channelCapabilities {return @[@(-1),@(-1)];}
- (BOOL)shouldChangeToFormat:(AVAudioFormat *)format forBus:(AUAudioUnitBus *)bus {
 return format.commonFormat==AVAudioPCMFormatFloat32&&!format.interleaved&&format.channelCount>=1&&
  format.channelCount<=32&&format.sampleRate>=8000&&format.sampleRate<=768000&&floor(format.sampleRate)==format.sampleRate;
}
- (NSTimeInterval)latency {
 double rate=_output.format.sampleRate;return rate>0?(16+ceil(rate*.005)+8)/rate:0;
}
- (NSTimeInterval)tailTime {
 double rate=_output.format.sampleRate;
 return rate>0?(PTP_UP_TAPS-1+ceil(rate*.005)+(PTP_DOWN_TAPS-1+3)/4)/rate:0;
}
- (BOOL)hasPendingTail {return _state&&atomic_load(&_state->pendingTail);}
- (BOOL)allocateRenderResourcesAndReturnError:(NSError **)error {
 if(![super allocateRenderResourcesAndReturnError:error])return NO;
 AVAudioFormat *format=_output.format;
 BOOL valid=[self shouldChangeToFormat:format forBus:_output]&&[_input.format isEqual:format]&&
  self.maximumFramesToRender>0&&self.maximumFramesToRender<=8192&&_state&&!_state->dsp;
 if(valid){
  _state->capacity=self.maximumFramesToRender;_state->channels=format.channelCount;
  size_t samples=(size_t)_state->capacity*_state->channels;
  _state->dsp=ptp_create((int)format.sampleRate,(int)format.channelCount);
  _state->input=calloc(samples,sizeof(float));_state->output=calloc(samples,sizeof(float));_state->work=calloc(samples,sizeof(float));
  _state->pull=calloc(1,offsetof(AudioBufferList,mBuffers)+format.channelCount*sizeof(AudioBuffer));
  valid=_state->dsp&&_state->input&&_state->output&&_state->work&&_state->pull;
 }
 if(!valid){[self deallocateRenderResources];if(error)*error=[NSError errorWithDomain:NSOSStatusErrorDomain code:kAudioUnitErr_FormatNotSupported userInfo:nil];return NO;}
 return YES;
}
- (void)deallocateRenderResources {
 if(_state){atomic_store(&_state->pendingTail,false);ptp_destroy(_state->dsp);_state->dsp=NULL;free(_state->input);_state->input=NULL;
  free(_state->output);_state->output=NULL;free(_state->work);_state->work=NULL;free(_state->pull);_state->pull=NULL;}
 [super deallocateRenderResources];
}
- (void)reset {[super reset];if(_state){ptp_reset(_state->dsp);atomic_store(&_state->pendingTail,false);}}
- (AUInternalRenderBlock)internalRenderBlock {
 PorticoTruePeakRenderState *state=_state;
 return ^AUAudioUnitStatus(AudioUnitRenderActionFlags *flags,const AudioTimeStamp *when,AUAudioFrameCount frames,
                         NSInteger bus,AudioBufferList *out,const AURenderEvent *events,AURenderPullInputBlock pull){
  if(!state||!state->dsp||!pull||frames>state->capacity||bus!=0)return kAudioUnitErr_Uninitialized;
  if(!out||out->mNumberBuffers!=state->channels)return kAudioUnitErr_FormatNotSupported;
  state->pull->mNumberBuffers=state->channels;
  for(unsigned ch=0;ch<state->channels;ch++){
   state->pull->mBuffers[ch].mNumberChannels=1;state->pull->mBuffers[ch].mDataByteSize=frames*sizeof(float);
   state->pull->mBuffers[ch].mData=state->input+(size_t)ch*state->capacity;
  }
  AUAudioUnitStatus status=pull(flags,when,frames,0,state->pull);if(status!=noErr)return status;
  BOOL silence=flags&&(*flags&kAudioUnitRenderAction_OutputIsSilence);
  for(unsigned ch=0;ch<state->channels;ch++){
   const float *source=state->pull->mBuffers[ch].mData;
   if(!silence&&(!source||state->pull->mBuffers[ch].mDataByteSize<frames*sizeof(float)))return kAudioUnitErr_FormatNotSupported;
   for(unsigned f=0;f<frames;f++)state->work[(size_t)f*state->channels+ch]=silence?0:source[f];
  }
  if(!ptp_process(state->dsp,state->work,frames))return kAudioUnitErr_CannotDoInCurrentContext;
  atomic_store(&state->pendingTail,ptp_has_tail(state->dsp));
  // Upstream silence does not imply output silence: a real retained lookahead/tail may remain.
  if(flags)*flags&=~kAudioUnitRenderAction_OutputIsSilence;
  for(unsigned ch=0;ch<state->channels;ch++){
   if(out->mBuffers[ch].mNumberChannels!=1)return kAudioUnitErr_FormatNotSupported;
   if(!out->mBuffers[ch].mData)out->mBuffers[ch].mData=state->output+(size_t)ch*state->capacity;
   else if(out->mBuffers[ch].mDataByteSize<frames*sizeof(float))return kAudioUnitErr_TooManyFramesToProcess;
   float *target=out->mBuffers[ch].mData;
   for(unsigned f=0;f<frames;f++)target[f]=state->work[(size_t)f*state->channels+ch];
   out->mBuffers[ch].mDataByteSize=frames*sizeof(float);
  }
  return noErr;
 };
}
- (void)dealloc {if(_state){ptp_destroy(_state->dsp);free(_state->input);free(_state->output);free(_state->work);free(_state->pull);free(_state);}}
@end

static inline AVAudioUnitEffect *PorticoCreateTruePeakUnit(void){
 static dispatch_once_t once;AudioComponentDescription description={kAudioUnitType_Effect,'PtpL','Prtc',0,0};
 dispatch_once(&once,^{[AUAudioUnit registerSubclass:PorticoTruePeakUnit.class asComponentDescription:description name:@"Portico: True Peak" version:1];});
 return [[AVAudioUnitEffect alloc]initWithAudioComponentDescription:description];
}
