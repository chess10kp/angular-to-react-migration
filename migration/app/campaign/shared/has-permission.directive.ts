import { Directive, inject, Input, TemplateRef, ViewContainerRef } from '@angular/core';
import { PermissionService } from './permission.service';

/**
 * Structural permission directive: `*appHasPermission="'campaign:edit'"`.
 * Each structural directive needs a hand-written React adapter (here an
 * `<IfPermission permission="...">` wrapper).
 */
@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private permissionService = inject(PermissionService);

  private hasView = false;

  @Input() set appHasPermission(permission: string) {
    const allowed = this.permissionService.hasPermission(permission);
    if (allowed && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!allowed && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }
}
