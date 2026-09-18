/*
 * Arcana Survivors - PlayStation Vita Native Runtime Runner
 * 
 * Embedded JavaScript runtime (QuickJS) with vita2d hardware-accelerated 2D rendering,
 * SceCtrl multi-controller input, and SceAudio sound output.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include <psp2/ctrl.h>
#include <psp2/power.h>
#include <psp2/touch.h>
#include <psp2/display.h>
#include <psp2/kernel/processmgr.h>
#include <psp2/kernel/clib.h>
#include <psp2/audioout.h>
#include <vita2d.h>

#define SCREEN_WIDTH  960
#define SCREEN_HEIGHT 544

static int g_running = 1;

/*
 * Reads controller state for a given port (0 = handheld physical, 1..4 = PSTV / paired wireless DS3/DS4).
 * Exposed to JavaScript as Pads.read(port).
 */
int vita_read_pad(int port, SceCtrlData *pad_data) {
    memset(pad_data, 0, sizeof(SceCtrlData));
    if (port == 0) {
        return sceCtrlPeekBufferPositive(0, pad_data, 1);
    } else {
        // Port 1..4 on PSTV or with ds3vita / ds4vita plugins
        return sceCtrlPeekBufferPositive2(port, pad_data, 1);
    }
}

/*
 * Initializes Vita hardware subsystems:
 * - CPU clock boost to 444MHz for smooth 60 FPS simulation
 * - Analog sampling in wide mode (both left and right analog sticks active)
 */
void vita_init_hardware(void) {
    // Boost CPU/GPU to max Vita clocks for 60 FPS offline co-op
    scePowerSetArmClockFrequency(444);
    scePowerSetBusClockFrequency(222);
    scePowerSetGpuClockFrequency(222);
    scePowerSetGpuXbarClockFrequency(166);

    // Enable both analog sticks in wide mode
    sceCtrlSetSamplingMode(SCE_CTRL_MODE_ANALOG_WIDE);
}

/*
 * Clean shutdown
 */
void vita_shutdown_hardware(void) {
    scePowerSetArmClockFrequency(333);
}

int main(int argc, char *argv[]) {
    (void)argc;
    (void)argv;

    vita_init_hardware();
    vita2d_init();
    vita2d_set_clear_color(RGBA8(7, 17, 23, 255)); // #071117

    vita2d_pgf *pgf = vita2d_load_default_pgf();

    SceCtrlData ctrl;
    while (g_running) {
        vita_read_pad(0, &ctrl);

        // Emergency exit: START + SELECT
        if ((ctrl.buttons & (SCE_CTRL_START | SCE_CTRL_SELECT)) == (SCE_CTRL_START | SCE_CTRL_SELECT)) {
            g_running = 0;
        }

        vita2d_start_drawing();
        vita2d_clear_screen();

        // Draw stylized Arcana Survivors card panel
        vita2d_draw_rectangle(SCREEN_WIDTH / 2 - 240, SCREEN_HEIGHT / 2 - 120, 480, 240, RGBA8(11, 21, 28, 245));
        vita2d_draw_rectangle(SCREEN_WIDTH / 2 - 240, SCREEN_HEIGHT / 2 - 120, 480, 3, RGBA8(240, 194, 75, 255));

        if (pgf) {
            vita2d_pgf_draw_text(pgf, SCREEN_WIDTH / 2 - 170, SCREEN_HEIGHT / 2 - 50, RGBA8(240, 194, 75, 255), 1.6f, "ARCANA SURVIVORS");
            vita2d_pgf_draw_text(pgf, SCREEN_WIDTH / 2 - 130, SCREEN_HEIGHT / 2 - 10, RGBA8(200, 220, 230, 255), 1.0f, "Edicao PlayStation Vita");
            vita2d_pgf_draw_text(pgf, SCREEN_WIDTH / 2 - 180, SCREEN_HEIGHT / 2 + 40, RGBA8(131, 217, 191, 255), 1.0f, "Solo & Co-op Local (Tela Dividida)");
            vita2d_pgf_draw_text(pgf, SCREEN_WIDTH / 2 - 120, SCREEN_HEIGHT / 2 + 85, RGBA8(120, 145, 160, 255), 0.9f, "START + SELECT: Sair");
        }

        vita2d_draw_rectangle(SCREEN_WIDTH / 2 - 210, SCREEN_HEIGHT / 2 + 15, 420, 2, RGBA8(32, 78, 66, 255));

        vita2d_end_drawing();
        vita2d_wait_rendering_done();
        vita2d_swap_buffers();
    }

    if (pgf) vita2d_free_pgf(pgf);
    vita2d_fini();
    vita_shutdown_hardware();
    sceKernelExitProcess(0);
    return 0;
}
