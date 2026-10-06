import { xenditMode } from './xendit-mode';

describe('xenditMode', () => {
  it('reads test and live from the key prefix', () => {
    expect(xenditMode('xnd_development_abc')).toBe('test');
    expect(xenditMode('xnd_production_abc')).toBe('live');
  });

  it('says unknown rather than guessing', () => {
    expect(xenditMode(undefined)).toBe('unknown');
    expect(xenditMode('')).toBe('unknown');
    expect(xenditMode('sk_live_123')).toBe('unknown');
  });
});
