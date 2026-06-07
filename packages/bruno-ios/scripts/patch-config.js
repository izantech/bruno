// Writes packageClassList into the generated capacitor.config.json after cap sync.
// cap sync regenerates the JSON from capacitor.config.ts and does not preserve
// extra top-level keys, so this script re-applies the field every time.
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../ios/App/App/capacitor.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.packageClassList = ['BrunoFilesystemPlugin'];
fs.writeFileSync(configPath, JSON.stringify(config, null, '\t') + '\n');
console.log('capacitor.config.json patched: packageClassList = [BrunoFilesystemPlugin]');
