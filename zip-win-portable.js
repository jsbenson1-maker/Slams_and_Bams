const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

function zipWinPortable() {
  return new Promise((resolve, reject) => {
    const installersDir = path.join(__dirname, 'builds/installers');
    if (!fs.existsSync(installersDir)) {
      fs.mkdirSync(installersDir, { recursive: true });
    }

    const sourceDir = path.join(__dirname, 'builds/PhyzixSnB-win32-x64');
    const outPath = path.join(installersDir, 'PhyzixSnB-Windows-Portable.zip');

    if (!fs.existsSync(sourceDir)) {
      console.warn(`⚠️ Skipped Windows Portable ZIP: Source folder not found at:`);
      console.log(`   ${sourceDir}`);
      resolve();
      return;
    }

    console.log('---------------------------------------------------------');
    console.log('📦 Starting Windows Portable Standalone ZIP Compression...');
    console.log('---------------------------------------------------------');
    console.log(`📦 Compressing ${path.basename(sourceDir)} into ZIP archive...`);

    const output = fs.createWriteStream(outPath);
    const archive = new archiver.ZipArchive({
      zlib: { level: 9 } // Maximum compression
    });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`   └─ Successfully zipped! Total size: ${sizeMB} MB`);
      console.log(`📍 Output File: ${outPath}`);
      console.log('---------------------------------------------------------');
      resolve();
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('   ⚠️ Archiver Warning:', err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Append directory contents recursively
    archive.directory(sourceDir, false);

    archive.finalize();
  });
}

zipWinPortable();
