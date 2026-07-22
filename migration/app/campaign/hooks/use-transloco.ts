import { useTranslation } from 'react-i18next';

export function useTranslocoService() {
  const { t } = useTranslation('campaign');

  return {
    selectTranslate: (key: string) => ({
      pipe: () => ({
        subscribe: (onValue: (value: string) => void) => {
          onValue(t(key));
          return { unsubscribe: () => undefined };
        },
      }),
    }),
    translate: (key: string) => t(key),
  };
}
