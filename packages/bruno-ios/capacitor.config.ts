import type { CapacitorConfig } from '@capacitor/cli';

const devPort = process.env.BRUNO_DEV_PORT;

const config: CapacitorConfig & { packageClassList?: string[] } = {
  appId: 'com.usebruno.app.ios',
  appName: 'Bruno',
  webDir: 'www',
  packageClassList: ['BrunoFilesystemPlugin', 'BrunoHttpPlugin'],
  ios: {
    contentInset: 'always'
  },
  server: devPort
    ? { url: `http://localhost:${devPort}`, cleartext: true }
    : undefined
};

export default config;
