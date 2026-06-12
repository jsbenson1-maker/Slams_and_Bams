cmake_minimum_required(VERSION 3.22)

project(PhyzixPlugin VERSION 1.4.2 LANGUAGES C CXX)

# Link MSVC Runtime statically to prevent missing DLL issues (VCRUNTIME140.dll, MSVCP140.dll) on client machines
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Add JUCE to the build
if(NOT JUCE_PATH)
    set(JUCE_PATH "C:/Users/Administrator/Downloads/juce-8.0.13-windows/JUCE" CACHE PATH "Path to JUCE source")
endif()
add_subdirectory("${JUCE_PATH}" juce_build)

# Create the plugin target
juce_add_plugin(PhyzixSnB
    COMPANY_NAME "Phyzix"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    FORMATS Standalone VST3 # Support Standalone and VST3 format natively
)

juce_generate_juce_header(PhyzixSnB)

target_sources(PhyzixSnB PRIVATE
    PhyzixPluginWrapper.cpp
)

target_link_libraries(PhyzixSnB PRIVATE
    juce_audio_plugin_client
    juce_audio_utils
    juce_audio_processors
    juce_gui_extra
    juce_gui_basics
    juce_audio_devices
    juce_audio_formats
    juce_audio_basics
    juce_core
)

# Enable C++17
target_compile_features(PhyzixSnB PRIVATE cxx_std_17)

# Bypass VST2 replacement warning #error
target_compile_definitions(PhyzixSnB PRIVATE 
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_VST3=1
)


