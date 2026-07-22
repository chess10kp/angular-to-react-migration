import { inject, Injectable } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { catchError, Observable, switchMap, throwError } from 'rxjs';

import { OktaAuthService } from './okta-auth.service';

/**
 * Attaches the Okta bearer token and refreshes it once on 401. This is the
 * interceptor the migration replicates as a single Axios request/response
 * interceptor pair on the shared instance.
 */
@Injectable()
export class OktaInterceptor implements HttpInterceptor {
  private oktaAuth = inject(OktaAuthService);

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const token = this.oktaAuth.getAccessToken();
    const authorized = token ? this.withToken(request, token) : request;

    return next.handle(authorized).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && token) {
          return this.oktaAuth.refresh().pipe(switchMap(fresh => next.handle(this.withToken(request, fresh ?? ''))));
        }
        return throwError(() => error);
      }),
    );
  }

  private withToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
}
