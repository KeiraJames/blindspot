import { describe, expect, it } from 'vitest';
import { cleanTranscript } from '../feedback';
import { matchPlace, parseCommand } from './commands';

const places = [
  { id: 'k', label: 'Kitchen' },
  { id: 'b', label: 'Bedroom' },
  { id: 'ba', label: 'Bathroom' },
  { id: 'c', label: 'Closet' },
  { id: 'l', label: 'Living Room' },
];

describe('matchPlace', () => {
  it.each([
    ['kitchen', 'k'],
    ['take me to the kitchen', 'k'],
    ['the bathroom please', 'ba'],
    ['closed', 'c'], // common mis-hearing of "closet"
    ['bed room', 'b'],
    ['living room', 'l'],
    ['bath', 'ba'],
  ])('%s → %s', (heard, id) => expect(matchPlace(heard, places)?.id).toBe(id));

  it('returns null when nothing is close', () => {
    expect(matchPlace('garage', places)).toBeNull();
    expect(matchPlace('', places)).toBeNull();
  });
});

describe('parseCommand', () => {
  it.each([
    ['Where am I?', 'where'],
    ['repeat that', 'repeat'],
    ['say that again', 'repeat'],
    ['pause', 'pause'],
    ['keep going', 'resume'],
    ['stop', 'end'],
    ['end navigation', 'end'],
    ['what can I say', 'help'],
  ])('%s → %s', (t, type) => expect(parseCommand(t, places).type).toBe(type));

  it('treats a room name as a new destination', () => {
    expect(parseCommand('go to the bedroom', places)).toEqual({ type: 'place', id: 'b' });
  });

  it('reports what it did not understand', () => {
    expect(parseCommand('banana', places)).toEqual({ type: 'unknown', heard: 'banana' });
  });
});

describe('cleanTranscript', () => {
  it.each([
    ['the kitchen.', 'Kitchen'],
    ["it's the living room", 'Living Room'],
    ['call it guest bedroom', 'Guest Bedroom'],
    ['  bathroom  ', 'Bathroom'],
  ])('%s → %s', (a, b) => expect(cleanTranscript(a)).toBe(b));
});
