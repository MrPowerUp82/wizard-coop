cmake_minimum_required(VERSION 3.10)

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
  if(DEFINED ENV{VITASDK})
    set(CMAKE_TOOLCHAIN_FILE "$ENV{VITASDK}/share/vita.toolchain.cmake" CACHE PATH "toolchain file")
  else()
    message(FATAL_ERROR "Please define VITASDK to use this toolchain")
  endif()
endif()

project(ArcanaSurvivors)
include("${VITASDK}/share/vita.cmake" REQUIRED)

set(VITA_APP_NAME "Arcana Survivors")
set(VITA_TITLEID  "ARCS00001")
set(VITA_VERSION  "01.00")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wl,-q -Wall -O3 -fno-short-enums")

add_executable(ArcanaSurvivors
  src/main.c
)

target_link_libraries(ArcanaSurvivors
  vita2d
  SceDisplay_stub
  SceGxm_stub
  SceCtrl_stub
  SceTouch_stub
  SceAudio_stub
  ScePower_stub
  SceRtc_stub
  SceSysmodule_stub
  m
  c
)

vita_create_self(eboot.bin ArcanaSurvivors UNSAFE)

vita_create_vpk(ArcanaSurvivors.vpk ${VITA_TITLEID} eboot.bin
  VERSION ${VITA_VERSION}
  NAME ${VITA_APP_NAME}
  FILE ../sce_sys/icon0.png sce_sys/icon0.png
  FILE ../sce_sys/livearea/contents/bg.png sce_sys/livearea/contents/bg.png
  FILE ../sce_sys/livearea/contents/startup.png sce_sys/livearea/contents/startup.png
  FILE ../sce_sys/livearea/contents/template.xml sce_sys/livearea/contents/template.xml
)
