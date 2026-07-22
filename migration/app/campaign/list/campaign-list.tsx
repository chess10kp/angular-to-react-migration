import { useEffect } from 'react';

export function CampaignListComponent() {
  const store = useStore(); // MIGRATION_TODO(di): was inject(Store); create this hook (or a context provider) for the ported service.
  const transloco = useTranslocoService(); // MIGRATION_TODO(di): was inject(TranslocoService); create this hook (or a context provider) for the ported service.
  const campaigns = this.store.select(selectActiveCampaigns);
  const loading = this.store.select(selectLoading);
  function select(id: number): void {
    store.dispatch(CampaignActions.select({ id }));
  }
  // MIGRATION_TODO(effect): ngOnInit -> mount effect; verify deps ([]). unresolved `this.destroy$` (known-token API call or unknown member — rewire by hand)
  // MIGRATION_TODO(rxjs): 1 .subscribe() call(s) here — keep each Subscription and call .unsubscribe() in the returned cleanup (that IS the ngOnDestroy teardown).
  useEffect(() => {
    store.dispatch(CampaignActions.load());
    transloco
      .selectTranslate('campaign.title')
      .pipe(takeUntil(this.destroy$))
      .subscribe((title) => (document.title = title));
  }, []);

  return (
    <>{/* MIGRATION_TODO: structural directive/*transloco not deterministically supported */}</>
  );
}
