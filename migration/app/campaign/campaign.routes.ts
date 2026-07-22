import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideTranslocoScope } from '@jsverse/transloco';

import { campaignFeature } from './store/campaign.reducer';
import { CampaignEffects } from './store/campaign.effects';
import { canActivateCampaigns } from './campaign.guard';
import { campaignResolver } from './campaign.resolver';

/**
 * Lazy feature routes. Feature-scoped NgRx state/effects and a Transloco scope
 * are provided at the route boundary — the shape the real target uses.
 */
const campaignRoutes: Routes = [
  {
    path: '',
    canActivate: [canActivateCampaigns],
    providers: [provideState(campaignFeature), provideEffects(CampaignEffects), provideTranslocoScope('campaign')],
    children: [
      {
        path: '',
        loadComponent: () => import('./list/campaign-list.component').then(m => m.CampaignListComponent),
      },
      {
        path: 'new',
        loadComponent: () => import('./edit/campaign-edit.component').then(m => m.CampaignEditComponent),
      },
      {
        path: ':id/edit',
        resolve: { campaign: campaignResolver },
        loadComponent: () => import('./edit/campaign-edit.component').then(m => m.CampaignEditComponent),
      },
    ],
  },
];

export default campaignRoutes;
