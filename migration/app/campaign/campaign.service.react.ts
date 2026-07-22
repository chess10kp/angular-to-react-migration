import { HttpClient, HttpResponse } from '@angular/common/http';
import { map, Observable } from 'rxjs';

import { ApplicationConfigService } from 'app/core/config/application-config.service';
import { createRequestOption } from 'app/core/request/request-util';
import { ICampaign, NewCampaign } from './campaign.model';

export type EntityResponseType = HttpResponse<ICampaign>;
export type EntityArrayResponseType = HttpResponse<ICampaign[]>;

/**
 * Hand-written service layer (the real target's "api client" is many services
 * shaped exactly like this) — not an OpenAPI-generated client.
 */

export class CampaignService {
  protected resourceUrl = this.applicationConfigService.getEndpointFor('api/campaigns');

  constructor(
    protected http: HttpClient,
    protected applicationConfigService: ApplicationConfigService,
  ) {}

  create(campaign: NewCampaign): Observable<EntityResponseType> {
    return this.http.post<ICampaign>(this.resourceUrl, campaign, { observe: 'response' });
  }

  update(campaign: ICampaign): Observable<EntityResponseType> {
    return this.http.put<ICampaign>(`${this.resourceUrl}/${campaign.id}`, campaign, {
      observe: 'response',
    });
  }

  find(id: number): Observable<EntityResponseType> {
    return this.http.get<ICampaign>(`${this.resourceUrl}/${id}`, { observe: 'response' });
  }

  query(req?: Record<string, unknown>): Observable<ICampaign[]> {
    const options = createRequestOption(req);
    return this.http
      .get<ICampaign[]>(this.resourceUrl, { params: options, observe: 'response' })
      .pipe(map((res: EntityArrayResponseType) => res.body ?? []));
  }

  delete(id: number): Observable<HttpResponse<{}>> {
    return this.http.delete(`${this.resourceUrl}/${id}`, { observe: 'response' });
  }
}
