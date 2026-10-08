#ifndef PorticoListeningPolicy_h
#define PorticoListeningPolicy_h
#include <stdbool.h>
#include <math.h>
typedef struct { double lease; double horizon; bool valid; } PorticoListeningLease;
/** Request-start anchoring intentionally subtracts all transport latency. */
static inline PorticoListeningLease PorticoListeningLeaseAt(double start,double server,double expiry,double horizon,bool leaseValid) {
 if(!isfinite(start)||!isfinite(server)||!isfinite(expiry)||!isfinite(horizon)||start<0)return (PorticoListeningLease){0,0,false};
 return (PorticoListeningLease){leaseValid?start+fmax(0,fmin(expiry,horizon)-server):0,start+fmax(0,horizon-server),true};
}
static inline bool PorticoListeningMayPlay(bool owner,bool terminal,bool interrupted,bool paused,bool ended,bool media,double now,double lease,double horizon) {
 return owner&&!terminal&&!interrupted&&!paused&&!ended&&media&&isfinite(now)&&now<lease&&now<horizon;
}
static inline bool PorticoListeningTimerExpired(double wallMS,double mono,double deadlineMS,double monoLimit) {
 return isfinite(deadlineMS)&&deadlineMS>0&&(wallMS>=deadlineMS||mono>=monoLimit);
}
#endif
