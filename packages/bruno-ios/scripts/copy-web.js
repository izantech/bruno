const fs = require('fs-extra');
const path = require('path');

const src = path.join(__dirname, '../../bruno-app/dist');
const dest = path.join(__dirname, '../www');

if (!fs.existsSync(src)) {
  console.error('Source directory not found: ' + src);
  console.error('Run `npm run build:web` at the repo root first.');
  process.exit(1);
}

fs.emptyDirSync(dest);
fs.copySync(src, dest);
console.log('Web assets copied to ' + dest);
