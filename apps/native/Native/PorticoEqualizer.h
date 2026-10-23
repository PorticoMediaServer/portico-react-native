#import <AVFoundation/AVFoundation.h>
static inline void PorticoConfigureEqualizer(AVAudioUnitEQ *equalizer,BOOL enabled,float preamp,const float gains[10]) {
 static const float frequencies[10]={31.25,62.5,125,250,500,1000,2000,4000,8000,16000};
 equalizer.bypass=!enabled;equalizer.globalGain=enabled?preamp:0;
 double nyquist=[equalizer inputFormatForBus:0].sampleRate/2;
 for(NSUInteger i=0;i<MIN((NSUInteger)10,equalizer.bands.count);i++){
  AVAudioUnitEQFilterParameters *band=equalizer.bands[i];band.filterType=AVAudioUnitEQFilterTypeParametric;band.frequency=frequencies[i];band.bandwidth=1;band.gain=gains[i];band.bypass=!enabled||(nyquist>0&&band.frequency>=nyquist);
 }
}
