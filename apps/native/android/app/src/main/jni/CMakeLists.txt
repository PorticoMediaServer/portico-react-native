cmake_minimum_required(VERSION 3.22.1)
project(appmodules)
# Preserve React Native's actual application/codegen setup; add only the owned output DSP.
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
add_library(portico_audio_dsp SHARED PorticoAudioDsp.cpp)
target_include_directories(portico_audio_dsp PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../Native)
target_link_libraries(portico_audio_dsp android log m)
