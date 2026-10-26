#ifndef PORTICO_TRUE_PEAK_H
#define PORTICO_TRUE_PEAK_H
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* Application output DSP, after the shared mix/EQ/rate processing. Four-phase windowed-sinc
 * interpolation, linked-channel 5 ms lookahead, instantaneous attack and 50 ms release; no
 * make-up gain. The working oversampled ceiling is -1 dBFS. The decimator removes nonlinear
 * out-of-band energy. This is not a physical DAC/HDMI or executed conformance assertion.
 *
 * One owner/render thread per instance. All storage is bounded and allocated before rendering.
 * Latency is constant: callers retain/drain these frames and account for them in their clock;
 * seeking/retirement resets/destroys this instance, never another presentation's reference. */
#define PTP_CHANNELS 32
#define PTP_UP_TAPS 32
#define PTP_DOWN_TAPS 64
#define PTP_PI 3.14159265358979323846

typedef struct PorticoTruePeak {
 int rate,channels,lookahead,capacity;
 uint64_t at;
 float gain,release;
 float up[4][PTP_UP_TAPS],down[PTP_DOWN_TAPS];
 float upHistory[PTP_UP_TAPS][PTP_CHANNELS],downHistory[PTP_DOWN_TAPS][PTP_CHANNELS];
 int upAt,downAt,head,count;
 float *delay,*peaks;
 uint64_t *indices;
 uint64_t limited;
} PorticoTruePeak;

static inline double ptp_sinc(double x){return fabs(x)<1e-12?1.0:sin(PTP_PI*x)/(PTP_PI*x);}
static inline double ptp_blackman(double x){return fabs(x)>=1?0:.42+.5*cos(PTP_PI*x)+.08*cos(2*PTP_PI*x);}
static inline unsigned ptp_latency(const PorticoTruePeak *s){return s?16+(unsigned)s->lookahead/4+8:0;}
static inline void ptp_destroy(PorticoTruePeak *s){if(s){free(s->delay);free(s->peaks);free(s->indices);free(s);}}
static inline void ptp_reset(PorticoTruePeak *s){
 if(!s)return;s->at=0;s->gain=1;s->upAt=s->downAt=s->head=s->count=0;s->limited=0;
 memset(s->upHistory,0,sizeof(s->upHistory));memset(s->downHistory,0,sizeof(s->downHistory));
 memset(s->delay,0,(size_t)s->capacity*s->channels*sizeof(float));
}
static inline PorticoTruePeak *ptp_create(int rate,int channels){
 if(rate<8000||rate>768000||channels<1||channels>PTP_CHANNELS)return NULL;
 PorticoTruePeak *s=(PorticoTruePeak *)calloc(1,sizeof(*s));if(!s)return NULL;
 s->rate=rate;s->channels=channels;s->lookahead=(int)ceil(rate*.005)*4;s->capacity=s->lookahead+1;
 s->release=(float)(1-exp(-1.0/(rate*4.0*.050)));
 s->delay=(float *)calloc((size_t)s->capacity*channels,sizeof(float));
 s->peaks=(float *)calloc((size_t)s->capacity,sizeof(float));
 s->indices=(uint64_t *)calloc((size_t)s->capacity,sizeof(uint64_t));
 if(!s->delay||!s->peaks||!s->indices){ptp_destroy(s);return NULL;}
 for(int phase=0;phase<4;phase++){
  double sum=0;
  for(int k=0;k<PTP_UP_TAPS;k++){
   double d=k-16+phase/4.0,v=ptp_sinc(d)*ptp_blackman(d/16.0);
   s->up[phase][k]=(float)v;sum+=v;
  }
  for(int k=0;k<PTP_UP_TAPS;k++)s->up[phase][k]/=(float)sum;
 }
 double sum=0;
 for(int k=0;k<PTP_DOWN_TAPS;k++){
  double d=k-32,v=.235*ptp_sinc(.235*d)*ptp_blackman(d/32.0);
  s->down[k]=(float)v;sum+=v;
 }
 for(int k=0;k<PTP_DOWN_TAPS;k++)s->down[k]/=(float)sum;
 ptp_reset(s);return s;
}
/* Interleaved Float32, in place. No allocation, locking, provider IO or callback from this loop. */
static inline int ptp_process(PorticoTruePeak *s,float *pcm,unsigned frames){
 if(!s||!pcm||frames>8192)return 0;
 for(unsigned frame=0;frame<frames;frame++){
  float result[PTP_CHANNELS]={0};
  for(int ch=0;ch<s->channels;ch++){
   float x=pcm[(size_t)frame*s->channels+ch];s->upHistory[s->upAt][ch]=isfinite(x)?x:0;
  }
  for(int phase=0;phase<4;phase++){
   float up[PTP_CHANNELS],peak=0;
   for(int ch=0;ch<s->channels;ch++){
    double value=0;
    for(int k=0;k<PTP_UP_TAPS;k++)value+=s->up[phase][k]*s->upHistory[(s->upAt-k+PTP_UP_TAPS)%PTP_UP_TAPS][ch];
    up[ch]=(float)value;if(fabsf(up[ch])>peak)peak=fabsf(up[ch]);
   }
   uint64_t n=s->at++;int put=(int)(n%(uint64_t)s->capacity);
   memcpy(s->delay+(size_t)put*s->channels,up,(size_t)s->channels*sizeof(float));
   while(s->count&&s->indices[s->head]+(uint64_t)s->lookahead<n){s->head=(s->head+1)%s->capacity;s->count--;}
   while(s->count&&s->peaks[(s->head+s->count-1)%s->capacity]<=peak)s->count--;
   int tail=(s->head+s->count)%s->capacity;s->peaks[tail]=peak;s->indices[tail]=n;s->count++;
   float window=s->peaks[s->head],wanted=window>.8912509381f?.8912509381f/window:1;
   s->gain=wanted<s->gain?wanted:s->gain+(wanted-s->gain)*s->release;
   if(s->gain<.999999f)s->limited++;
   int read=n>=(uint64_t)s->lookahead?(int)((n-s->lookahead)%(uint64_t)s->capacity):-1;
   for(int ch=0;ch<s->channels;ch++){
    float limited=read<0?0:s->delay[(size_t)read*s->channels+ch]*s->gain;
    s->downHistory[s->downAt][ch]=limited;
    if(phase==0){
     double value=0;
     for(int k=0;k<PTP_DOWN_TAPS;k++)value+=s->down[k]*s->downHistory[(s->downAt-k+PTP_DOWN_TAPS)%PTP_DOWN_TAPS][ch];
     result[ch]=(float)(isfinite(value)?fmax(-1,fmin(1,value)):0);
    }
   }
   s->downAt=(s->downAt+1)%PTP_DOWN_TAPS;
  }
  memcpy(pcm+(size_t)frame*s->channels,result,(size_t)s->channels*sizeof(float));
  s->upAt=(s->upAt+1)%PTP_UP_TAPS;
 }
 return 1;
}
#endif
