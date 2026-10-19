import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_CLIENT_ERROR_PATH, API_DEV_URL } from '../constants';
import { APP_VERSION } from '../version';
import { Access } from './access';
import { ReportingErrorHandler } from './error-reporter';

describe('ReportingErrorHandler', () => {
  let http: HttpTestingController;
  let access: Access;
  let handler: ErrorHandler;

  const url = `${API_DEV_URL}${API_CLIENT_ERROR_PATH}`;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ErrorHandler, useClass: ReportingErrorHandler },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    access = TestBed.inject(Access);
    handler = TestBed.inject(ErrorHandler);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reports the error to the server with the app version', () => {
    access.save('secret-pass');

    handler.handleError(new TypeError('boom'));

    const request = http.expectOne(url);
    expect(request.request.headers.get('Authorization')).toBe('Bearer secret-pass');
    expect(request.request.body).toMatchObject({
      message: 'boom',
      where: 'TypeError',
      version: APP_VERSION,
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('does not report anything before the password is entered', () => {
    handler.handleError(new Error('too early'));

    http.expectNone(url);
  });

  it('survives a failing report', async () => {
    access.save('secret-pass');

    handler.handleError('plain string');
    http.expectOne(url).error(new ProgressEvent('error'));

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('plain string'));
  });
});
