import { BehaviorSubject, Observable } from 'rxjs';
import { initialize, LDClient, LDFlagSet } from 'launchdarkly-js-client-sdk';

import { AccountService } from 'app/core/auth/account.service';

/**
 * LaunchDarkly feature-flag layer. Migration target: the LaunchDarkly React
 * SDK (`launchdarkly-react-client-sdk` / `useFlags()`), preserving flag keys,
 * targeting context, and default values.
 */

export class LaunchDarklyService {
  private client?: LDClient;
  private flags$ = new BehaviorSubject<LDFlagSet>({});

  constructor(private accountService: AccountService) {
    // MIGRATION_TODO(di): DI: 1 inject() dependency(ies) -> constructor params (accountService: AccountService); wire at construction or via a provider/context
  }

  init(clientSideId: string): void {
    const account = this.accountService.trackCurrentAccount()();
    this.client = initialize(clientSideId, {
      key: account?.login ?? 'anonymous',
      anonymous: !account,
    });
    this.client.on('ready', () => this.flags$.next(this.client!.allFlags()));
    this.client.on('change', () => this.flags$.next(this.client!.allFlags()));
  }

  variation(flagKey: string, defaultValue = false): boolean {
    return this.client ? Boolean(this.client.variation(flagKey, defaultValue)) : defaultValue;
  }

  watch(flagKey: string, defaultValue = false): Observable<boolean> {
    return new Observable<boolean>((sub) => {
      const emit = (): void => sub.next(this.variation(flagKey, defaultValue));
      emit();
      const onChange = (): void => emit();
      this.client?.on('change', onChange);
      return () => this.client?.off('change', onChange);
    });
  }
}
