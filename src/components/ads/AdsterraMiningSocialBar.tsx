import { useEffect } from 'react';

/**
 * Loads the Adsterra Social Bar only while the mining home tab is mounted.
 * This is a display-only ad unit: it is not connected to YT Coin rewards,
 * ad claims, clicks, or tracking callbacks.
 */
export function AdsterraMiningSocialBar() {
  useEffect(() => {
    const marker = 'data-yementask-adsterra-socialbar';
    const existing = document.querySelector(`script[${marker}="true"]`);
    if (existing) return;

    const script = document.createElement('script');
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.setAttribute(marker, 'true');
    script.src = 'https://bauval.org/14/df85fec7cf4e0f5cf87b135ab4f1bcd3';
    document.body.appendChild(script);

    return () => {
      // Remove only our loader. Do not remove Adsterra-created page elements,
      // since the provider may still be cleaning up asynchronous requests.
      script.remove();
    };
  }, []);

  return null;
}
