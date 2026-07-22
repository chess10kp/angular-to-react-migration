// DEMO SHELL — wires i18next, router, mock-API effect, and mounts CampaignListComponent.
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../campaign/i18n/en.json';
import type { ICampaign } from '../campaign/campaign.model';
import { CampaignActions, useCampaignLoading, useStore } from '../campaign/hooks/use-store';
import { CampaignListComponent } from '../campaign/list/campaign-list';

const MOCK_CAMPAIGNS: ICampaign[] = [
  { id: 1, name: 'Spring Launch', slug: 'spring-launch', budget: 50000, active: true, tenantId: 'demo' },
  { id: 2, name: 'Summer Promo', slug: 'summer-promo', budget: 75000, active: true, tenantId: 'demo' },
  { id: 3, name: 'Black Friday', slug: 'black-friday', budget: 120000, active: true, tenantId: 'demo' },
];

await i18next.use(initReactI18next).init({
  resources: { en: { campaign: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Responds to Campaign/Load by returning mock campaigns (replaces NgRx effects).
function MockApiEffect() {
  const { dispatch } = useStore();
  const loading = useCampaignLoading();
  useEffect(() => {
    if (loading) {
      dispatch(CampaignActions.loadSuccess(MOCK_CAMPAIGNS));
    }
  }, [loading, dispatch]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <div className="container mt-4">
        <MockApiEffect />
        <CampaignListComponent />
      </div>
    </BrowserRouter>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
