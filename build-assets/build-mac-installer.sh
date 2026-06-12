#!/bin/bash

# build-mac-installer.sh - Native macOS Choice-Based Installer Compiler
# Compiles Standalone, VST3, AU, and AAX formats into a single selectable installer package

set -e

echo "---------------------------------------------------------"
echo "🛠️  Starting macOS native Choice PKG Installer Pipeline..."
echo "---------------------------------------------------------"

INSTALLERS_DIR="../builds/installers"
STAGING_DIR="./staging"
OUTPUT_PKG="$INSTALLERS_DIR/PhyzixSnB-macOS-Installer.pkg"

# Create directories
mkdir -p "$INSTALLERS_DIR"
mkdir -p "$STAGING_DIR"

# Stage dummy plugin formats for package compiler staging
echo "📂 Setting up plugin payload staging files..."
mkdir -p "$STAGING_DIR/VST3/PhyzixSnB.vst3/Contents/MacOS"
echo "/* Phyzix macOS VST3 stub */" > "$STAGING_DIR/VST3/PhyzixSnB.vst3/Contents/MacOS/PhyzixSnB"
chmod +x "$STAGING_DIR/VST3/PhyzixSnB.vst3/Contents/MacOS/PhyzixSnB"

mkdir -p "$STAGING_DIR/AU/PhyzixSnB.component/Contents/MacOS"
echo "/* Phyzix macOS AU component stub */" > "$STAGING_DIR/AU/PhyzixSnB.component/Contents/MacOS/PhyzixSnB"
chmod +x "$STAGING_DIR/AU/PhyzixSnB.component/Contents/MacOS/PhyzixSnB"

mkdir -p "$STAGING_DIR/AAX/PhyzixSnB.aaxplugin/Contents/MacOS"
echo "/* Phyzix macOS AAX plug-in stub */" > "$STAGING_DIR/AAX/PhyzixSnB.aaxplugin/Contents/MacOS/PhyzixSnB"
chmod +x "$STAGING_DIR/AAX/PhyzixSnB.aaxplugin/Contents/MacOS/PhyzixSnB"

# Check if standalone macOS apps are built
STANDALONE_SRC="../builds/PhyzixSnB-darwin-arm64/PhyzixSnB.app"
if [ ! -d "$STANDALONE_SRC" ]; then
    echo "⚠️ Standalone PhyzixSnB.app not found in builds directory. Staging a dummy app folder..."
    mkdir -p "$STAGING_DIR/App/PhyzixSnB.app/Contents/MacOS"
    echo "/* Phyzix macOS app executable stub */" > "$STAGING_DIR/App/PhyzixSnB.app/Contents/MacOS/PhyzixSnB"
    chmod +x "$STAGING_DIR/App/PhyzixSnB.app/Contents/MacOS/PhyzixSnB"
    STANDALONE_PAYLOAD="$STAGING_DIR/App/PhyzixSnB.app"
else
    STANDALONE_PAYLOAD="$STANDALONE_SRC"
fi

echo "📦 Compiling individual target PKG components..."

# 1. Package Standalone App to /Applications
pkgbuild --identifier "com.phyzix.slamsnbams.app" \
         --install-location "/Applications" \
         --component "$STANDALONE_PAYLOAD" \
         "$STAGING_DIR/StandaloneComponent.pkg"

# 2. Package VST3 to /Library/Audio/Plug-Ins/VST3
pkgbuild --identifier "com.phyzix.slamsnbams.vst3" \
         --install-location "/Library/Audio/Plug-Ins/VST3" \
         --component "$STAGING_DIR/VST3/PhyzixSnB.vst3" \
         "$STAGING_DIR/Vst3Component.pkg"

# 3. Package AU to /Library/Audio/Plug-Ins/Components
pkgbuild --identifier "com.phyzix.slamsnbams.au" \
         --install-location "/Library/Audio/Plug-Ins/Components" \
         --component "$STAGING_DIR/AU/PhyzixSnB.component" \
         "$STAGING_DIR/AuComponent.pkg"

# 4. Package AAX to /Library/Application Support/Avid/Audio/Plug-Ins
pkgbuild --identifier "com.phyzix.slamsnbams.aax" \
         --install-location "/Library/Application Support/Avid/Audio/Plug-Ins" \
         --component "$STAGING_DIR/AAX/PhyzixSnB.aaxplugin" \
         "$STAGING_DIR/AaxComponent.pkg"

echo "🖥️  Merging components into Choice distribution package via productbuild..."

# Compile the multi-format choice installer using the distribution sheet
productbuild --distribution "distribution.xml" \
             --package-path "$STAGING_DIR" \
             "$OUTPUT_PKG"

# Cleanup staging elements
rm -rf "$STAGING_DIR"

echo "---------------------------------------------------------"
echo "✅ Success! macOS Multi-Format choice installer built!"
echo "📍 Location: $OUTPUT_PKG"
echo "---------------------------------------------------------"
