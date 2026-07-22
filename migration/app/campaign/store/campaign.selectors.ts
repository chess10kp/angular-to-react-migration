import type { ICampaign } from '../campaign.model';

export interface CampaignState {
  campaigns: ICampaign[];
  loading: boolean;
  selectedId: number | null;
  error: string | null;
}

export const selectCampaigns = (state: CampaignState): ICampaign[] => state.campaigns;
export const selectLoading = (state: CampaignState): boolean => state.loading;
export const selectSelectedId = (state: CampaignState): number | null => state.selectedId;

export const selectActiveCampaigns = (state: CampaignState): ICampaign[] =>
  state.campaigns.filter((c) => c.active);

export const selectSelectedCampaign = (state: CampaignState): ICampaign | null => {
  const id = state.selectedId;
  if (id == null) return null;
  return state.campaigns.find((c) => c.id === id) ?? null;
};
