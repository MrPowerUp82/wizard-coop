# Arcana Survivors - PlayStation Vita Makefile (VitaSDK)
TITLE_ID = ARCS00001
TARGET   = ArcanaSurvivors

OBJS     = src/main.o

LIBS     = -lvita2d \
           -lSceDisplay_stub \
           -lSceGxm_stub \
           -lSceCtrl_stub \
           -lSceTouch_stub \
           -lSceAudio_stub \
           -lScePower_stub \
           -lSceRtc_stub \
           -lSceAppMgr_stub \
           -lSceCommonDialog_stub \
           -lSceSysmodule_stub \
           -lm \
           -lc

PREFIX   = arm-vita-eabi
CC       = $(PREFIX)-gcc
CFLAGS   = -Wl,-q -Wall -O3 -fno-short-enums
ASFLAGS  = $(CFLAGS)

all: $(TARGET).vpk

$(TARGET).vpk: eboot.bin ../sce_sys/param.sfo
	vita-mksfoex -s TITLE_ID=$(TITLE_ID) "Arcana Survivors" param.sfo
	vita-pack-vpk -s param.sfo -b eboot.bin \
		--add ../sce_sys/icon0.png=sce_sys/icon0.png \
		--add ../sce_sys/livearea/contents/bg.png=sce_sys/livearea/contents/bg.png \
		--add ../sce_sys/livearea/contents/startup.png=sce_sys/livearea/contents/startup.png \
		--add ../sce_sys/livearea/contents/template.xml=sce_sys/livearea/contents/template.xml \
		--add ../build/assets=assets \
		$(TARGET).vpk

eboot.bin: $(TARGET).velf
	vita-make-fself -c $< $@

%.velf: %.elf
	vita-elf-create $< $@

$(TARGET).elf: $(OBJS)
	$(CC) $(CFLAGS) $^ $(LIBS) -o $@

clean:
	rm -f $(TARGET).vpk $(TARGET).velf $(TARGET).elf $(TARGET).sfo eboot.bin $(OBJS) param.sfo
