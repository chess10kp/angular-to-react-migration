import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ICampaign } from './campaign.model';
import { CampaignService } from './campaign.service';

/**
 * Resolver that preloads a campaign before the edit route activates.
 * Migration target: a React Router `loader`.
 */
export const campaignResolver: ResolveFn<ICampaign | null> = (route): Observable<ICampaign | null> => {
  const id = route.paramMap.get('id');
  if (!id) {
    return of(null);
  }
  return inject(CampaignService)
    .find(Number(id))
    .pipe(
      map(res => res.body),
      catchError(() => of(null)),
    );
};
