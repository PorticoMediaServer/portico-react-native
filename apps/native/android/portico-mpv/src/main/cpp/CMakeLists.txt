cmake_minimum_required(VERSION 3.22.1)
project(porticompv C)

# The prebuilt libmpv for this architecture (see ../../../build.gradle for where it comes from).
if(NOT EXISTS "${PORTICO_LIBMPV_DIR}/${ANDROID_ABI}/libmpv.so")
  message(FATAL_ERROR "libmpv.so for ${ANDROID_ABI} is missing from ${PORTICO_LIBMPV_DIR}. Run the fetchLibmpv task, or pass -PporticoLibmpvDir.")
endif()
add_library(mpv SHARED IMPORTED)
set_target_properties(mpv PROPERTIES IMPORTED_LOCATION "${PORTICO_LIBMPV_DIR}/${ANDROID_ABI}/libmpv.so")

add_library(porticompv SHARED portico_mpv_jni.c)
set_target_properties(porticompv PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON)
target_include_directories(porticompv PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(porticompv PRIVATE mpv)
