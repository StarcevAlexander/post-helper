import { inject } from '@angular/core';
import { CanActivateChildFn } from '@angular/router';
import { Access } from '../services/access';

export const accessGuard: CanActivateChildFn = () => inject(Access).granted();
