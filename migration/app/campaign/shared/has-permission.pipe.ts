import { inject, Pipe, PipeTransform } from '@angular/core';
import { PermissionService } from './permission.service';

/** `permission | hasPermission` → boolean. Custom pipe → pure function/hook. */
@Pipe({ name: 'hasPermission', standalone: true })
export class HasPermissionPipe implements PipeTransform {
  private permissionService = inject(PermissionService);

  transform(permission: string): boolean {
    return this.permissionService.hasPermission(permission);
  }
}
