import { createSelector } from '@ngrx/store';
import { campaignFeature } from './campaign.reducer';

export const { selectCampaigns, selectSelectedId, selectLoading, selectError } = campaignFeature;

export const selectActiveCampaigns = createSelector(selectCampaigns, campaigns => campaigns.filter(c => c.active));

export const selectSelectedCampaign = createSelector(selectCampaigns, selectSelectedId, (campaigns, id) =>
  id == null ? null : (campaigns.find(c => c.id === id) ?? null),
);
