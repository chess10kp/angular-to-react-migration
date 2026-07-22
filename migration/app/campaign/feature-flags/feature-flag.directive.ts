import { Directive, inject, Input, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { LaunchDarklyService } from './launch-darkly.service';

/** `*appFeatureFlag="'campaigns-v2'"` → gates rendering on an LD flag. */
@Directive({ selector: '[appFeatureFlag]', standalone: true })
export class FeatureFlagDirective implements OnInit {
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private launchDarkly = inject(LaunchDarklyService);

  @Input() appFeatureFlag = '';

  ngOnInit(): void {
    if (this.launchDarkly.variation(this.appFeatureFlag)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}
