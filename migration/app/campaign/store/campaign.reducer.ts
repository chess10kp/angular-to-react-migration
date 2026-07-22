import { createFeature, createReducer, on } from '@ngrx/store';
import { ICampaign } from '../campaign.model';
import { CampaignActions } from './campaign.actions';

export interface CampaignState {
  campaigns: ICampaign[];
  selectedId: number | null;
  loading: boolean;
  error: string | null;
}

export const initialCampaignState: CampaignState = {
  campaigns: [],
  selectedId: null,
  loading: false,
  error: null,
};

export const campaignFeature = createFeature({
  name: 'campaign',
  reducer: createReducer(
    initialCampaignState,
    on(CampaignActions.load, state => ({ ...state, loading: true, error: null })),
    on(CampaignActions.loadSuccess, (state, { campaigns }) => ({ ...state, loading: false, campaigns })),
    on(CampaignActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
    on(CampaignActions.createSuccess, (state, { campaign }) => ({ ...state, campaigns: [...state.campaigns, campaign] })),
    on(CampaignActions.select, (state, { id }) => ({ ...state, selectedId: id })),
  ),
});
