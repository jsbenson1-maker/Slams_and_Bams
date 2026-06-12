const path = require('path');
const winstaller = require('electron-winstaller');

async function compileInstaller() {
  console.log('---------------------------------------------------------');
  console.log('🛠️  Compiling Windows Installer for Phyzix: Slams and Bams...');
  console.log('---------------------------------------------------------');
  const start = Date.now();
  
  try {
    await winstaller.createWindowsInstaller({
      appDirectory: path.join(__dirname, 'builds/Phyzix-win32-x64'),
      outputDirectory: path.join(__dirname, 'builds/installers'),
      authors: 'Phyzix Labs',
      exe: 'Phyzix.exe',
      setupExe: 'PhyzixSetup.exe',
      noMsi: true,
      description: 'Phyzix: Slams and Bams - Standalone Analog Drum Machine Synthesizer',
      title: 'Phyzix: Slams and Bams',
    });
    
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log('---------------------------------------------------------');
    console.log(`✅ Success! Windows installer packaged in ${duration}s`);
    console.log('📍 Location: builds/installers/PhyzixSetup.exe');
    console.log('---------------------------------------------------------');
  } catch (error) {
    console.error('❌ Failed to compile Windows installer:', error.message);
    process.exit(1);
  }
}

compileInstaller();
