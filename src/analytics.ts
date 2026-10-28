import { inject } from '@vercel/analytics';

type Metrika = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

export function initializeAnalytics(): void {
  if (!import.meta.env.PROD || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;

  if (import.meta.env.VERCEL) inject({ mode: 'production' });

  const target = window as Window & { ym?: Metrika };
  target.ym ??= Object.assign((...args: unknown[]) => { target.ym!.a!.push(args); }, {
    a: [] as unknown[][],
    l: Date.now(),
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js?id=112333245';
  document.head.append(script);
  target.ym(112333245, 'init', {
    ssr: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });
}
