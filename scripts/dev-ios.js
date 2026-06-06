const { spawn } = require('child_process');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}i${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}+${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}!${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}x${colors.reset} ${msg}`)
};

const rootDir = path.join(__dirname, '..');
const webDir = path.join(rootDir, 'packages/bruno-app');

let detectedPort = null;

// Regex to match rsbuild's local URL output (e.g., "Local:    http://localhost:3000/")
const portRegex = /Local:\s+http:\/\/localhost:(\d+)/;

console.log(`\n${colors.bright}${colors.yellow}Starting Bruno iOS development environment...${colors.reset}\n`);

const webProcess = spawn('npm', ['run', 'dev'], {
  cwd: webDir,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true
});

webProcess.stdout.on('data', (data) => {
  const output = data.toString();
  process.stdout.write(output);

  if (!detectedPort) {
    const match = output.match(portRegex);
    if (match) {
      detectedPort = match[1];
      log.success(`iOS dev server ready at http://localhost:${detectedPort}`);
      log.info(`Run the following from packages/bruno-ios with Xcode 26 to launch the simulator:`);
      log.info(`  BRUNO_DEV_PORT=${detectedPort} npx cap run ios`);
      log.info('Or open ios/App/App.xcworkspace in Xcode 26 (live-reload URL is picked up via BRUNO_DEV_PORT).');
    }
  }
});

webProcess.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
});

webProcess.on('close', (code) => {
  log.info(`Web process exited with code ${code}`);
  cleanup();
});

function cleanup() {
  if (webProcess && !webProcess.killed) {
    webProcess.kill();
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
