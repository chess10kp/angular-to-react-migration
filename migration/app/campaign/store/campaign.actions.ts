import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { ICampaign, NewCampaign } from '../campaign.model';

export const CampaignActions = createActionGroup({
  source: 'Campaign',
  events: {
    Load: emptyProps(),
    'Load Success': props<{ campaigns: ICampaign[] }>(),
    'Load Failure': props<{ error: string }>(),
    Create: props<{ campaign: NewCampaign }>(),
    'Create Success': props<{ campaign: ICampaign }>(),
    Select: props<{ id: number }>(),
  },
});
