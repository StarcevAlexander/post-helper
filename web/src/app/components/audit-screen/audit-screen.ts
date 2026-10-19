import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import {
  AUDIT_SHOTS,
  AUDIT_TEXTS,
  COPY_FEEDBACK_MS,
  MAX_AUDIT_IMAGES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MIN_AUDIT_IMAGES,
} from '../../constants';
import { AuditPick } from '../../models';
import { Audit } from '../../services/audit';
import { Chat } from '../../services/chat';
import { ImageCompressor } from '../../services/image-compressor';
import { Onboarding } from '../../services/onboarding';
import { copyText } from '../../utils/clipboard';

type CopyTarget = 'bio' | 'name';

@Component({
  selector: 'app-audit-screen',
  styleUrl: './audit-screen.scss',
  templateUrl: './audit-screen.html',
})
export class AuditScreen {
  protected readonly audit = inject(Audit);
  protected readonly chat = inject(Chat);
  protected readonly onboarding = inject(Onboarding);
  protected readonly texts = AUDIT_TEXTS;
  protected readonly shots = AUDIT_SHOTS;
  protected readonly maxImages = MAX_AUDIT_IMAGES;
  protected readonly picks = signal<AuditPick[]>([]);
  protected readonly pickError = signal<string | undefined>(undefined);
  protected readonly editing = signal(false);
  protected readonly copied = signal<CopyTarget | 'failed' | undefined>(undefined);
  protected readonly showForm = computed(() => this.audit.stored() === undefined || this.editing());
  protected readonly canSubmit = computed(() => this.picks().length > 0 && !this.audit.busy());
  protected readonly tooFew = computed(
    () => this.picks().length > 0 && this.picks().length < MIN_AUDIT_IMAGES,
  );
  protected readonly copyFeedback = computed(() => {
    switch (this.copied()) {
      case undefined:
        return '';
      case 'failed':
        return AUDIT_TEXTS.copyFailed;
      default:
        return AUDIT_TEXTS.copied;
    }
  });

  private readonly compressor = inject(ImageCompressor);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.audit.open() && !element.open) {
        this.editing.set(false);
        element.showModal();
      } else if (!this.audit.open() && element.open) {
        this.clearPicks();
        element.close();
      }
    });
  }

  protected async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.pickError.set(undefined);

    for (const file of files) {
      if (this.picks().length >= MAX_AUDIT_IMAGES) {
        this.pickError.set(AUDIT_TEXTS.limit);
        break;
      }
      if (!file.type.startsWith('image/')) {
        this.pickError.set(AUDIT_TEXTS.notImage);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        this.pickError.set(AUDIT_TEXTS.tooLarge);
        continue;
      }
      const prepared = await this.compressor.prepare(file);
      this.picks.update((current) => [
        ...current,
        { id: crypto.randomUUID(), file: prepared, previewUrl: URL.createObjectURL(prepared) },
      ]);
    }
  }

  protected onRemove(id: string): void {
    const target = this.picks().find((pick) => pick.id === id);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
    }
    this.picks.update((current) => current.filter((pick) => pick.id !== id));
    this.pickError.set(undefined);
  }

  protected async onSubmit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    const files = this.picks().map((pick) => pick.file);
    if (await this.audit.analyze(files)) {
      this.clearPicks();
      this.editing.set(false);
    }
  }

  protected onAgain(): void {
    this.editing.set(true);
  }

  protected onClear(): void {
    this.audit.clear();
    this.editing.set(false);
  }

  protected onRefreshStrategy(): void {
    this.audit.hide();
    this.chat.buildStrategy();
  }

  protected async onCopy(target: CopyTarget, text: string): Promise<void> {
    this.copied.set((await copyText(text)) ? target : 'failed');
    setTimeout(() => this.copied.set(undefined), COPY_FEEDBACK_MS);
  }

  protected onClose(): void {
    this.audit.hide();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.audit.hide();
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.audit.hide();
    }
  }

  private clearPicks(): void {
    this.picks().forEach((pick) => URL.revokeObjectURL(pick.previewUrl));
    this.picks.set([]);
    this.pickError.set(undefined);
  }
}
