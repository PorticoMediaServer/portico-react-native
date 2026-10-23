#include <jni.h>
#include <android/bitmap.h>
#include <ass/ass.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/avutil.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>

/* All inputs are bounded local cache files. JNI never opens a network URL. */
typedef struct {
    ASS_Library *library;
    ASS_Renderer *renderer;
    ASS_Track *ass;
    AVFormatContext *format;
    AVCodecContext *decoder;
    int stream;
    AVSubtitle shown, next;
    int has_shown, has_next, eof;
    int64_t shown_start, shown_end, next_start, next_end, previous;
} Overlay;

static void release(Overlay *o) {
    if (!o) return;
    if (o->has_shown) avsubtitle_free(&o->shown);
    if (o->has_next) avsubtitle_free(&o->next);
    avcodec_free_context(&o->decoder); avformat_close_input(&o->format);
    if (o->ass) ass_free_track(o->ass);
    if (o->renderer) ass_renderer_done(o->renderer);
    if (o->library) ass_library_done(o->library);
    free(o);
}
static void add_font(ASS_Library *library, const char *path) {
    FILE *f = fopen(path,"rb"); if (!f) return;
    if (fseek(f,0,SEEK_END)) { fclose(f); return; }
    long size = ftell(f); rewind(f);
    if (size <= 0 || size > 32*1024*1024) { fclose(f); return; }
    char *data = malloc((size_t)size);
    if (data && fread(data,1,(size_t)size,f) == (size_t)size) {
        const char *name = strrchr(path,'/'); ass_add_font(library,name ? name+1 : path,data,(int)size);
    }
    free(data); fclose(f);
}
#define JNI(ret,name) JNIEXPORT ret JNICALL Java_tv_getportico_portico_native_PorticoSubtitleNative_##name
JNI(jlong,create)(JNIEnv *env,jclass cls,jstring kind,jstring file,jobjectArray fonts) {
    (void)cls;
    const char *k = (*env)->GetStringUTFChars(env,kind,NULL);
    const char *path = (*env)->GetStringUTFChars(env,file,NULL);
    Overlay *o = calloc(1,sizeof(*o));
    if (!o) goto done;
    o->previous = -1;
    if (!strcmp(k,"ass")) {
        o->library = ass_library_init(); if (!o->library) goto fail;
        if (fonts) for(jsize i=0;i<(*env)->GetArrayLength(env,fonts) && i<64;i++) {
            jstring font = (*env)->GetObjectArrayElement(env,fonts,i);
            const char *p = (*env)->GetStringUTFChars(env,font,NULL); add_font(o->library,p);
            (*env)->ReleaseStringUTFChars(env,font,p); (*env)->DeleteLocalRef(env,font);
        }
        o->renderer = ass_renderer_init(o->library); if (!o->renderer) goto fail;
        ass_set_fonts(o->renderer,"/system/fonts/Roboto-Regular.ttf","sans-serif",ASS_FONTPROVIDER_NONE,NULL,1);
        ass_set_use_margins(o->renderer,0);
        o->ass = ass_read_file(o->library,(char *)path,NULL); if (!o->ass) goto fail;
    } else {
        AVDictionary *options = NULL;
        av_dict_set(&options,"protocol_whitelist","file",0);
        av_dict_set(&options,"max_alloc","67108864",0);
        int result = avformat_open_input(&o->format,path,NULL,&options); av_dict_free(&options);
        if(result < 0 || avformat_find_stream_info(o->format,NULL) < 0) goto fail;
        o->stream = av_find_best_stream(o->format,AVMEDIA_TYPE_SUBTITLE,-1,-1,NULL,0); if(o->stream < 0) goto fail;
        AVCodecParameters *par = o->format->streams[o->stream]->codecpar;
        enum AVCodecID expected = !strcmp(k,"pgs") ? AV_CODEC_ID_HDMV_PGS_SUBTITLE : !strcmp(k,"vobsub") ? AV_CODEC_ID_DVD_SUBTITLE : !strcmp(k,"dvb") ? AV_CODEC_ID_DVB_SUBTITLE : AV_CODEC_ID_NONE;
        if(par->codec_id != expected || expected == AV_CODEC_ID_NONE) goto fail;
        const AVCodec *codec = avcodec_find_decoder(par->codec_id); if(!codec) goto fail;
        o->decoder = avcodec_alloc_context3(codec);
        if(o->decoder) o->decoder->max_pixels=4096LL*4096;
        if(!o->decoder || avcodec_parameters_to_context(o->decoder,par) < 0 || avcodec_open2(o->decoder,codec,NULL) < 0) goto fail;
    }
    goto done;
fail:
    release(o); o = NULL;
done:
    (*env)->ReleaseStringUTFChars(env,kind,k); (*env)->ReleaseStringUTFChars(env,file,path);
    return (jlong)(intptr_t)o;
}
static void next_cue(Overlay *o) {
    AVPacket *packet = av_packet_alloc(); if(!packet) { o->eof=1; return; }
    int count=0;
    while(count++ < 65536 && av_read_frame(o->format,packet) >= 0) {
        if(packet->stream_index == o->stream) {
            AVSubtitle sub = {0}; int got=0;
            int decoded = avcodec_decode_subtitle2(o->decoder,&sub,&got,packet);
            if(decoded >= 0 && got) {
                int64_t pts = sub.pts;
                if(pts == AV_NOPTS_VALUE && packet->pts != AV_NOPTS_VALUE) pts = av_rescale_q(packet->pts,o->format->streams[o->stream]->time_base,AV_TIME_BASE_Q);
                if(pts != AV_NOPTS_VALUE) {
                    o->next=sub; o->has_next=1; o->next_start=pts + sub.start_display_time*1000LL;
                    o->next_end=sub.end_display_time == UINT32_MAX ? INT64_MAX : pts + sub.end_display_time*1000LL;
                    av_packet_free(&packet); return;
                }
                avsubtitle_free(&sub);
            }
        }
        av_packet_unref(packet);
    }
    o->eof=1; av_packet_free(&packet);
}
static void advance(Overlay *o,int64_t time) {
    if(o->previous >= 0 && time < o->previous) {
        if(o->has_shown) avsubtitle_free(&o->shown);
        if(o->has_next) avsubtitle_free(&o->next);
        o->has_shown=o->has_next=o->eof=0;
        av_seek_frame(o->format,o->stream,0,AVSEEK_FLAG_BACKWARD); avcodec_flush_buffers(o->decoder);
    }
    o->previous=time;
    if(!o->has_next && !o->eof) next_cue(o);
    while(o->has_next && o->next_start <= time) {
        if(o->has_shown) avsubtitle_free(&o->shown);
        o->shown=o->next; memset(&o->next,0,sizeof(o->next)); o->has_shown=1; o->has_next=0;
        o->shown_start=o->next_start; o->shown_end=o->next_end;
        if(!o->eof) next_cue(o);
        // A following composition, including an empty clear, terminates an open-ended cue.
        if(o->has_next && o->next_start < o->shown_end) o->shown_end=o->next_start;
    }
}
static void blend(uint8_t *p,int r,int g,int b,int a) {
    int keep=255-a;
    p[0]=(uint8_t)((r*a+p[0]*keep+127)/255); p[1]=(uint8_t)((g*a+p[1]*keep+127)/255);
    p[2]=(uint8_t)((b*a+p[2]*keep+127)/255); p[3]=(uint8_t)(a+(p[3]*keep+127)/255);
}
JNI(jboolean,render)(JNIEnv *env,jclass cls,jlong handle,jlong time,jobject bitmap,jint source_width,jint source_height) {
    (void)cls; Overlay *o=(Overlay *)(intptr_t)handle; if(!o) return JNI_FALSE;
    AndroidBitmapInfo info; void *pixels;
    if(AndroidBitmap_getInfo(env,bitmap,&info) || info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || info.width > 4096 || info.height > 4096 || AndroidBitmap_lockPixels(env,bitmap,&pixels)) return JNI_FALSE;
    memset(pixels,0,info.stride*info.height);
    if(o->ass) {
        ass_set_frame_size(o->renderer,(int)info.width,(int)info.height);
        ass_set_storage_size(o->renderer,source_width,source_height);
        int changed=0;
        for(ASS_Image *im=ass_render_frame(o->renderer,o->ass,time/1000,&changed);im;im=im->next) {
            int r=im->color>>24,g=(im->color>>16)&255,b=(im->color>>8)&255,opacity=255-(im->color&255);
            for(int y=0;y<im->h;y++) for(int x=0;x<im->w;x++) {
                int px=im->dst_x+x,py=im->dst_y+y;
                if(px<0 || py<0 || px>=(int)info.width || py>=(int)info.height) continue;
                int a=(im->bitmap[y*im->stride+x]*opacity+127)/255;
                blend((uint8_t *)pixels+py*info.stride+px*4,r,g,b,a);
            }
        }
    } else {
        advance(o,time);
        int width=o->decoder->width,height=o->decoder->height;
        if(o->has_shown && time>=o->shown_start && time<o->shown_end && width>0 && height>0) {
            for(unsigned n=0;n<o->shown.num_rects;n++) {
                AVSubtitleRect *rect=o->shown.rects[n];
                if(rect->type != SUBTITLE_BITMAP || !rect->data[0] || !rect->data[1]) continue;
                const uint32_t *palette=(const uint32_t *)rect->data[1];
                int left=rect->x*(int)info.width/width,top=rect->y*(int)info.height/height;
                int right=(rect->x+rect->w)*(int)info.width/width,bottom=(rect->y+rect->h)*(int)info.height/height;
                for(int y=top;y<bottom;y++) for(int x=left;x<right;x++) {
                    if(x<0 || y<0 || x>=(int)info.width || y>=(int)info.height) continue;
                    int sx=(x-left)*rect->w/(right-left),sy=(y-top)*rect->h/(bottom-top);
                    unsigned index=rect->data[0][sy*rect->linesize[0]+sx]; if(index>=(unsigned)rect->nb_colors) continue;
                    uint32_t color=palette[index];
                    blend((uint8_t *)pixels+y*info.stride+x*4,(color>>16)&255,(color>>8)&255,color&255,color>>24);
                }
            }
        }
    }
    AndroidBitmap_unlockPixels(env,bitmap); return JNI_TRUE;
}
JNI(void,destroy)(JNIEnv *env,jclass cls,jlong handle) { (void)env; (void)cls; release((Overlay *)(intptr_t)handle); }

