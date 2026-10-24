import { Component, inject } from '@angular/core';
import { ACCOUNT_TEXTS, YANDEX_TEXTS } from '../../constants';
import { Access } from '../../services/access';
import { YandexAuth } from '../../services/yandex-auth';

@Component({
  selector: 'app-access-gate',
  styleUrl: './access-gate.scss',
  templateUrl: './access-gate.html',
})
export class AccessGate {
  protected readonly access = inject(Access);
  protected readonly yandex = inject(YandexAuth);
  protected readonly yandexTexts = YANDEX_TEXTS;
  protected readonly rejectedText = ACCOUNT_TEXTS.rejected;
}
