import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { ROUTE_TITLES, SETTINGS_SECTION_TITLES } from './constants';
import { accessGuard } from './guards/access.guard';
import { CalendarPlan } from './services/calendar-plan';

function isSettingsSection(value: string): value is keyof typeof SETTINGS_SECTION_TITLES {
  return value in SETTINGS_SECTION_TITLES;
}

function settingsTitle(route: ActivatedRouteSnapshot): string {
  const section = route.paramMap.get('section') ?? '';
  return isSettingsSection(section) ? SETTINGS_SECTION_TITLES[section] : ROUTE_TITLES.settings;
}

const screens: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => (inject(CalendarPlan).hasPlan() ? 'today' : 'intake'),
  },
  {
    path: 'today',
    title: ROUTE_TITLES.today,
    loadComponent: () =>
      import('./components/today-screen/today-screen').then((m) => m.TodayScreen),
  },
  {
    path: 'calendar',
    title: ROUTE_TITLES.calendar,
    loadComponent: () =>
      import('./components/calendar-screen/calendar-screen').then((m) => m.CalendarScreen),
  },
  {
    path: 'reviews',
    title: ROUTE_TITLES.reviews,
    loadComponent: () =>
      import('./components/month-review-screen/month-review-screen').then(
        (m) => m.MonthReviewScreen,
      ),
  },
  {
    path: 'profile',
    title: ROUTE_TITLES.profile,
    loadComponent: () =>
      import('./components/recommendations-screen/recommendations-screen').then(
        (m) => m.RecommendationsScreen,
      ),
  },
  {
    path: 'intake',
    title: ROUTE_TITLES.intake,
    loadComponent: () =>
      import('./components/intake-screen/intake-screen').then((m) => m.IntakeScreen),
  },
  {
    path: 'kit/:id',
    title: ROUTE_TITLES.kit,
    data: { back: true },
    loadComponent: () => import('./components/kit-screen/kit-screen').then((m) => m.KitScreen),
  },
  {
    path: 'shoot/:week',
    title: ROUTE_TITLES.shoot,
    data: { back: true },
    loadComponent: () =>
      import('./components/shoot-screen/shoot-screen').then((m) => m.ShootScreen),
  },
  {
    path: 'replace/:id',
    title: ROUTE_TITLES.replace,
    data: { back: true },
    loadComponent: () =>
      import('./components/replace-idea-screen/replace-idea-screen').then(
        (m) => m.ReplaceIdeaScreen,
      ),
  },
  {
    path: 'refs/:id',
    title: ROUTE_TITLES.refs,
    data: { back: true },
    loadComponent: () => import('./components/refs-screen/refs-screen').then((m) => m.RefsScreen),
  },
  {
    path: 'content/:id',
    title: ROUTE_TITLES.content,
    data: { back: true },
    loadComponent: () =>
      import('./components/content-screen/content-screen').then((m) => m.ContentScreen),
  },
  {
    path: 'tutorial',
    title: ROUTE_TITLES.tutorial,
    loadComponent: () =>
      import('./components/tutorial-screen/tutorial-screen').then((m) => m.TutorialScreen),
  },
  {
    path: 'faq',
    title: ROUTE_TITLES.faq,
    data: { back: true },
    loadComponent: () => import('./components/faq-screen/faq-screen').then((m) => m.FaqScreen),
  },
  {
    path: 'feedback',
    title: ROUTE_TITLES.feedback,
    data: { back: true },
    loadComponent: () =>
      import('./components/feedback-screen/feedback-screen').then((m) => m.FeedbackScreen),
  },
  {
    path: 'settings',
    title: ROUTE_TITLES.settings,
    data: { back: true },
    loadComponent: () =>
      import('./components/settings-panel/settings-panel').then((m) => m.SettingsPanel),
  },
  {
    path: 'settings/:section',
    title: settingsTitle,
    data: { back: true },
    loadComponent: () =>
      import('./components/settings-panel/settings-panel').then((m) => m.SettingsPanel),
  },
];

export const routes: Routes = [
  { path: '', canActivateChild: [accessGuard], children: screens },
  { path: '**', redirectTo: '' },
];
