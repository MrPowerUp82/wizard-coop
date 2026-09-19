/* Arcana Survivors: QuickJS + vita2d host. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <png.h>
#include <psp2/ctrl.h>
#include <psp2/power.h>
#include <psp2/kernel/processmgr.h>
#include <psp2/io/stat.h>
#include <vita2d.h>
#include "quickjs.h"

unsigned int _newlib_heap_size_user = 192 * 1024 * 1024;
static int running = 1, texture_count, clip_empty;
static vita2d_texture *textures[128];
static vita2d_font *fonts[3];
static const char *font_names[] = {"inter-400", "cinzel-700", "dejavu-400"};
static const char *save_path = "ux0:data/ArcanaSurvivors/save.json";
static char error_message[2048];
static FILE *log_file;
static char capture_path[160];
#define FN(name) static JSValue name(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
static double number(JSContext *ctx, JSValueConst value) { double n = 0; JS_ToFloat64(ctx, &n, value); return n; }
static uint32_t color(JSContext *ctx, JSValueConst value) { uint32_t n = 0; JS_ToUint32(ctx, &n, value); return n; }
FN(native_now) { return JS_NewFloat64(ctx, sceKernelGetProcessTimeWide() / 1000.0); }
FN(native_exit) { running = 0; return JS_UNDEFINED; }
FN(native_log) {
    const char *s = JS_ToCString(ctx, argv[0]);
    if (s && log_file) { fprintf(log_file, "%s\n", s); fflush(log_file); }
    JS_FreeCString(ctx, s); return JS_UNDEFINED;
}
FN(native_pad) {
    int port = (int)number(ctx, argv[0]);
    if (port < 0 || port > 4) return JS_NULL;
    SceCtrlPortInfo info; memset(&info, 0, sizeof(info));
    int wireless = sceCtrlGetControllerPortInfo(&info) >= 0;
    /* On PSTV port 0 mirrors the first wireless pad. Never count it twice. */
    if (wireless && port == 0 && info.port[1] != SCE_CTRL_TYPE_UNPAIRED) return JS_NULL;
    if (port > 0 && (!wireless || info.port[port] == SCE_CTRL_TYPE_UNPAIRED)) return JS_NULL;
    SceCtrlData pad; memset(&pad, 0, sizeof(pad));
    int ret = port == 0 ? sceCtrlPeekBufferPositive(0, &pad, 1) : sceCtrlPeekBufferPositive2(port, &pad, 1);
    if (ret <= 0) return JS_NULL;
    JSValue obj = JS_NewObject(ctx);
#define PROP(k, v) JS_SetPropertyStr(ctx, obj, k, JS_NewUint32(ctx, v))
    PROP("port", port); PROP("buttons", pad.buttons);
    PROP("lx", pad.lx); PROP("ly", pad.ly); PROP("rx", pad.rx); PROP("ry", pad.ry);
