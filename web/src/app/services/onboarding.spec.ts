import { TestBed } from '@angular/core/testing';
import { Strategy } from '../models';
import { Onboarding } from './onboarding';

const strategy: Strategy = {
  summary: 'Ок',
  positioning: '',
  profileFixes: [],
  pillars: [],
  cadence: { reels: 1, posts: 1, stories: 1, note: '' },
  firstSteps: [],
};

describe('Onboarding strategy revision', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('counts a freshly generated strategy but not a quiet update', () => {
    const onboarding = TestBed.inject(Onboarding);
    expect(onboarding.strategyRevision()).toBe(0);

    onboarding.setStrategy(strategy);
    expect(onboarding.strategyRevision()).toBe(1);

    onboarding.updateStrategy({ ...strategy, summary: 'Другое' });
    expect(onboarding.strategyRevision()).toBe(1);
    expect(onboarding.strategy()?.summary).toBe('Другое');
  });

  it('does not count a strategy restored from the storage', () => {
    localStorage.setItem('helper.strategy', JSON.stringify(strategy));

    const onboarding = TestBed.inject(Onboarding);

    expect(onboarding.strategy()?.summary).toBe('Ок');
    expect(onboarding.strategyRevision()).toBe(0);
  });
});
