import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Access } from '../../services/access';

@Component({
  imports: [FormField],
  selector: 'app-access-gate',
  styleUrl: './access-gate.scss',
  templateUrl: './access-gate.html',
})
export class AccessGate {
  private readonly access = inject(Access);

  protected readonly model = signal({ password: '' });
  protected readonly gateForm = form(this.model);
  protected readonly canSubmit = computed(() => this.gateForm.password().value().trim().length > 0);

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.access.save(this.gateForm.password().value());
    this.model.set({ password: '' });
  }
}
