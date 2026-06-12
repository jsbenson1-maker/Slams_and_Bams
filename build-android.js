// build-android.js - Direct, end-to-end Android build and signing orchestration
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ensureKeystore } = require('./keystore-generator');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const androidProjectDir = path.join(rootDir, 'android-project');
const androidAssetsDir = path.join(androidProjectDir, 'app', 'src', 'main', 'assets', 'dist');
const exportsDir = path.join(rootDir, 'exports');

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);
  files.forEach((file) => {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);

    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  });
}

function cleanDirectory(directory) {
  if (fs.existsSync(directory)) {
    console.log(`[Build] Cleaning old assets from: ${directory}`);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function buildReactApp() {
  console.log('\n========================================');
  console.log('[Build] Step 1: Compiling React Production Assets...');
  console.log('========================================');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  console.log('[Build] React assets compiled successfully.');
}

function copyAssets() {
  console.log('\n========================================');
  console.log('[Build] Step 2: Deploying static assets to Android WebView container...');
  console.log('========================================');
  cleanDirectory(androidAssetsDir);
  copyFolderRecursiveSync(distDir, androidAssetsDir);
  console.log(`[Build] Static assets successfully copied to: ${androidAssetsDir}`);
}

function compileAndroidAabAndApk() {
  console.log('\n========================================');
  console.log('[Build] Step 3: Running Java keystore verification...');
  console.log('========================================');
  ensureKeystore();

  console.log('\n========================================');
  console.log('[Build] Step 4: Compiling signed Android App Bundle (.aab) & APK (.apk) with Gradle...');
  console.log('========================================');

  const isWindows = process.platform === 'win32';
  const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
  const command = `${gradleCmd} bundleRelease assembleRelease`;

  try {
    console.log(`[Build] Executing Gradle command: "${command}" inside ${androidProjectDir}...`);
    execSync(command, { cwd: androidProjectDir, stdio: 'inherit' });
    console.log('[Build] Gradle compilation completed successfully.');
  } catch (err) {
    console.error(`[Build] Gradle compilation failed: ${err.message}`);
    process.exit(1);
  }
}

function exportAab() {
  console.log('\n========================================');
  console.log('[Build] Step 5: Exporting completed Android App Bundle...');
  console.log('========================================');

  const sourceAab = path.join(
    androidProjectDir,
    'app',
    'build',
    'outputs',
    'bundle',
    'release',
    'app-release.aab'
  );

  if (!fs.existsSync(sourceAab)) {
    console.error(`[Build] Error: Compiled AAB not found at expected path: ${sourceAab}`);
    process.exit(1);
  }

  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const destAab = path.join(exportsDir, 'PhyzixSnB.aab');
  fs.copyFileSync(sourceAab, destAab);

  console.log('--------------------------------------------------');
  console.log('SUCCESS: Android App Bundle (.aab) generated and signed!');
  console.log(`Destination: ${destAab}`);
  console.log('--------------------------------------------------\n');
}

function exportApk() {
  console.log('\n========================================');
  console.log('[Build] Step 6: Exporting completed Android Package (.apk)...');
  console.log('========================================');

  const sourceApk = path.join(
    androidProjectDir,
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk'
  );

  if (!fs.existsSync(sourceApk)) {
    console.error(`[Build] Error: Compiled APK not found at expected path: ${sourceApk}`);
    process.exit(1);
  }

  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const destApk = path.join(exportsDir, 'PhyzixSnB.apk');
  fs.copyFileSync(sourceApk, destApk);

  console.log('--------------------------------------------------');
  console.log('SUCCESS: Android Package (.apk) generated and signed!');
  console.log(`Destination: ${destApk}`);
  console.log('--------------------------------------------------\n');
}

function run() {
  const startTime = Date.now();
  try {
    buildReactApp();
    copyAssets();
    compileAndroidAabAndApk();
    exportAab();
    exportApk();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Build] All tasks completed successfully in ${duration} seconds.`);
  } catch (err) {
    console.error(`[Build] Pipeline failed: ${err.message}`);
    process.exit(1);
  }
}

run();
