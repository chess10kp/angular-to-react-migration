import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { CampaignService } from '../campaign.service';
import { CampaignActions } from './campaign.actions';

@Injectable()
export class CampaignEffects {
  private actions$ = inject(Actions);
  private campaignService = inject(CampaignService);

  load$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CampaignActions.load),
      switchMap(() =>
        this.campaignService.query().pipe(
          map(campaigns => CampaignActions.loadSuccess({ campaigns })),
          catchError((err: unknown) => of(CampaignActions.loadFailure({ error: String(err) }))),
        ),
      ),
    ),
  );

  create$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CampaignActions.create),
      switchMap(({ campaign }) =>
        this.campaignService.create(campaign).pipe(map(res => CampaignActions.createSuccess({ campaign: res.body! }))),
      ),
    ),
  );
}
