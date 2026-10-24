import { Location } from '@angular/common';
import { Service, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

@Service()
export class Navigation {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  private readonly leaf = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.deepest()),
    ),
  );

  readonly title = computed(() => this.leaf()?.title ?? '');
  readonly canGoBack = computed(() => this.leaf()?.data['back'] === true);

  back(): void {
    if (window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/');
    }
  }

  go(url: string): void {
    void this.router.navigateByUrl(url);
  }

  private deepest(): ActivatedRouteSnapshot {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route;
  }
}
