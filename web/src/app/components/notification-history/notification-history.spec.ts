import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { API_DEV_URL, API_NOTICES_PATH, NOTICE_REASON_TEXTS, NOTICE_TEXTS } from '../../constants';
import { NoticeView } from '../../models';
import { Access } from '../../services/access';
import { Sync } from '../../services/sync';
import { NotificationHistory } from './notification-history';

const listUrl = `${API_DEV_URL}${API_NOTICES_PATH}`;

const waiting: NoticeView = {
  id: 'w',
  kind: 'publication',
  title: 'Пора публиковать',
  body: 'Reels: Гель-лак',
  sentAt: '2026-10-26T09:00:00Z',
  state: 'actual',
  link: '/kit/a',
};

const outdated: NoticeView = {
  id: 'o',
  kind: 'plan',
  title: 'План готов',
  body: 'Ваш контент-план составлен',
  sentAt: '2026-10-20T09:00:00Z',
  state: 'outdated',
  reason: 'planReplaced',
};

describe('NotificationHistory', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Sync, useValue: { settle: () => Promise.resolve(true) } },
      ],
    });
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  const settled = () => new Promise((resolve) => setTimeout(resolve));

  async function open(items: NoticeView[]) {
    const fixture = TestBed.createComponent(NotificationHistory);
    await settled();
    http.expectOne(listUrl).flush(items);
    await settled();
    fixture.detectChanges();
    return fixture;
  }

  it('shows the button only for what is still actual and explains the rest', async () => {
    const fixture = await open([waiting, outdated]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('li.notice')).toHaveLength(2);
    expect(element.querySelectorAll('button.notice__more')).toHaveLength(1);
    expect(element.textContent).toContain(NOTICE_REASON_TEXTS.planReplaced);
  });

  it('says when there were no notifications', async () => {
    const fixture = await open([]);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(NOTICE_TEXTS.empty);
  });

  it('checks the entry again and opens it while it is actual', async () => {
    const fixture = await open([waiting]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button.notice__more')
      ?.click();
    await settled();
    http.expectOne(`${listUrl}/w`).flush(waiting);
    await settled();

    expect(navigate).toHaveBeenCalledWith('/kit/a');
  });

  it('stays and shows why when the entry became outdated since the list was loaded', async () => {
    const fixture = await open([waiting]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button.notice__more')
      ?.click();
    await settled();
    http
      .expectOne(`${listUrl}/w`)
      .flush({ ...waiting, state: 'done', reason: 'published', link: undefined });
    await settled();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(navigate).not.toHaveBeenCalled();
    expect(element.querySelector('button.notice__more')).toBeNull();
    expect(element.textContent).toContain(NOTICE_REASON_TEXTS.published);
  });

  it('does not open anything when the check fails', async () => {
    const fixture = await open([waiting]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button.notice__more')
      ?.click();
    await settled();
    http.expectOne(`${listUrl}/w`).flush(null, { status: 0, statusText: 'offline' });
    await settled();
    fixture.detectChanges();

    expect(navigate).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(NOTICE_TEXTS.checkFailed);
  });
});
