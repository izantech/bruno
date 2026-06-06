const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');

console.log('Building web bundle...');
execSync('npm run build:web', {
  cwd: rootDir,
  stdio: 'inherit'
});

console.log('Copying web bundle to packages/bruno-ios/www...');
execSync('npm run copy-web --workspace=packages/bruno-ios', {
  cwd: rootDir,
  stdio: 'inherit'
});

console.log('Static bundle is ready in packages/bruno-ios/www.');
console.log('To complete the native sync, run from packages/bruno-ios (requires Xcode):');
console.log('  npx cap sync ios');
