@echo off
echo =========================================================
echo Starting Native VST3 / Standalone Compilation Pipeline...
echo =========================================================

REM 1. Load MSVC Environment Variables
echo Loading MSVC Visual Studio 2022 C++ Build Tools (64-bit)...
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
if %errorlevel% neq 0 (
    echo ERROR: Failed to load vcvars64.bat! Please check Visual Studio installation.
    exit /b %errorlevel%
)

REM 2. Create and Navigate to Build Directory
set BUILD_DIR=%~dp0build
echo Build directory: %BUILD_DIR%

REM 3. Configure CMake Project
echo Configuring CMake build files for JUCE plugin...
"C:\Program Files\CMake\bin\cmake.exe" -B "%BUILD_DIR%" -S "%~dp0."
if %errorlevel% neq 0 (
    echo ERROR: CMake configuration failed!
    exit /b %errorlevel%
)

REM 4. Build Plugin Target (Release Mode)
echo Compiling VST3 / Standalone Plugin binary targets in Release Mode...
"C:\Program Files\CMake\bin\cmake.exe" --build "%BUILD_DIR%" --config Release
if %errorlevel% neq 0 (
    echo ERROR: Compilation failed!
    exit /b %errorlevel%
)

echo =========================================================
echo SUCCESS: VST3 / Standalone compiled successfully!
echo =========================================================
