import { useCallback, useSyncExternalStore } from 'react';
import type { CampaignAction } from '../store/campaign.actions';
import { CampaignActions } from '../store/campaign.actions';
import type { CampaignState } from '../store/campaign.selectors';
import {
  selectActiveCampaigns,
  selectLoading,
  selectSelectedCampaign,
} from '../store/campaign.selectors';

let state: CampaignState = {
  campaigns: [],
  loading: false,
  selectedId: null,
  error: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function reduce(current: CampaignState, action: CampaignAction): CampaignState {
  switch (action.type) {
    case 'Campaign/Load':
      return { ...current, loading: true, error: null };
    case 'Campaign/Load Success':
      return { ...current, loading: false, campaigns: action.campaigns };
    case 'Campaign/Load Failure':
      return { ...current, loading: false, error: action.error };
    case 'Campaign/Create Success':
      return { ...current, campaigns: [...current.campaigns, action.campaign] };
    case 'Campaign/Select':
      return { ...current, selectedId: action.id };
    default:
      return current;
  }
}

function dispatch(action: CampaignAction): void {
  state = reduce(state, action);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CampaignState {
  return state;
}

export function useStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    dispatch,
    getState: () => snapshot,
    select: <T>(selector: (s: CampaignState) => T) => selector(snapshot),
  };
}

export function useCampaignSelector<T>(selector: (s: CampaignState) => T): T {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector(snapshot);
}

export function useActiveCampaigns() {
  return useCampaignSelector(selectActiveCampaigns);
}

export function useCampaignLoading() {
  return useCampaignSelector(selectLoading);
}

export function useSelectedCampaign() {
  return useCampaignSelector(selectSelectedCampaign);
}

export { CampaignActions, selectActiveCampaigns, selectLoading };
