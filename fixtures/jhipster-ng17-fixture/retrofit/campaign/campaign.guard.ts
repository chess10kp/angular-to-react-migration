import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermissionService } from './shared/permission.service';
import { LaunchDarklyService } from './feature-flags/launch-darkly.service';

/**
 * Route guard combining a permission check and a LaunchDarkly flag. Migration
 * target: React Router loader/redirect logic sourced from `usePermission()` +
 * `useFlags()`; parity tests replay the same allow/deny decisions.
 */
export const canActivateCampaigns: CanActivateFn = () => {
  const permissionService = inject(PermissionService);
  const launchDarkly = inject(LaunchDarklyService);
  const router = inject(Router);

  const allowed = permissionService.hasPermission('campaign:view') && launchDarkly.variation('campaigns-enabled', false);
  return allowed ? true : router.parseUrl('/accessdenied');
};
