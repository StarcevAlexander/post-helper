import { TestBed } from '@angular/core/testing';
import { ACCESS_PASSWORD_STORAGE_KEY } from '../constants';
import { Access } from './access';

describe('Access', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('is not granted without a stored password', () => {
    expect(TestBed.inject(Access).granted()).toBe(false);
  });

  it('saves a trimmed password and persists it', () => {
    const access = TestBed.inject(Access);
    access.save('  secret-pass  ');

    expect(access.password()).toBe('secret-pass');
    expect(access.granted()).toBe(true);
    expect(localStorage.getItem(ACCESS_PASSWORD_STORAGE_KEY)).toBe('secret-pass');
  });

  it('restores the password from storage', () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');

    expect(TestBed.inject(Access).password()).toBe('stored-pass');
  });

  it('clears the password everywhere', () => {
    const access = TestBed.inject(Access);
    access.save('secret-pass');
    access.clear();

    expect(access.granted()).toBe(false);
    expect(localStorage.getItem(ACCESS_PASSWORD_STORAGE_KEY)).toBeNull();
  });
});
