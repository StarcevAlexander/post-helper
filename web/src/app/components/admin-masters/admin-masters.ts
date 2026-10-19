import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { ADMIN_TEXTS, COPY_FEEDBACK_MS } from '../../constants';
import { CreatedMaster, MasterSummary } from '../../models';
import { ChatApi } from '../../services/chat-api';
import { copyText } from '../../utils/clipboard';

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

interface MasterView {
  master: MasterSummary;
  seen: string;
}

@Component({
  imports: [FormField],
  selector: 'app-admin-masters',
  styleUrl: './admin-masters.scss',
  templateUrl: './admin-masters.html',
})
export class AdminMasters {
  private readonly api = inject(ChatApi);

  protected readonly texts = ADMIN_TEXTS;
  protected readonly masters = signal<MasterSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly created = signal<CreatedMaster | undefined>(undefined);
  protected readonly copyResult = signal<'copied' | 'failed' | undefined>(undefined);
  protected readonly model = signal({ name: '' });
  protected readonly createForm = form(this.model);
  protected readonly canCreate = computed(
    () => this.createForm.name().value().trim().length > 0 && !this.loading(),
  );
  protected readonly views = computed<MasterView[]>(() =>
    this.masters().map((master) => ({
      master,
      seen: this.seenLabel(master),
    })),
  );

  constructor() {
    void this.load();
  }

  protected async onCreate(): Promise<void> {
    if (!this.canCreate()) {
      return;
    }
    this.loading.set(true);
    this.error.set(undefined);
    try {
      const created = await this.api.createMaster(this.createForm.name().value().trim());
      this.created.set(created);
      this.copyResult.set(undefined);
      this.model.set({ name: '' });
      this.masters.set(await this.api.listMasters());
    } catch {
      this.error.set(ADMIN_TEXTS.failed);
    } finally {
      this.loading.set(false);
    }
  }

  protected async onToggle(master: MasterSummary): Promise<void> {
    this.error.set(undefined);
    try {
      await this.api.setMasterDisabled(master.id, !master.disabled);
      this.masters.set(await this.api.listMasters());
    } catch {
      this.error.set(ADMIN_TEXTS.failed);
    }
  }

  protected async onCopy(): Promise<void> {
    const created = this.created();
    if (!created) {
      return;
    }
    this.copyResult.set((await copyText(created.code)) ? 'copied' : 'failed');
    setTimeout(() => this.copyResult.set(undefined), COPY_FEEDBACK_MS);
  }

  protected onCloseCode(): void {
    this.created.set(undefined);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.masters.set(await this.api.listMasters());
    } catch {
      this.error.set(ADMIN_TEXTS.loadFailed);
    } finally {
      this.loading.set(false);
    }
  }

  private seenLabel(master: MasterSummary): string {
    const seen = new Date(master.lastSeenAt);
    return seen.getFullYear() < 2000
      ? ADMIN_TEXTS.never
      : `${ADMIN_TEXTS.lastSeen} ${DATE_FORMAT.format(seen)}`;
  }
}
