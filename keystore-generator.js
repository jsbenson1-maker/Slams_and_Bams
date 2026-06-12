// keystore-generator.js - Generates the release signing keystore if missing
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const keystorePath = path.join(__dirname, 'android-project', 'app', 'release.keystore');

function ensureKeystore() {
  if (fs.existsSync(keystorePath)) {
    console.log(`[Signing] Keystore already exists at: ${keystorePath}`);
    return;
  }

  console.log(`[Signing] Keystore not found. Generating a secure self-signed release keystore...`);
  
  const command = [
    'keytool',
    '-genkeypair',
    '-v',
    '-keystore', `"${keystorePath}"`,
    '-alias', 'phyzixkey',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', 'phyzixsnb123',
    '-keypass', 'phyzixsnb123',
    '-dname', '"CN=Phyzix, OU=Studio, O=PhyzixSnB, L=Metropolis, S=NY, C=US"',
    '-storetype', 'PKCS12'
  ].join(' ');

  try {
    console.log(`[Signing] Executing keytool command...`);
    execSync(command, { stdio: 'inherit' });
    console.log(`[Signing] Successfully generated release keystore at: ${keystorePath}`);
  } catch (err) {
    console.error(`[Signing] Error generating keystore: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  ensureKeystore();
}

module.exports = { ensureKeystore, keystorePath };
