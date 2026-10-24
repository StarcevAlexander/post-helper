import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { ROUTE_TITLES, SETTINGS_SECTION_TITLES } from './constants';
import { SettingsScreen } from './models';
import { CalendarPlan } from './services/calendar-plan';

function settingsTitle(route: ActivatedRouteSnapshot): string {
  const section = route.paramMap.get('section') as Exclude<SettingsScreen, 'main'> | null;
  return (section && SETTINGS_SECTION_TITLES[section]) ?? ROUTE_TITLES.settings;
}

export const routes: Routes = [
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
    path: 'refs/:id',
    title: ROUTE_TITLES.refs,
    data: { back: true },
    loadComponent: () => import('./components/refs-screen/refs-screen').then((m) => m.RefsScreen),
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
  { path: '**', redirectTo: '' },
];
