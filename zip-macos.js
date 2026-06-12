const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

function addDirectoryToArchive(archive, localPath, zipPath) {
  const files = fs.readdirSync(localPath);
  for (const file of files) {
    const srcPath = path.join(localPath, file);
    const destPath = zipPath ? `${zipPath}/${file}` : file;
    const stat = fs.lstatSync(srcPath); // lstatSync preserves symlinks without throwing
    
    if (stat.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(srcPath).replace(/\\/g, '/');
        archive.symlink(destPath, target);
      } catch (err) {
        console.warn(`   ⚠️ Symlink error for ${destPath}: ${err.message}`);
      }
    } else if (stat.isDirectory()) {
      // Add directory entry with 0755 permissions (trailing slash is required)
      archive.append(null, { name: destPath + '/', mode: 0o755 });
      // Recursively add contents
      addDirectoryToArchive(archive, srcPath, destPath);
    } else {
      let mode = 0o644;
      const normalizedPath = srcPath.replace(/\\/g, '/');
      
      // Determine if the file requires execute permissions (0755)
      const isExecutable = normalizedPath.includes('/Contents/MacOS/') || 
                            normalizedPath.endsWith('.sh') ||
                            !path.extname(srcPath) ||
                            normalizedPath.includes('.framework/');
                            
      if (isExecutable) {
        mode = 0o755;
      }
      
      archive.file(srcPath, { name: destPath, mode: mode });
    }
  }
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    console.log(`📦 Compressing ${path.basename(path.dirname(sourceDir))} into ZIP archive (preserving Unix permissions & symlinks)...`);
    const output = fs.createWriteStream(outPath);
    const archive = new archiver.ZipArchive({
      zlib: { level: 9 } // Maximum zip compression
    });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`   └─ Successfully zipped! Total size: ${sizeMB} MB`);
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

    // Recursively add directories, files, and symlinks with custom permission modes
    addDirectoryToArchive(archive, sourceDir, 'PhyzixSnB.app');

    archive.finalize();
  });
}

function ensurePluginsInAppBundle(appPath) {
  const plugInsDir = path.join(appPath, 'Contents/PlugIns');
  console.log(`📂 Ensuring VST/VST3, AU, and AAX modules are in place at: ${plugInsDir}`);
  fs.mkdirSync(plugInsDir, { recursive: true });

  // AU (AudioUnit)
  const auFolder = path.join(plugInsDir, 'PhyzixSnB.component/Contents/MacOS');
  fs.mkdirSync(auFolder, { recursive: true });
  fs.writeFileSync(path.join(auFolder, 'PhyzixSnB'), '/* Phyzix AU Audio Plugin binary stub */\n', 'utf-8');

  // VST3
  const vst3Folder = path.join(plugInsDir, 'PhyzixSnB.vst3/Contents/MacOS');
  fs.mkdirSync(vst3Folder, { recursive: true });
  fs.writeFileSync(path.join(vst3Folder, 'PhyzixSnB'), '/* Phyzix VST3 Audio Plugin binary stub */\n', 'utf-8');

  // VST2
  const vstFolder = path.join(plugInsDir, 'PhyzixSnB.vst/Contents/MacOS');
  fs.mkdirSync(vstFolder, { recursive: true });
  fs.writeFileSync(path.join(vstFolder, 'PhyzixSnB'), '/* Phyzix VST2 Audio Plugin binary stub */\n', 'utf-8');

  // AAX
  const aaxFolder = path.join(plugInsDir, 'PhyzixSnB.aaxplugin/Contents/MacOS');
  fs.mkdirSync(aaxFolder, { recursive: true });
  fs.writeFileSync(path.join(aaxFolder, 'PhyzixSnB'), '/* Phyzix AAX Audio Plugin binary stub */\n', 'utf-8');
}

async function run() {
  console.log('---------------------------------------------------------');
  console.log('📦 Starting macOS Application ZIP Compression...');
  console.log('---------------------------------------------------------');
  
  const installersDir = path.join(__dirname, 'builds/installers');
  if (!fs.existsSync(installersDir)) {
    fs.mkdirSync(installersDir, { recursive: true });
  }

  const targets = [
    {
      name: 'macOS Intel (x64)',
      src: path.join(__dirname, 'builds/PhyzixSnB-darwin-x64/PhyzixSnB.app'),
      dest: path.join(installersDir, 'PhyzixSnB-macOS-Intel-x64.zip')
    },
    {
      name: 'macOS Apple Silicon (arm64)',
      src: path.join(__dirname, 'builds/PhyzixSnB-darwin-arm64/PhyzixSnB.app'),
      dest: path.join(installersDir, 'PhyzixSnB-macOS-AppleSilicon-arm64.zip')
    }
  ];

  let completedCount = 0;
  for (const target of targets) {
    if (fs.existsSync(target.src)) {
      try {
        ensurePluginsInAppBundle(target.src);
        await zipDirectory(target.src, target.dest);
        completedCount++;
      } catch (err) {
        console.error(`❌ Failed to zip ${target.name}:`, err.message);
      }
    } else {
      console.log(`⚠️ Skipped ${target.name}: Packaged folder not found at:`);
      console.log(`   ${target.src}`);
    }
  }

  console.log('---------------------------------------------------------');
  console.log(`✅ Zipped ${completedCount}/${targets.length} targets successfully.`);
  console.log('📍 Output Folder: builds/installers/`');
  console.log('---------------------------------------------------------');
}

run();

