/* Authored output-DSP vectors only. No file, recording, decoder, model, provider or device. */
#include "../Native/PorticoTruePeak.h"
#include <stdio.h>
static int failed;
static void check(int okay,const char *name){if(!okay){fprintf(stderr,"FAIL %s\n",name);failed++;}}
static float reconstructed_peak(const float *samples,unsigned frames,int channels){
 PorticoTruePeak *reference=ptp_create(48000,channels);if(!reference)return INFINITY;
 float peak=0;
 for(unsigned frame=0;frame<frames+PTP_UP_TAPS;frame++)for(int phase=0;phase<4;phase++)for(int ch=0;ch<channels;ch++){
  double value=0;
  for(int tap=0;tap<PTP_UP_TAPS;tap++){
   long at=(long)frame-tap;
   if(at>=0&&(unsigned long)at<frames)value+=reference->up[phase][tap]*samples[(size_t)at*channels+ch];
  }
  if(fabs(value)>peak)peak=(float)fabs(value);
 }
 ptp_destroy(reference);return peak;
}
int main(void){
 check(ptp_create(7999,2)==NULL&&ptp_create(48000,0)==NULL&&ptp_create(48000,33)==NULL,"closed format bounds");
 enum{Frames=8192,Channels=2};
 PorticoTruePeak *whole=ptp_create(48000,Channels),*split=ptp_create(48000,Channels);
 if(!whole||!split){ptp_destroy(whole);ptp_destroy(split);return 1;}
 unsigned latency=ptp_latency(whole),drain=ptp_drain_frames(whole),total=Frames+drain;
 check(drain>latency&&!ptp_has_tail(whole),"empty DSP versus distinct clock latency and full FIR drainage");
 float *input=calloc((size_t)total*Channels,sizeof(float));
 float *a=calloc((size_t)total*Channels,sizeof(float)),*b=calloc((size_t)total*Channels,sizeof(float));
 if(!input||!a||!b){free(input);free(a);free(b);ptp_destroy(whole);ptp_destroy(split);return 1;}
 for(unsigned n=0;n<Frames;n++){
  /* Two real in-phase deck contributions sum above full scale BEFORE this one limiter. */
  float x=(float)(1.8*sin(2*PTP_PI*19000*n/48000.0));
  if(n>=3000&&n<3010)x+=2;
  input[n*2]=x;input[n*2+1]=x*.5f;
 }
 memcpy(a,input,(size_t)total*Channels*sizeof(float));memcpy(b,input,(size_t)total*Channels*sizeof(float));
 check(reconstructed_peak(input,Frames,Channels)>1.5f,"the unprotected post-mix control really overloads");
 for(unsigned at=0;at<total;){unsigned count=total-at>8192?8192:total-at;check(ptp_process(whole,a+at*2,count),"whole process");at+=count;}
 const unsigned chunks[]={1,37,511,13,1024};
 for(unsigned at=0,n=0;at<total;n++){unsigned count=chunks[n%5];if(count>total-at)count=total-at;check(ptp_process(split,b+at*2,count),"split process");at+=count;}
 check(!memcmp(a,b,(size_t)total*Channels*sizeof(float)),"decoder/output chunking never changes DSP state or tail");
 check(whole->limited>0,"the linked limiter actually operated");
 check(!ptp_has_tail(whole),"full EOS zero support retires the final mixed sample");
 check(reconstructed_peak(a+latency*2,Frames,Channels)<=1.0f,"four-phase reconstructed output peak");
 float peak=0;int ratio=1;
 for(unsigned n=0;n<total;n++){
  if(fabsf(a[n*2])>peak)peak=fabsf(a[n*2]);
  if(!isfinite(a[n*2])||!isfinite(a[n*2+1])||fabsf(a[n*2+1]-a[n*2]*.5f)>1e-6f)ratio=0;
 }
 check(peak>.2f&&peak<=1,"protection does not mute or wrap");check(ratio,"linked gain preserves channel identity and ratios");
 ptp_reset(split);memset(b,0,(size_t)total*Channels*sizeof(float));
 check(ptp_process(split,b,1024),"reset process");
 int quiet=1;for(unsigned n=0;n<1024*2;n++)if(b[n]!=0)quiet=0;
 check(quiet&&split->at==4096,"reset retains no retired mix/filter/lookahead sample");
 check(!ptp_has_tail(split),"reset and silence carry no old output tail");
 b[0]=.25f;check(ptp_process(split,b,1)&&ptp_has_tail(split),"a final input frame owns a real FIR tail");
 memset(b,0,(size_t)drain*Channels*sizeof(float));
 check(ptp_process(split,b,drain)&&!ptp_has_tail(split),"bounded exact tail drainage completes");
 check(!ptp_process(split,b,8193),"bounded render block refusal");
 free(input);free(a);free(b);ptp_destroy(whole);ptp_destroy(split);
 return failed?1:0;
}
