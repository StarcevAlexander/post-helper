import { Component, inject } from '@angular/core';
import { RECOMMENDATION_TEXTS } from '../../constants';
import { Recommendations } from '../../services/recommendations';

@Component({
  selector: 'app-recommendations-screen',
  styleUrl: './recommendations-screen.scss',
  templateUrl: './recommendations-screen.html',
})
export class RecommendationsScreen {
  protected readonly recommendations = inject(Recommendations);
  protected readonly texts = RECOMMENDATION_TEXTS;
}
