import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { API_DEV_URL, API_NOTICES_PATH, NOTICE_TEXTS } from '../../constants';
import { NoticeView } from '../../models';
import { Access } from '../../services/access';
import { Sync } from '../../services/sync';
import { NoticeOpen } from './notice-open';

const noticeUrl = `${API_DEV_URL}${API_NOTICES_PATH}/n1`;

const waiting: NoticeView = {
  id: 'n1',
  kind: 'publication',
  title: 'Пора публиковать',
  body: 'Reels: Гель-лак',
  sentAt: '2026-10-26T09:00:00Z',
  state: 'actual',
  link: '/kit/a',
};

describe('NoticeOpen', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;

  const settled = () => new Promise((resolve) => setTimeout(resolve));

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
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  async function open(answer: NoticeView | undefined) {
    const fixture = TestBed.createComponent(NoticeOpen);
    fixture.componentRef.setInput('id', 'n1');
    await fixture.whenStable();
    await settled();
    const request = http.expectOne(noticeUrl);
    if (answer) {
      request.flush(answer);
    } else {
      request.flush(null, { status: 0, statusText: 'offline' });
    }
    await settled();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('goes straight to the event while it is actual', async () => {
    await open(waiting);

    expect(navigate).toHaveBeenCalledWith('/kit/a', { replaceUrl: true });
  });

  it('shows the history with the reason when the event is no longer actual', async () => {
    await open({ ...waiting, state: 'done', reason: 'published', link: undefined });

    expect(navigate).toHaveBeenCalledWith('/settings/notifications', { replaceUrl: true });
  });

  it('opens the app for a plain message', async () => {
    await open({ ...waiting, kind: 'message', state: 'info', link: undefined });

    expect(navigate).toHaveBeenCalledWith('/', { replaceUrl: true });
  });

  it('stays and offers to retry when the check fails', async () => {
    const element = await open(undefined);

    expect(navigate).not.toHaveBeenCalled();
    expect(element.textContent).toContain(NOTICE_TEXTS.checkFailed);
    expect(element.querySelector('a')?.getAttribute('href')).toBe('/settings/notifications');
  });
});
