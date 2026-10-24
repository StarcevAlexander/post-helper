import { TestBed } from '@angular/core/testing';
import { SCALE_STORAGE_KEY, SETTINGS_STORAGE_KEY, THEME_STORAGE_KEY } from '../constants';
import { Settings } from './settings';

describe('Settings', () => {
  function setUp(): Settings {
    TestBed.resetTestingModule();
    return TestBed.inject(Settings);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts with the defaults and writes nothing until the person changes something', () => {
    const settings = setUp();

    expect(settings.theme()).toBe('light');
    expect(settings.scale()).toBe(100);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('keeps the theme and the scale in one record that can travel to the server', () => {
    const settings = setUp();

    settings.setTheme('dark');
    settings.setScale(120);

    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      theme: 'dark',
      scale: 120,
    });
    expect(setUp().theme()).toBe('dark');
    expect(setUp().scale()).toBe(120);
  });

  it('takes the record that came from the server', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'ocean', scale: 110 }));

    const settings = setUp();

    expect(settings.theme()).toBe('ocean');
    expect(settings.scale()).toBe(110);
  });

  it('reads the old separate keys once and still works without them', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'forest');
    localStorage.setItem(SCALE_STORAGE_KEY, '130');

    const settings = setUp();

    expect(settings.theme()).toBe('forest');
    expect(settings.scale()).toBe(130);
  });

  it('ignores a broken record and keeps the defaults for wrong values', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(setUp().theme()).toBe('light');

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'nope', scale: 9000 }));
    const settings = setUp();

    expect(settings.theme()).toBe('light');
    expect(settings.scale()).toBe(100);
  });

  it('clamps the scale to the allowed range', () => {
    const settings = setUp();

    settings.setScale(1000);
    expect(settings.scale()).toBe(150);

    settings.setScale(1);
    expect(settings.scale()).toBe(80);
  });
});
