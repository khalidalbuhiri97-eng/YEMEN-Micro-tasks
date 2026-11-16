import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { Eye, Loader2, Image as ImageIcon } from 'lucide-react';

interface SecureImageViewProps {
  storagePathOrUrl: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
}

export const SecureImageView: React.FC<SecureImageViewProps> = ({
  storagePathOrUrl,
  alt = 'صورة الإثبات',
  className = 'w-full h-40 object-cover rounded-xl',
  onClick,
}) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (!storagePathOrUrl) return;

    // If it's already an http/https URL or safe raster base64 data URL, use it directly
    if (/^(https?:\/\/|data:image\/(?:png|jpeg|jpg|webp);base64,)/i.test(storagePathOrUrl)) {
      setSignedUrl(storagePathOrUrl);
      return;
    }

    // Otherwise, it's a secure storage path. Fetch signed view URL.
    const fetchSignedUrl = async () => {
      setIsLoading(true);
      setHasError(false);
      try {
        const res = storagePathOrUrl.startsWith('advertiser-logos/')
          ? await api.getPublicAdvertiserLogoUrl(storagePathOrUrl)
          : await api.getViewSignedUrl(storagePathOrUrl);
        if (isMounted && res?.signedUrl) {
          setSignedUrl(res.signedUrl);
        } else {
          setHasError(true);
        }
      } catch (err) {
        if (isMounted) setHasError(true);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSignedUrl();

    // Refresh signed URL every 45 minutes before 1-hour expiration
    const interval = setInterval(fetchSignedUrl, 45 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [storagePathOrUrl]);

  if (isLoading && !signedUrl) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 dark:bg-slate-800 animate-pulse ${className}`}>
        <Loader2 className="w-5 h-5 text-emerald-600 animate-spin" />
      </div>
    );
  }

  if (hasError || !signedUrl) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400 gap-1 ${className}`}>
        <ImageIcon className="w-6 h-6" />
        <span className="text-[10px]">تعذر تحميل الصورة</span>
      </div>
    );
  }

  return (
    <img
      src={signedUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onClick={onClick}
      onError={() => setHasError(true)}
    />
  );
};
