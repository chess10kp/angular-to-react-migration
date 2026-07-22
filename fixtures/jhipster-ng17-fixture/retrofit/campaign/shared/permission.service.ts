import { inject, Injectable } from '@angular/core';
import { AccountService } from 'app/core/auth/account.service';

/**
 * Permission-check API. The real target exposes permission checks through a
 * service (and a structural directive + pipe over it). Migration target:
 * a React `usePermission()` hook + `<IfPermission>` wrapper.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private accountService = inject(AccountService);

  hasPermission(permission: string): boolean {
    return this.accountService.hasAnyAuthority(permission);
  }

  hasAny(permissions: string[]): boolean {
    return permissions.some(p => this.hasPermission(p));
  }
}
