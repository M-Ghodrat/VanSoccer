import React, { useState } from 'react';

export const CLUB_CREST_URL = '/assets/aistudio/perspolis_crest.png';

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
    persepolis: 'text-[14px] tracking-[0.03em]',
    acronym: 'text-[10px] tracking-[0.04em]',
    society: 'text-[6.5px] tracking-[0.04em] mt-[1.5px]',
  },
  md: {
    crest: 'w-9 h-9',
    gap: 'gap-2.5',
    persepolis: 'text-[17px] tracking-[0.03em]',
    acronym: 'text-[11px] tracking-[0.04em]',
    society: 'text-[7.5px] tracking-[0.04em] mt-[2px]',
  },
  lg: {
    crest: 'w-12 h-12 sm:w-14 sm:h-14',
    gap: 'gap-3',
    persepolis: 'text-[26px] sm:text-[30px] tracking-[0.03em]',
    acronym: 'text-[15px] sm:text-[17px] tracking-[0.04em]',
    society: 'text-[10px] sm:text-[11.5px] tracking-[0.08em] mt-[2.5px]',
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
        <span className={`${cfg.crest} shrink-0 flex items-center justify-center`}>
          <img
            src={CLUB_CREST_URL}
            alt="Persepolis Vancouver Football Club Society (PVFCS) crest"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-contain drop-shadow-sm"
          />
        </span>
      ) : (
        <span
          className={`${cfg.crest} rounded-lg bg-[#a70100] text-white font-display font-bold text-sm flex items-center justify-center shrink-0`}
        >
          P
        </span>
      )}

      {showWordmark && (
        <span className="flex flex-col leading-none min-w-0">
          <span
            className={`font-display font-bold uppercase leading-[0.88] whitespace-nowrap flex items-baseline gap-1 ${cfg.persepolis} ${
              tone === 'dark' ? 'text-[#F87171]' : 'text-[#A70100]'
            }`}
          >
            <span>PERSEPOLIS</span>
            <span
              className={`font-display font-bold ${cfg.acronym} ${
                tone === 'dark' ? 'text-white/90' : 'text-[#1B262C]'
              }`}
            >
              (PVFCS)
            </span>
          </span>
          <span
            className={`font-sans font-bold uppercase leading-none whitespace-nowrap ${cfg.society} ${
              tone === 'dark' ? 'text-white/95' : 'text-[#1B262C]'
            }`}
          >
            VANCOUVER FOOTBALL CLUB SOCIETY
          </span>
        </span>
      )}
    </span>
  );
};
