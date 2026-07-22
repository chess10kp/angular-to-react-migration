import type { ICampaign, NewCampaign } from '../campaign.model';

export const CampaignActions = {
  load: () => ({ type: 'Campaign/Load' as const }),
  loadSuccess: (campaigns: ICampaign[]) => ({
    type: 'Campaign/Load Success' as const,
    campaigns,
  }),
  loadFailure: (error: string) => ({ type: 'Campaign/Load Failure' as const, error }),
  create: (campaign: NewCampaign) => ({ type: 'Campaign/Create' as const, campaign }),
  createSuccess: (campaign: ICampaign) => ({
    type: 'Campaign/Create Success' as const,
    campaign,
  }),
  select: (id: number) => ({ type: 'Campaign/Select' as const, id }),
};

export type CampaignAction = ReturnType<
  (typeof CampaignActions)[keyof typeof CampaignActions]
>;
