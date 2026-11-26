import React, { useState } from 'react';

export const CLUB_CREST_URL = '/assets/aistudio/Image-1_54f64afd.jpg';

interface ClubBrandMarkProps {
  showWordmark?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'light' | 'dark';
  className?: string;
}

const SIZE_CONFIG = {
  sm: {
    crest: 'w-7 h-7',
    gap: 'gap-2',
    perspolis: 'text-[16px] tracking-[0.03em]',
    vancouver: 'text-[8px] tracking-[0.18em] mt-[1px]',
  },
  md: {
    crest: 'w-9 h-9',
    gap: 'gap-2',
    perspolis: 'text-[19px] tracking-[0.03em]',
    vancouver: 'text-[9px] tracking-[0.18em] mt-[1px]',
  },
  lg: {
    crest: 'w-12 h-12 sm:w-14 sm:h-14',
    gap: 'gap-3',
    perspolis: 'text-[28px] sm:text-[32px] tracking-[0.03em]',
    vancouver: 'text-[13px] sm:text-[15px] tracking-[0.18em] mt-[2px]',
  },
} as const;

export const ClubBrandMark: React.FC<ClubBrandMarkProps> = ({
  showWordmark = true,
  size = 'md',
  tone = 'light',
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const cfg = SIZE_CONFIG[size];

  return (
    <span className={`inline-flex items-center ${cfg.gap} min-w-0 select-none ${className}`}>
      {!imgFailed ? (
        <span
          className={`${cfg.crest} shrink-0 flex items-center justify-center overflow-hidden ${
            tone === 'dark' ? 'rounded-lg bg-white p-0.5 shadow-sm' : ''
          }`}
        >
          <img
            src={CLUB_CREST_URL}
            alt="Perspolis Vancouver crest"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`w-full h-full object-contain ${
              tone === 'light' ? 'mix-blend-multiply' : ''
            }`}
          />
        </span>
      ) : (
        <span
          className={`${cfg.crest} rounded-md bg-[#C81018] text-white font-display font-bold text-sm flex items-center justify-center shrink-0`}
        >
          P
        </span>
      )}

      {showWordmark && (
        <span className="flex flex-col leading-none min-w-0">
          <span
            className={`font-display font-bold uppercase leading-[0.86] whitespace-nowrap ${cfg.perspolis} ${
              tone === 'dark' ? 'text-[#F87171]' : 'text-[#C81018]'
            }`}
          >
            PERSPOLIS
          </span>
          <span
            className={`font-sans font-bold uppercase leading-none whitespace-nowrap ${cfg.vancouver} ${
              tone === 'dark' ? 'text-white/95' : 'text-[#1B262C]'
            }`}
          >
            VANCOUVER
          </span>
        </span>
      )}
    </span>
  );
};
