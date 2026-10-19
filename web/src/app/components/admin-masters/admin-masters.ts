import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import {
  ADMIN_JOURNAL_TEXTS,
  ADMIN_TEXTS,
  CLEAR_CONFIRM_TIMEOUT_MS,
  COPY_FEEDBACK_MS,
  EVENTS_LIMIT,
  EXPORT_FILE_PREFIX,
  VERSIONS_LIMIT,
} from '../../constants';
import { CreatedMaster, MasterSummary } from '../../models';
import { ChatApi } from '../../services/chat-api';
import { copyText } from '../../utils/clipboard';
import { eventLabel, summarizeEvent } from '../../utils/event-summary';

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

interface VersionView {
  version: number;
  time: string;
  size: number;
}

interface EventView {
  id: number;
  label: string;
  summary: string;
  time: string;
}

const EVENT_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

@Component({
  imports: [FormField],
  selector: 'app-admin-masters',
  styleUrl: './admin-masters.scss',
  templateUrl: './admin-masters.html',
})
export class AdminMasters {
  private readonly api = inject(ChatApi);

  protected readonly texts = ADMIN_TEXTS;
  protected readonly journalTexts = ADMIN_JOURNAL_TEXTS;
  protected readonly selected = signal<MasterSummary | undefined>(undefined);
  protected readonly events = signal<EventView[]>([]);
  protected readonly versions = signal<VersionView[]>([]);
  protected readonly panelBusy = signal(false);
  protected readonly confirmingDelete = signal<string | undefined>(undefined);
  protected readonly confirmingRestore = signal<number | undefined>(undefined);
  protected readonly notice = signal<string | undefined>(undefined);
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

  protected async onJournal(master: MasterSummary): Promise<void> {
    if (this.selected()?.id === master.id) {
      this.selected.set(undefined);
      return;
    }
    this.selected.set(master);
    this.notice.set(undefined);
    await this.loadJournal(master.id);
  }

  protected async onExport(master: MasterSummary): Promise<void> {
    this.error.set(undefined);
    try {
      const data = await this.api.exportMaster(master.id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${EXPORT_FILE_PREFIX}-${master.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.error.set(ADMIN_TEXTS.failed);
    }
  }

  protected async onDelete(master: MasterSummary): Promise<void> {
    if (this.confirmingDelete() !== master.id) {
      this.confirmingDelete.set(master.id);
      setTimeout(() => this.confirmingDelete.set(undefined), CLEAR_CONFIRM_TIMEOUT_MS);
      return;
    }
    this.confirmingDelete.set(undefined);
    this.error.set(undefined);
    try {
      await this.api.deleteMaster(master.id);
      if (this.selected()?.id === master.id) {
        this.selected.set(undefined);
      }
      this.notice.set(ADMIN_JOURNAL_TEXTS.deleteDone);
      this.masters.set(await this.api.listMasters());
    } catch {
      this.error.set(ADMIN_TEXTS.failed);
    }
  }

  protected async onRestore(version: VersionView): Promise<void> {
    const master = this.selected();
    if (!master) {
      return;
    }
    if (this.confirmingRestore() !== version.version) {
      this.confirmingRestore.set(version.version);
      setTimeout(() => this.confirmingRestore.set(undefined), CLEAR_CONFIRM_TIMEOUT_MS);
      return;
    }
    this.confirmingRestore.set(undefined);
    this.panelBusy.set(true);
    try {
      await this.api.restoreMaster(master.id, version.version);
      this.notice.set(ADMIN_JOURNAL_TEXTS.restored);
      await this.loadJournal(master.id);
    } catch {
      this.error.set(ADMIN_TEXTS.failed);
    } finally {
      this.panelBusy.set(false);
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

  private async loadJournal(id: string): Promise<void> {
    this.panelBusy.set(true);
    try {
      const [events, versions] = await Promise.all([
        this.api.masterEvents(id, EVENTS_LIMIT),
        this.api.masterVersions(id, VERSIONS_LIMIT),
      ]);
      this.events.set(
        events.map((event) => ({
          id: event.id,
          label: eventLabel(event.kind),
          summary: summarizeEvent(event),
          time: EVENT_TIME_FORMAT.format(new Date(event.createdAt)),
        })),
      );
      this.versions.set(
        versions.map((version) => ({
          version: version.version,
          time: EVENT_TIME_FORMAT.format(new Date(version.savedAt)),
          size: version.size,
        })),
      );
    } catch {
      this.error.set(ADMIN_JOURNAL_TEXTS.loadFailed);
    } finally {
      this.panelBusy.set(false);
    }
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
