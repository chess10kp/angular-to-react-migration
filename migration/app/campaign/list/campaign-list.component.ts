import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { takeUntil } from 'rxjs/operators';

import { DestroyableComponent } from '../shared/base.component';
import { HasPermissionDirective } from '../shared/has-permission.directive';
import { FeatureFlagDirective } from '../feature-flags/feature-flag.directive';
import { CampaignActions } from '../store/campaign.actions';
import { selectActiveCampaigns, selectLoading } from '../store/campaign.selectors';

@Component({
  selector: 'app-campaign-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslocoModule, HasPermissionDirective, FeatureFlagDirective],
  templateUrl: './campaign-list.component.html',
})
export class CampaignListComponent extends DestroyableComponent implements OnInit {
  private store = inject(Store);
  private transloco = inject(TranslocoService);

  readonly campaigns = this.store.select(selectActiveCampaigns);
  readonly loading = this.store.select(selectLoading);

  ngOnInit(): void {
    this.store.dispatch(CampaignActions.load());
    this.transloco
      .selectTranslate('campaign.title')
      .pipe(takeUntil(this.destroy$))
      .subscribe(title => (document.title = title));
  }

  select(id: number): void {
    this.store.dispatch(CampaignActions.select({ id }));
  }
}
