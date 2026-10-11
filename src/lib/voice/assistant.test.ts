import { describe, expect, it, vi } from 'vitest';

vi.mock('../feedback', () => ({
  ask: vi.fn(),
  say: vi.fn(async () => undefined),
  voice: { repeat: vi.fn(), stop: vi.fn() },
}));

const { handleUtterance, parseAppCommand, registerScreenVoice, setNavigator, takePendingPlace } =
  await import('./assistant');

describe('parseAppCommand', () => {
  it.each([
    ['look around', '/look'],
    ["what's in front of me", '/look'],
    ['add a room', '/scan'],
    ['can you open my rooms', '/rooms'],
    ['settings please', '/settings'],
    ['go home', '/'],
    ['main menu', '/'],
  ])('%s opens %s', (said, path) => expect(parseAppCommand(said)).toMatchObject({ type: 'open', path }));

  it('understands where to go, worded loosely', () => {
    expect(parseAppCommand('take me to the stage')).toEqual({ type: 'go', place: 'stage' });
    expect(parseAppCommand("where's the coffee table")).toEqual({ type: 'go', place: 'coffee table' });
    expect(parseAppCommand('I want to go somewhere')).toEqual({ type: 'go', place: null });
  });

  it('handles talk like a companion', () => {
    expect(parseAppCommand('go back').type).toBe('back');
    expect(parseAppCommand('be quiet').type).toBe('quiet');
    expect(parseAppCommand('thank you').type).toBe('thanks');
    expect(parseAppCommand('slow down please')).toEqual({ type: 'speed', delta: -0.1 });
    expect(parseAppCommand('banana').type).toBe('unknown');
  });
});

describe('handleUtterance', () => {
  it('lets the screen answer first, then the app', () => {
    const nav = vi.fn();
    setNavigator(nav, '/');
    const off = registerScreenVoice({ handle: (h) => (h === 'kitchen' ? 'Should I go?' : false) });
    expect(handleUtterance('kitchen')).toBe('Should I go?');
    expect(handleUtterance('look around')).toBe(true);
    expect(nav).toHaveBeenCalledWith('/look');
    off();
  });

  it('remembers a place for the Go screen', () => {
    const nav = vi.fn();
    setNavigator(nav, '/');
    expect(handleUtterance('take me to the stage')).toBe(true);
    expect(nav).toHaveBeenCalledWith('/go');
    expect(takePendingPlace()).toBe('stage');
    expect(takePendingPlace()).toBeNull();
  });

  it('asks again when it did not catch anything', () => {
    expect(handleUtterance('')).toMatch(/didn't catch that/);
    expect(handleUtterance('banana')).toMatch(/didn't understand banana/);
  });
});
