import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NOTICE_OPEN_ROUTES, NOTICE_TEXTS } from '../../constants';
import { Notices } from '../../services/notices';

@Component({
  imports: [RouterLink],
  selector: 'app-notice-open',
  styleUrl: './notice-open.scss',
  templateUrl: './notice-open.html',
})
export class NoticeOpen {
  readonly id = input.required<string>();

  private readonly notices = inject(Notices);
  private readonly router = inject(Router);
  protected readonly texts = NOTICE_TEXTS;
  protected readonly historyLink = NOTICE_OPEN_ROUTES.history;
  protected readonly failed = signal(false);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.open(id));
    });
  }

  protected retry(): void {
    void this.open(this.id());
  }

  private async open(id: string): Promise<void> {
    this.failed.set(false);
    try {
      const notice = await this.notices.recheck(id);
      const target =
        notice.state === 'actual' && notice.link
          ? notice.link
          : notice.state === 'info'
            ? NOTICE_OPEN_ROUTES.home
            : NOTICE_OPEN_ROUTES.history;
      await this.router.navigateByUrl(target, { replaceUrl: true });
    } catch {
      this.failed.set(true);
    }
  }
}
