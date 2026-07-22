import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function useTranslocoService() {
  const { t } = useTranslation('campaign');

  // Memoize so callers that put `transloco` in useEffect deps don't loop on every render.
  return useMemo(() => ({
    selectTranslate: (key: string) => ({
      pipe: () => ({
        subscribe: (onValue: (value: string) => void) => {
          onValue(t(key));
          return { unsubscribe: () => undefined };
        },
      }),
    }),
    translate: (key: string) => t(key),
  }), [t]);
}