#undef PROP
    return obj;
}
FN(native_clip) {
    int x = fmax(0, floor(number(ctx, argv[0]))), y = fmax(0, floor(number(ctx, argv[1])));
    int r = fmin(960, ceil(number(ctx, argv[2]))), b = fmin(544, ceil(number(ctx, argv[3])));
    clip_empty = r <= x || b <= y;
    if (!clip_empty) { vita2d_set_clip_rectangle(x, y, r, b); vita2d_enable_clipping(); }
    return JS_UNDEFINED;
}
FN(native_blend) { vita2d_set_blend_mode_add(JS_ToBool(ctx, argv[0])); return JS_UNDEFINED; }
FN(native_fill_circle) {
    if (clip_empty) return JS_UNDEFINED;
    float x = number(ctx, argv[0]), y = number(ctx, argv[1]), radius = number(ctx, argv[2]);
    if (radius > 0.0f) vita2d_draw_fill_circle(x, y, radius, color(ctx, argv[3]));
    return JS_UNDEFINED;
}
FN(native_stroke_circle) {
    if (clip_empty) return JS_UNDEFINED;
    float x = number(ctx, argv[0]), y = number(ctx, argv[1]), radius = number(ctx, argv[2]);
    float width = fmaxf(0.5f, number(ctx, argv[3]));
    if (radius <= 0.0f) return JS_UNDEFINED;
    int segments = radius >= 90.0f ? 48 : 32;
    int count = (segments + 1) * 2;
    vita2d_color_vertex *v = vita2d_pool_memalign(count * sizeof(*v), 4);
    if (!v) return JS_ThrowInternalError(ctx, "Frame circle pool exhausted");
    uint32_t c = color(ctx, argv[4]);
    float outer = radius + width * 0.5f, inner = fmaxf(0.0f, radius - width * 0.5f);
    for (int i = 0; i <= segments; i++) {
        float a = 6.2831853071795864769f * (float)i / (float)segments, co = cosf(a), si = sinf(a);
        v[i * 2] = (vita2d_color_vertex){x + co * outer, y + si * outer, .5f, c};
        v[i * 2 + 1] = (vita2d_color_vertex){x + co * inner, y + si * inner, .5f, c};
    }
    vita2d_draw_array(SCE_GXM_PRIMITIVE_TRIANGLE_STRIP, v, count);
    return JS_UNDEFINED;
}
FN(native_rect) {
    if (clip_empty) return JS_UNDEFINED;
    float x = number(ctx, argv[0]), y = number(ctx, argv[1]), w = number(ctx, argv[2]), h = number(ctx, argv[3]);
    if (w > 0.0f && h > 0.0f) vita2d_draw_rectangle(x, y, w, h, color(ctx, argv[4]));
    return JS_UNDEFINED;
}
FN(native_stroke_line) {
    if (clip_empty) return JS_UNDEFINED;
    float x0 = number(ctx, argv[0]), y0 = number(ctx, argv[1]), x1 = number(ctx, argv[2]), y1 = number(ctx, argv[3]);
    float width = fmaxf(0.5f, number(ctx, argv[4]));
    uint32_t c = color(ctx, argv[5]);
    if (width <= 1.25f) { vita2d_draw_line(x0, y0, x1, y1, c); return JS_UNDEFINED; }
    float dx = x1 - x0, dy = y1 - y0, length = sqrtf(dx * dx + dy * dy);
    if (length <= 0.0001f) return JS_UNDEFINED;
    float px = -dy / length * width * 0.5f, py = dx / length * width * 0.5f;
    vita2d_color_vertex *v = vita2d_pool_memalign(4 * sizeof(*v), 4);
    if (!v) return JS_ThrowInternalError(ctx, "Frame line pool exhausted");
    v[0] = (vita2d_color_vertex){x0 + px, y0 + py, .5f, c};
    v[1] = (vita2d_color_vertex){x0 - px, y0 - py, .5f, c};
    v[2] = (vita2d_color_vertex){x1 + px, y1 + py, .5f, c};
    v[3] = (vita2d_color_vertex){x1 - px, y1 - py, .5f, c};
    vita2d_draw_array(SCE_GXM_PRIMITIVE_TRIANGLE_STRIP, v, 4);
    return JS_UNDEFINED;
}
FN(native_triangles) {
    if (clip_empty) return JS_UNDEFINED;
    size_t bytes, color_bytes;
    float *p = (float *)JS_GetArrayBuffer(ctx, &bytes, argv[0]);
    uint32_t *c = (uint32_t *)JS_GetArrayBuffer(ctx, &color_bytes, argv[1]);
    size_t available = bytes / (3 * sizeof(float));
    size_t count = argc > 2 ? (size_t)number(ctx, argv[2]) : available;
    if (!p || !c || count > available || color_bytes < count * sizeof(uint32_t)) return JS_ThrowTypeError(ctx, "Invalid triangle buffers");
    if (count > 65532) return JS_ThrowRangeError(ctx, "Too many vertices");
    vita2d_color_vertex *v = vita2d_pool_memalign(count * sizeof(*v), 4);
    if (!v) return JS_ThrowInternalError(ctx, "Frame geometry pool exhausted");
    for (size_t i = 0; i < count; i++) v[i] = (vita2d_color_vertex){p[i * 3], p[i * 3 + 1], .5f, c[i]};
    vita2d_draw_array(SCE_GXM_PRIMITIVE_TRIANGLES, v, count); return JS_UNDEFINED;
}
FN(native_load_texture) {
    if (texture_count >= 128) return JS_ThrowRangeError(ctx, "Texture limit reached");
    const char *path = JS_ToCString(ctx, argv[0]); if (!path) return JS_EXCEPTION;
    vita2d_texture *texture = vita2d_load_PNG_file(path);
    if (!texture) { JSValue err = JS_ThrowInternalError(ctx, "Cannot load texture: %s", path); JS_FreeCString(ctx, path); return err; }
    JS_FreeCString(ctx, path);
    vita2d_texture_set_filters(texture, SCE_GXM_TEXTURE_FILTER_LINEAR, SCE_GXM_TEXTURE_FILTER_LINEAR);
    int id = texture_count++; textures[id] = texture;
    JSValue result = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, result, 0, JS_NewInt32(ctx, id));
    JS_SetPropertyUint32(ctx, result, 1, JS_NewInt32(ctx, vita2d_texture_get_width(texture)));
    JS_SetPropertyUint32(ctx, result, 2, JS_NewInt32(ctx, vita2d_texture_get_height(texture)));
    return result;
}
FN(native_image) {
    if (clip_empty) return JS_UNDEFINED;
    int id = (int)number(ctx, argv[0]); size_t bytes;
    float *p = (float *)JS_GetArrayBuffer(ctx, &bytes, argv[1]);
    if (id < 0 || id >= texture_count || !p || bytes != 8 * sizeof(float)) return JS_ThrowTypeError(ctx, "Invalid image");
    float tw = vita2d_texture_get_width(textures[id]), th = vita2d_texture_get_height(textures[id]);
    float sx = number(ctx, argv[2]) / tw, sy = number(ctx, argv[3]) / th;
    float sw = number(ctx, argv[4]) / tw, sh = number(ctx, argv[5]) / th;
    vita2d_texture_vertex *v = vita2d_pool_memalign(4 * sizeof(*v), 4);
    if (!v) return JS_ThrowInternalError(ctx, "Frame texture pool exhausted");
    for (int i = 0; i < 4; i++) v[i] = (vita2d_texture_vertex){p[i * 2], p[i * 2 + 1], .5f, sx + (i % 2) * sw, sy + (i / 2) * sh};
    vita2d_draw_array_textured(textures[id], SCE_GXM_PRIMITIVE_TRIANGLE_STRIP, v, 4, color(ctx, argv[6]));
    return JS_UNDEFINED;
}
static vita2d_font *get_font(JSContext *ctx, JSValueConst name, int size) {
    const char *s = JS_ToCString(ctx, name); if (!s) return NULL;
    int face = 0; for (int i = 0; i < 3; i++) if (!strcmp(s, font_names[i])) face = i;
    JS_FreeCString(ctx, s); if (size < 8 || size > 48) return NULL;
    /* vita2d_font is size-independent: loading one TTF per pixel size wasted several MB and
       caused avoidable stalls as new HUD/font sizes appeared during a run. */
    if (!fonts[face]) {
        char path[128]; snprintf(path, sizeof(path), "app0:/assets/fonts/%s.ttf", font_names[face]);
        fonts[face] = vita2d_load_font_file(path);
    }
    return fonts[face];
}
FN(native_text) {
    int size = number(ctx, argv[1]); vita2d_font *font = get_font(ctx, argv[0], size);
    if (!font) return JS_ThrowInternalError(ctx, "Cannot load font");
    const char *text = JS_ToCString(ctx, argv[2]); if (!text) return JS_EXCEPTION;
    if (!clip_empty) vita2d_font_draw_text(font, number(ctx, argv[3]), number(ctx, argv[4]), color(ctx, argv[5]), size, text);
    JS_FreeCString(ctx, text); return JS_UNDEFINED;
}
FN(native_measure) {
    int size = number(ctx, argv[1]); vita2d_font *font = get_font(ctx, argv[0], size);
    if (!font) return JS_ThrowInternalError(ctx, "Cannot measure font");
    const char *text = JS_ToCString(ctx, argv[2]); if (!text) return JS_EXCEPTION;
    int width = vita2d_font_text_width(font, size, text); JS_FreeCString(ctx, text); return JS_NewInt32(ctx, width);
}
static char *read_file(const char *path, size_t *length) {
    FILE *f = fopen(path, "rb"); if (!f) return NULL;
    fseek(f, 0, SEEK_END); long size = ftell(f); rewind(f);
    if (size < 0 || size > 16 * 1024 * 1024) { fclose(f); return NULL; }
    char *data = malloc(size + 1); if (!data) { fclose(f); return NULL; }
    *length = fread(data, 1, size, f); fclose(f);
    if (*length != (size_t)size) { free(data); return NULL; }
    data[size] = 0; return data;
}
FN(native_read_save) {
    size_t length; char *data = read_file(save_path, &length); if (!data) return JS_NULL;
    JSValue result = JS_NewStringLen(ctx, data, length); free(data); return result;
}
FN(native_read_file) {
    const char *path = JS_ToCString(ctx, argv[0]); if (!path) return JS_EXCEPTION;
    size_t length; char *data = read_file(path, &length); JS_FreeCString(ctx, path);
    if (!data) return JS_NULL;
    JSValue result = JS_NewStringLen(ctx, data, length); free(data); return result;
}
FN(native_capture) {
    int index = (int)number(ctx, argv[0]);
    snprintf(capture_path, sizeof(capture_path), "ux0:data/ArcanaSurvivors/capture-%d.png", index);
    return JS_UNDEFINED;
}
static void capture_frame(void) {
    if (!capture_path[0]) return;
    vita2d_wait_rendering_done();
    FILE *file = fopen(capture_path, "wb");
    if (file) {
        png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
        png_infop info = png ? png_create_info_struct(png) : NULL;
        if (png && info && !setjmp(png_jmpbuf(png))) {
            png_init_io(png, file);
            png_set_IHDR(png, info, 960, 544, 8, PNG_COLOR_TYPE_RGBA, PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
            png_write_info(png, info);
            unsigned char *fb = vita2d_get_current_fb();
            for (int y = 0; y < 544; y++) png_write_row(png, fb + y * 1024 * 4);
            png_write_end(png, info);
        }
        if (png) png_destroy_write_struct(&png, info ? &info : NULL);
        fclose(file);
    }
    capture_path[0] = 0;
}
FN(native_write_save) {
    size_t length; const char *data = JS_ToCStringLen(ctx, &length, argv[0]); if (!data) return JS_EXCEPTION;
    const char *tmp = "ux0:data/ArcanaSurvivors/save.tmp";
    FILE *f = fopen(tmp, "wb"); int ok = 0;
    if (f) { ok = fwrite(data, 1, length, f) == length; if (fclose(f)) ok = 0; }
    JS_FreeCString(ctx, data);
    if (!ok || rename(tmp, save_path)) return JS_ThrowInternalError(ctx, "Failed to save progress");
    return JS_UNDEFINED;
}
static const JSCFunctionListEntry api[] = {
    JS_CFUNC_DEF("now", 0, native_now), JS_CFUNC_DEF("exit", 0, native_exit),
    JS_CFUNC_DEF("log", 1, native_log), JS_CFUNC_DEF("pad", 1, native_pad),
    JS_CFUNC_DEF("clip", 4, native_clip), JS_CFUNC_DEF("blend", 1, native_blend),
    JS_CFUNC_DEF("fillCircle", 4, native_fill_circle), JS_CFUNC_DEF("strokeCircle", 5, native_stroke_circle),
    JS_CFUNC_DEF("rect", 5, native_rect), JS_CFUNC_DEF("strokeLine", 6, native_stroke_line),
    JS_CFUNC_DEF("triangles", 3, native_triangles), JS_CFUNC_DEF("loadTexture", 1, native_load_texture),
    JS_CFUNC_DEF("image", 7, native_image), JS_CFUNC_DEF("text", 6, native_text),
    JS_CFUNC_DEF("measure", 3, native_measure), JS_CFUNC_DEF("readSave", 0, native_read_save),
    JS_CFUNC_DEF("writeSave", 1, native_write_save)
    , JS_CFUNC_DEF("readFile", 1, native_read_file), JS_CFUNC_DEF("capture", 1, native_capture)
};
static void capture_error(JSContext *ctx) {
    JSValue e = JS_GetException(ctx), stack = JS_GetPropertyStr(ctx, e, "stack");
    const char *message = JS_ToCString(ctx, e), *trace = JS_ToCString(ctx, stack);
    snprintf(error_message, sizeof(error_message), "%s\n%s", message ? message : "JavaScript error", trace ? trace : "");
    if (log_file) { fprintf(log_file, "%s\n", error_message); fflush(log_file); }
    JS_FreeCString(ctx, message); JS_FreeCString(ctx, trace); JS_FreeValue(ctx, stack); JS_FreeValue(ctx, e);
}
static void rejected(JSContext *ctx, JSValueConst promise, JSValueConst reason, JS_BOOL handled, void *opaque) {
    if (!handled) { JS_Throw(ctx, JS_DupValue(ctx, reason)); capture_error(ctx); }
}
int main(void) {
    sceIoMkdir("ux0:data/ArcanaSurvivors", 0777);
    log_file = fopen("ux0:data/ArcanaSurvivors/runtime.log", "w");
    sceCtrlSetSamplingMode(SCE_CTRL_MODE_ANALOG); sceCtrlSetSamplingModeExt(SCE_CTRL_MODE_ANALOG);
    /* Use the Vita's standard maximum performance clocks for this homebrew. The old runtime only
       raised the ARM clock, leaving the renderer and memory bus at lower defaults. */
    scePowerSetArmClockFrequency(444);
    scePowerSetBusClockFrequency(222);
    scePowerSetGpuClockFrequency(222);
    scePowerSetGpuXbarClockFrequency(166);
    if (vita2d_init_advanced(4 * 1024 * 1024) < 0) return 1;
    vita2d_set_vblank_wait(1); vita2d_set_clear_color(RGBA8(7, 17, 23, 255));
    JSRuntime *rt = JS_NewRuntime();
    JS_SetHostPromiseRejectionTracker(rt, rejected, NULL);
    JS_SetMemoryLimit(rt, 128 * 1024 * 1024); JS_SetMaxStackSize(rt, 1024 * 1024);
    JSContext *ctx = JS_NewContext(rt);
    JSValue global = JS_GetGlobalObject(ctx), bridge = JS_NewObject(ctx);
    JS_SetPropertyFunctionList(ctx, bridge, api, sizeof(api) / sizeof(api[0]));
    JS_SetPropertyStr(ctx, global, "ArcanaNative", bridge);
    size_t length; char *source = read_file("app0:/assets/main.js", &length);
    vita2d_start_drawing(); vita2d_clear_screen();
    if (!source) snprintf(error_message, sizeof(error_message), "Missing app0:/assets/main.js");
    else {
        JSValue result = JS_Eval(ctx, source, length, "app0:/assets/main.js", JS_EVAL_TYPE_MODULE);
        if (JS_IsException(result)) capture_error(ctx);
        JS_FreeValue(ctx, result); free(source);
    }
    vita2d_end_drawing(); vita2d_swap_buffers();
    while (running && !error_message[0]) {
        JSContext *job_ctx; int pending;
        while ((pending = JS_ExecutePendingJob(rt, &job_ctx)) > 0) {}
        if (pending < 0) { capture_error(job_ctx); break; }
        JSValue frame = JS_GetPropertyStr(ctx, global, "__arcanaFrame");
        if (!JS_IsFunction(ctx, frame)) { JS_FreeValue(ctx, frame); snprintf(error_message, sizeof(error_message), "Game did not register a frame callback"); break; }
        JSValue now = JS_NewFloat64(ctx, sceKernelGetProcessTimeWide() / 1000.0);
        vita2d_start_drawing(); vita2d_disable_clipping(); vita2d_clear_screen();
        JSValue result = JS_Call(ctx, frame, JS_UNDEFINED, 1, &now);
        if (JS_IsException(result)) capture_error(ctx);
        vita2d_end_drawing(); capture_frame(); vita2d_swap_buffers();
        JS_FreeValue(ctx, result); JS_FreeValue(ctx, frame); JS_FreeValue(ctx, now);
    }
    if (error_message[0]) {
        if (log_file) { fprintf(log_file, "%s\n", error_message); fflush(log_file); }
        vita2d_pgf *font = vita2d_load_default_pgf();
        do {
            vita2d_start_drawing(); vita2d_disable_clipping(); vita2d_set_blend_mode_add(0); vita2d_clear_screen();
            if (font) {
                vita2d_pgf_draw_text(font, 30, 55, RGBA8(255, 100, 100, 255), 1.0f, "Arcana: erro ao executar o jogo");
                vita2d_pgf_draw_text(font, 30, 95, 0xffffffff, .7f, error_message);
                vita2d_pgf_draw_text(font, 30, 500, 0xffffffff, .8f, "Log: ux0:data/ArcanaSurvivors/runtime.log | START: sair");
            }
            vita2d_end_drawing(); vita2d_swap_buffers();
            SceCtrlData pad; sceCtrlPeekBufferPositive(0, &pad, 1); if (pad.buttons & SCE_CTRL_START) break;
        } while (1);
        if (font) vita2d_free_pgf(font);
    }
    JSValue shutdown = JS_GetPropertyStr(ctx, global, "__arcanaShutdown");
    if (JS_IsFunction(ctx, shutdown)) { JSValue result = JS_Call(ctx, shutdown, JS_UNDEFINED, 0, NULL); JS_FreeValue(ctx, result); }
    JS_FreeValue(ctx, shutdown); JS_FreeValue(ctx, global); JS_FreeContext(ctx); JS_FreeRuntime(rt);
    vita2d_wait_rendering_done();
    for (int i = 0; i < texture_count; i++) vita2d_free_texture(textures[i]);
    for (int f = 0; f < 3; f++) if (fonts[f]) vita2d_free_font(fonts[f]);
    vita2d_fini(); if (log_file) fclose(log_file); sceKernelExitProcess(0); return 0;
}
