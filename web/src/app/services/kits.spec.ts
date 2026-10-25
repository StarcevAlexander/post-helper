import { TestBed } from '@angular/core/testing';
import { KITS_STORAGE_KEY } from '../constants';
import { PlanItem, PublicationKit, StoredKit } from '../models';
import { samplePlan } from '../testing/plan-fixture';
import { CalendarPlan } from './calendar-plan';
import { Kits } from './kits';

const kit: PublicationKit = {
  shots: ['Снять руки'],
  frames: [{ visual: 'Руки', overlay: 'Смотрите' }],
  caption: 'Подпись',
  hashtags: ['#маникюр'],
  tip: 'Согласие клиента',
};

function storedFor(item: PlanItem): StoredKit {
  return { itemId: item.id, format: item.format, pillar: item.pillar, idea: item.idea, kit };
}

describe('Kits', () => {
  let kits: Kits;
  let plan: CalendarPlan;
  let items: PlanItem[];

  function setUp(): void {
    kits = TestBed.inject(Kits);
    plan = TestBed.inject(CalendarPlan);
  }

  function saveKitFor(item: PlanItem): void {
    localStorage.setItem(KITS_STORAGE_KEY, JSON.stringify({ [item.id]: storedFor(item) }));
  }

  beforeEach(() => {
    localStorage.clear();
    setUp();
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    items = plan.items();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts with no kits', () => {
    expect(kits.kitFor(items[0])).toBeUndefined();
  });

  it('remembers the kits delivered earlier', () => {
    saveKitFor(items[0]);
    TestBed.resetTestingModule();
    setUp();

    expect(kits.kitFor(items[0])).toEqual(kit);
    expect(kits.kitFor(items[1])).toBeUndefined();
  });

  it('ignores a stored kit once the idea of the item changes', () => {
    saveKitFor(items[0]);
    TestBed.resetTestingModule();
    setUp();

    expect(kits.kitFor({ ...items[0], idea: 'Другая идея' })).toBeUndefined();
  });

  it('drops kits of publications that left the calendar', () => {
    kits.stored.set({ [items[0].id]: storedFor(items[0]) });
    plan.reset();
    TestBed.tick();

    expect(Object.keys(kits.stored())).toEqual([]);
    expect(localStorage.getItem(KITS_STORAGE_KEY)).toBe('{}');
  });

  it('ignores a corrupted store', () => {
    localStorage.setItem(KITS_STORAGE_KEY, '{not json');
    TestBed.resetTestingModule();
    setUp();

    expect(kits.stored()).toEqual({});

    localStorage.setItem(KITS_STORAGE_KEY, JSON.stringify({ a: { itemId: 'b', kit: 1 } }));
    TestBed.resetTestingModule();
    setUp();

    expect(kits.stored()).toEqual({});
  });
});
