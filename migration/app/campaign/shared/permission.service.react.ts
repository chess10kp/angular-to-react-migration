import { AccountService } from 'app/core/auth/account.service';

/**
 * Permission-check API. The real target exposes permission checks through a
 * service (and a structural directive + pipe over it). Migration target:
 * a React `usePermission()` hook + `<IfPermission>` wrapper.
 */

export class PermissionService {
  constructor(private accountService: AccountService) {
    // MIGRATION_TODO(di): DI: 1 inject() dependency(ies) -> constructor params (accountService: AccountService); wire at construction or via a provider/context
  }

  hasPermission(permission: string): boolean {
    return this.accountService.hasAnyAuthority(permission);
  }

  hasAny(permissions: string[]): boolean {
    return permissions.some((p) => this.hasPermission(p));
  }
}