JNI(void,style)(JNIEnv *env,jclass cls,jlong handle,jboolean keep,jstring family,jint color,jint position,jdouble scale) {
    (void)cls; Overlay *o=(Overlay *)(intptr_t)handle; if(!o || !o->ass) return;
    ass_set_selective_style_override_enabled(o->renderer,keep ? ASS_OVERRIDE_DEFAULT : ASS_OVERRIDE_FULL_STYLE | ASS_OVERRIDE_BIT_FONT_SIZE_FIELDS | ASS_OVERRIDE_BIT_BORDER);
    ass_set_font_scale(o->renderer,keep ? 1.0 : scale);
    if(!keep) {
        const char *font=(*env)->GetStringUTFChars(env,family,NULL);
        ASS_Style value={0};value.FontName=(char *)font;value.FontSize=o->ass->PlayResY*0.065;
        value.PrimaryColour=((uint32_t)color<<8) | (255-((uint32_t)color>>24));
        value.OutlineColour=0;value.BackColour=0x00000080;value.BorderStyle=1;value.Outline=2;value.ScaleX=value.ScaleY=1;
        value.Alignment=position==2 ? 8 : 2;value.MarginV=position==1 ? o->ass->PlayResY/6 : o->ass->PlayResY/20;
        ass_set_selective_style_override(o->renderer,&value);
        (*env)->ReleaseStringUTFChars(env,family,font);
    }
}
