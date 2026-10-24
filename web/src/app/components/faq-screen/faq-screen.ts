import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FAQ_ITEMS, FAQ_TEXTS } from '../../constants';

@Component({
  imports: [RouterLink],
  selector: 'app-faq-screen',
  styleUrl: './faq-screen.scss',
  templateUrl: './faq-screen.html',
})
export class FaqScreen {
  protected readonly texts = FAQ_TEXTS;
  protected readonly items = FAQ_ITEMS;
}
