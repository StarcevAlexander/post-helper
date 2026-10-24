import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  it('compares the three numbers one by one', () => {
    expect(isNewerVersion('0.1.42', '0.1.41')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.1.99')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true);
  });

  it('says no for the same and for an older version', () => {
    expect(isNewerVersion('0.1.41', '0.1.41')).toBe(false);
    expect(isNewerVersion('0.1.40', '0.1.41')).toBe(false);
  });

  it('says no when a version cannot be read', () => {
    expect(isNewerVersion('', '0.1.41')).toBe(false);
    expect(isNewerVersion('x.y.z', '0.1.41')).toBe(false);
    expect(isNewerVersion('0.1', '0.1.41')).toBe(false);
  });
});
