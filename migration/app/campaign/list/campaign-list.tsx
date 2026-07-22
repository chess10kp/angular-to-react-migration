import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CampaignActions,
  useActiveCampaigns,
  useCampaignLoading,
  useStore,
} from '../hooks/use-store';
import { useTranslocoService } from '../hooks/use-transloco';

export function CampaignListComponent() {
  const store = useStore();
  const transloco = useTranslocoService();
  const campaigns = useActiveCampaigns();
  const loading = useCampaignLoading();
  const { t } = useTranslation('campaign');

  function select(id: number): void {
    store.dispatch(CampaignActions.select(id));
  }

  useEffect(() => {
    store.dispatch(CampaignActions.load());
    const sub = transloco
      .selectTranslate('title')
      .pipe()
      .subscribe((title: string) => {
        document.title = title;
      });
    return () => sub.unsubscribe();
  }, [store, transloco]);

  return (
    <section className="campaign-list">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1>{t('title')}</h1>
        <Link className="btn btn-primary" to="/campaign/new">
          {t('new')}
        </Link>
      </div>

      {loading ? (
        <p className="text-muted">{t('loading')}</p>
      ) : campaigns.length === 0 ? (
        <p className="text-muted">{t('empty')}</p>
      ) : (
        <div className="list-group">
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              type="button"
              className="list-group-item list-group-item-action"
              onClick={() => select(campaign.id)}
            >
              <span className="fw-bold">{campaign.name}</span>
              <span className="badge bg-secondary ms-2">{campaign.budget.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
