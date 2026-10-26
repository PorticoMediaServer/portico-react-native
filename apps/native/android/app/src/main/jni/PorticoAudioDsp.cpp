#include <jni.h>
#include <cstdint>
#include "PorticoTruePeak.h"
extern "C" JNIEXPORT jlong JNICALL Java_tv_getportico_portico_native_PorticoTruePeakNative_create(JNIEnv *,jobject,jint rate,jint channels){
 return (jlong)(uintptr_t)ptp_create(rate,channels);
}
extern "C" JNIEXPORT jint JNICALL Java_tv_getportico_portico_native_PorticoTruePeakNative_latency(JNIEnv *,jobject,jlong handle){
 return (jint)ptp_latency((PorticoTruePeak *)(uintptr_t)handle);
}
extern "C" JNIEXPORT jint JNICALL Java_tv_getportico_portico_native_PorticoTruePeakNative_drain(JNIEnv *,jobject,jlong handle){
 return (jint)ptp_drain_frames((PorticoTruePeak *)(uintptr_t)handle);
}
extern "C" JNIEXPORT jboolean JNICALL Java_tv_getportico_portico_native_PorticoTruePeakNative_process(JNIEnv *env,jobject,jlong handle,jobject buffer,jint frames){
 PorticoTruePeak *s=(PorticoTruePeak *)(uintptr_t)handle;
 if(!s||frames<0||frames>8192||!buffer)return JNI_FALSE;
 void *bytes=env->GetDirectBufferAddress(buffer);jlong capacity=env->GetDirectBufferCapacity(buffer);
 if(!bytes||capacity<(jlong)frames*s->channels*4)return JNI_FALSE;
 return ptp_process(s,(float *)bytes,(unsigned)frames)?JNI_TRUE:JNI_FALSE;
}
extern "C" JNIEXPORT void JNICALL Java_tv_getportico_portico_native_PorticoTruePeakNative_reset(JNIEnv *,jobject,jlong handle){ptp_reset((PorticoTruePeak *)(uintptr_t)handle);}
extern "C" JNIEXPORT void JNICALL Java_tv_getportico_portico_native_PorticoTruePeakNative_destroy(JNIEnv *,jobject,jlong handle){ptp_destroy((PorticoTruePeak *)(uintptr_t)handle);}
