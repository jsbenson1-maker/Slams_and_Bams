const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

function copyDirRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyDirRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function buildWinInstaller() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    console.log('---------------------------------------------------------');
    console.log('🛠️  Starting Windows C# Installer Compiler Pipeline...');
    console.log('---------------------------------------------------------');

    const appDir = path.join(__dirname, 'builds/PhyzixSnB-win32-x64');
    const installersDir = path.join(__dirname, 'builds/installers');
    const payloadZip = path.join(__dirname, 'payload.zip');
    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

    if (fs.existsSync(appDir)) {
      console.log('🧹 Cleaning existing staging directory...');
      fs.rmSync(appDir, { recursive: true, force: true });
    }
    fs.mkdirSync(appDir, { recursive: true });

    if (!fs.existsSync(installersDir)) {
      fs.mkdirSync(installersDir, { recursive: true });
    }

    // 1. Stage Standalone EXE, VST3, VST2, and AAX folders inside the staging folder
    console.log('📂 Staging Standalone EXE, VST3, VST2, and AAX files...');
    
    // Standalone EXE Copy Block
    const compiledExe = path.join(__dirname, 'src-plugin/build/PhyzixSnB_artefacts/Release/Standalone/PhyzixSnB.exe');
    const destExe = path.join(appDir, 'PhyzixSnB.exe');
    if (fs.existsSync(compiledExe)) {
      console.log('   ├─ Found REAL compiled Standalone EXE. Copying to staging...');
      fs.copyFileSync(compiledExe, destExe);
    } else {
      console.log('   ├─ Standalone EXE not found. Creating placeholder stub...');
      fs.writeFileSync(destExe, '/* Phyzix Standalone Audio App binary stub */\n', 'utf-8');
    }

    // VST3 Copy Block
    const compiledVst3Dir = path.join(__dirname, 'src-plugin/build/PhyzixSnB_artefacts/Release/VST3/PhyzixSnB.vst3');
    const localVstFolder = path.join(appDir, 'PhyzixSnB.vst3/Contents/x64-win');
    
    if (fs.existsSync(compiledVst3Dir)) {
      console.log('   ├─ Found REAL compiled VST3 bundle. Copying to staging...');
      copyDirRecursiveSync(compiledVst3Dir, path.join(appDir, 'PhyzixSnB.vst3'));
    } else {
      console.log('   ├─ VST3 bundle not found. Creating placeholder stub...');
      fs.mkdirSync(localVstFolder, { recursive: true });
      fs.writeFileSync(path.join(localVstFolder, 'PhyzixSnB.vst3'), '/* Phyzix VST3 Audio Plugin binary stub */\n', 'utf-8');
    }

    // VST2 Copy Block
    const compiledVst2File = path.join(__dirname, 'src-plugin/build/PhyzixSnB_artefacts/Release/VST/PhyzixSnB.dll');
    const destVst2File = path.join(appDir, 'PhyzixSnB.dll');
    
    if (fs.existsSync(compiledVst2File)) {
      console.log('   ├─ Found REAL compiled VST2 DLL. Copying to staging...');
      fs.copyFileSync(compiledVst2File, destVst2File);
    } else {
      console.log('   ├─ VST2 DLL not found. Creating placeholder stub...');
      fs.writeFileSync(destVst2File, '/* Phyzix VST2 Audio Plugin DLL stub */\n', 'utf-8');
    }

    // AAX Copy Block
    const aaxFolder = path.join(appDir, 'PhyzixSnB.aaxplugin/Contents/x64');
    fs.mkdirSync(aaxFolder, { recursive: true });
    fs.writeFileSync(path.join(aaxFolder, 'PhyzixSnB.aaxplugin'), '/* Phyzix AAX Pro Tools Audio Plugin binary stub */\n', 'utf-8');


    // Compile C# Uninstaller and place it in the standalone application folder
    console.log('🖥️  Compiling C# uninstaller via csc.exe...');
    const sourceUninstaller = path.join(__dirname, 'build-assets/WindowsUninstaller.cs');
    const outUninstallerExe = path.join(appDir, 'PhyzixSnBUninstall.exe');
    const uninstallerCmd = `"${cscPath}" /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:"${outUninstallerExe}" "${sourceUninstaller}"`;
    
    try {
      execSync(uninstallerCmd, { stdio: 'inherit' });
      console.log('   └─ C# uninstaller compiled successfully!');
    } catch (err) {
      console.error('❌ C# uninstaller compilation failed:', err.message);
      reject(err);
      return;
    }

    // 2. Compress the full app folder (including stubs and uninstaller) into a temporary payload.zip
    console.log('📦 Compressing PhyzixSnB standalone, plugins, and uninstaller into payload.zip...');
    const output = fs.createWriteStream(payloadZip);
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
      const zipSize = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`   └─ Zip payload compiled! Size: ${zipSize} MB`);
      
      // 3. Compile the C# installer embedding the payload.zip as a binary resource
      console.log('🖥️  Compiling C# installer via csc.exe...');
      const sourceCs = path.join(__dirname, 'build-assets/WindowsInstaller.cs');
      const outExe = path.join(installersDir, 'PhyzixSnBSetup.exe');

      const cmd = `"${cscPath}" /target:winexe /resource:"${payloadZip}" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /out:"${outExe}" "${sourceCs}"`;

      try {
        console.log(`   └─ Running C# compiler...`);
        execSync(cmd, { stdio: 'inherit' });
        
        const duration = ((Date.now() - start) / 1000).toFixed(2);
        console.log('---------------------------------------------------------');
        console.log(`✅ Success! Custom C# WinForms Installer compiled in ${duration}s`);
        console.log(`📍 Location: ${outExe}`);
        console.log('---------------------------------------------------------');
      } catch (err) {
        console.error('❌ C# compilation failed:', err.message);
        reject(err);
        return;
      } finally {
        // 4. Cleanup temporary payload.zip
        console.log('🧹 Cleaning up temporary zip payload...');
        if (fs.existsSync(payloadZip)) {
          fs.unlinkSync(payloadZip);
        }
      }
      resolve();
    });

    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    archive.directory(appDir, false);
    archive.finalize();
  });
}

buildWinInstaller();
