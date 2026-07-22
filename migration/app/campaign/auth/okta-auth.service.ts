import { Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';
import { OktaAuth } from '@okta/okta-auth-js';

/**
 * Okta auth layer. The real target authenticates via Okta at the `webcore`
 * gateway; token refresh is interceptor-based. Migration target: the Okta
 * React SDK (`@okta/okta-react` + `okta-auth-js`).
 */
@Injectable({ providedIn: 'root' })
export class OktaAuthService {
  private readonly oktaAuth = new OktaAuth({
    issuer: 'https://example.okta.com/oauth2/default',
    clientId: '0oaEXAMPLEclientId',
    redirectUri: `${window.location.origin}/login/callback`,
    scopes: ['openid', 'profile', 'email'],
  });

  getAccessToken(): string | undefined {
    return this.oktaAuth.getAccessToken();
  }

  isAuthenticated(): Observable<boolean> {
    return from(this.oktaAuth.isAuthenticated());
  }

  refresh(): Observable<string | undefined> {
    return from(this.oktaAuth.tokenManager.renew('accessToken').then(t => (t && 'accessToken' in t ? t.accessToken : undefined)));
  }

  async login(): Promise<void> {
    await this.oktaAuth.signInWithRedirect();
  }

  async logout(): Promise<void> {
    await this.oktaAuth.signOut();
  }
}
