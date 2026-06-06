import { isElectron, isCapacitor, hasNativeHost } from './platform';

beforeEach(() => {
  delete window.ipcRenderer;
  delete window.Capacitor;
});

describe('isElectron', () => {
  it('returns true when window.ipcRenderer is set', () => {
    window.ipcRenderer = {};
    expect(isElectron()).toBe(true);
  });

  it('returns false when window.ipcRenderer is absent', () => {
    expect(isElectron()).toBe(false);
  });
});

describe('isCapacitor', () => {
  it('returns true when Capacitor.isNativePlatform() is true', () => {
    window.Capacitor = { isNativePlatform: () => true };
    expect(isCapacitor()).toBe(true);
  });

  it('returns false when Capacitor.isNativePlatform() is false', () => {
    window.Capacitor = { isNativePlatform: () => false };
    expect(isCapacitor()).toBe(false);
  });

  it('returns false when Capacitor is absent', () => {
    expect(isCapacitor()).toBe(false);
  });

  it('returns false when Capacitor.isNativePlatform is not a function', () => {
    window.Capacitor = { isNativePlatform: true };
    expect(isCapacitor()).toBe(false);
  });
});

describe('hasNativeHost', () => {
  it('returns true when ipcRenderer is present (electron)', () => {
    window.ipcRenderer = {};
    expect(hasNativeHost()).toBe(true);
  });

  it('returns true when Capacitor.isNativePlatform() is true', () => {
    window.Capacitor = { isNativePlatform: () => true };
    expect(hasNativeHost()).toBe(true);
  });

  it('returns false when neither Electron nor Capacitor is present', () => {
    expect(hasNativeHost()).toBe(false);
  });
});
