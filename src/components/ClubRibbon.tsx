import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  MapPin,
  Megaphone,
  Newspaper,
  Pause,
  Phone,
  Play,
  X,
} from 'lucide-react';
import {
  findPlayerBusinessLogo,
  isRibbonItemLive,
  isValidHexColor,
  normalizeSafeHttpUrl,
  normalizeSafeImageUrl,
  PlayerProfile,
  RibbonConfig,
  RibbonHeight,
  RibbonItem,
  RibbonItemType,
  RibbonSpeed,
  RibbonWidth,
} from '../types';

interface ClubRibbonProps {
  config: RibbonConfig;
  playersById?: Map<string, PlayerProfile>;
  isPreview?: boolean;
}

const TYPE_META: Record<
  RibbonItemType,
  {
    label: string;
    modalAccentText: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }
> = {
  business: {
    label: 'Business',
    modalAccentText: 'text-emerald-700',
    icon: Briefcase,
  },
  news: {
    label: 'News',
    modalAccentText: 'text-sky-700',
    icon: Newspaper,
  },
  announcement: {
    label: 'Announcement',
    modalAccentText: 'text-amber-700',
    icon: Megaphone,
  },
};

// Pixels per second — distinctly different speeds regardless of how many items exist
const SPEED_PX_PER_SEC: Record<RibbonSpeed, number> = {
  slow: 28,
  normal: 64,
  brisk: 98,
  fast: 132,
};

function formatDisplayDomain(safeUrl: string): string {
  return safeUrl.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 15;
  const g = parseInt(clean.slice(2, 4), 16) || 23;
  const b = parseInt(clean.slice(4, 6), 16) || 42;
  return { r, g, b };
}

function isLightHex(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const ClubRibbon: React.FC<ClubRibbonProps> = ({
  config,
  playersById,
  isPreview = false,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [hoveringStatic, setHoveringStatic] = useState(false);
  const [staticIndex, setStaticIndex] = useState(0);
  const [selectedItem, setSelectedItem] = useState<RibbonItem | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [halfTrackWidth, setHalfTrackWidth] = useState<number>(0);

  const firstHalfRef = useRef<HTMLDivElement | null>(null);

  // Refresh live clock every 30s so scheduled/expiring ads toggle automatically
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeItems = useMemo(
    () => (config.items || []).filter((item) => isRibbonItemLive(item, nowMs)),
    [config.items, nowMs]
  );

  // Repeat items enough times per half-track so even 1 ad fills wide screens continuously with zero gap
  const repeatedItems = useMemo(() => {
    if (activeItems.length === 0) return [];
    const repeatCount = Math.max(1, Math.ceil(8 / activeItems.length));
    const list: { item: RibbonItem; copyIdx: number }[] = [];
    for (let c = 0; c < repeatCount; c += 1) {
      for (const item of activeItems) {
        list.push({ item, copyIdx: c });
      }
    }
    return list;
  }, [activeItems]);

  useEffect(() => {
    if (staticIndex >= activeItems.length) {
      setStaticIndex(0);
    }
  }, [activeItems.length, staticIndex]);

  const autoRotateSeconds =
    typeof config.autoRotateSeconds === 'number' && config.autoRotateSeconds > 0
      ? config.autoRotateSeconds
      : 8;

  // Auto-advance static slides on the configured interval
  useEffect(() => {
    if (
      config.mode !== 'static' ||
      activeItems.length <= 1 ||
      paused ||
      hoveringStatic ||
      selectedItem
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setStaticIndex((i) => (i + 1) % activeItems.length);
    }, autoRotateSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [config.mode, activeItems.length, autoRotateSeconds, paused, hoveringStatic, selectedItem]);

  const width: RibbonWidth = config.width || 'full';
  const height: RibbonHeight = config.height || 'standard';
  const direction = config.direction || 'left';
  const borderAccent = Boolean(config.borderAccent);
  const showControls = config.showControls !== false;

  const bgColor = isValidHexColor(config.bgColor) ? config.bgColor : '#0F172A';
  const accentColor = isValidHexColor(config.accentColor) ? config.accentColor : '#10B981';
  const textColor = isValidHexColor(config.textColor) ? config.textColor : '#F8FAFC';

  const lightSurface = isLightHex(bgColor);
  const mutedTextColor = hexWithAlpha(textColor, lightSurface ? 0.68 : 0.74);
  const subtleTextColor = hexWithAlpha(textColor, lightSurface ? 0.52 : 0.56);
  const dividerColor = hexWithAlpha(textColor, lightSurface ? 0.25 : 0.28);
  const cardBgColor = lightSurface ? 'rgba(15, 23, 42, 0.045)' : 'rgba(255, 255, 255, 0.075)';
  const cardBorderColor = borderAccent
    ? hexWithAlpha(accentColor, lightSurface ? 0.35 : 0.32)
    : lightSurface
      ? 'rgba(15, 23, 42, 0.12)'
      : 'rgba(255, 255, 255, 0.12)';
  const sectionBorderColor = borderAccent
    ? hexWithAlpha(accentColor, lightSurface ? 0.45 : 0.4)
    : lightSurface
      ? 'rgba(15, 23, 42, 0.12)'
      : 'rgba(255, 255, 255, 0.1)';

  // Measure half-track width accurately so Slow / Normal / Fast maintain exact pixel-per-second speeds
  useLayoutEffect(() => {
    const el = firstHalfRef.current;
    if (!el || config.mode !== 'moving' || repeatedItems.length === 0) return;

    const updateWidth = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) {
        setHalfTrackWidth(w);
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [config.mode, config.speed, direction, height, width, repeatedItems]);

  if (!config.enabled && !isPreview) {
    return null;
  }

  const isFramed = isPreview || width !== 'full';

  const outerWrapperClass = isPreview
    ? 'mx-auto transition-all duration-200'
    : width === 'full'
      ? 'w-full transition-all duration-200'
      : 'mx-auto px-3 sm:px-6 pt-3 transition-all duration-200';

  const outerWrapperStyle: React.CSSProperties =
    width === 'compact'
      ? isPreview
        ? { width: '58%', minWidth: 'min(100%, 280px)' }
        : { width: '100%', maxWidth: '640px' }
      : width === 'wide'
        ? isPreview
          ? { width: '82%', minWidth: 'min(100%, 320px)' }
          : { width: '100%', maxWidth: '920px' }
        : { width: '100%' };

  const containerPaddingClass =
    height === 'slim'
      ? 'px-3 sm:px-5 py-1.5 min-h-[52px]'
      : height === 'tall'
        ? 'px-3 sm:px-6 py-4 sm:py-5 min-h-[124px] sm:min-h-[136px]'
        : 'px-3 sm:px-6 py-2.5 sm:py-3 min-h-[88px] sm:min-h-[96px]';

  const sectionStyle: React.CSSProperties = {
    backgroundColor: bgColor,
    color: textColor,
    borderTopStyle: borderAccent || isFramed ? 'solid' : 'none',
    borderTopWidth: borderAccent ? '3px' : isFramed ? '1px' : '0px',
    borderTopColor: borderAccent ? accentColor : sectionBorderColor,
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: borderAccent ? hexWithAlpha(accentColor, 0.35) : sectionBorderColor,
    borderLeftStyle: isFramed ? 'solid' : 'none',
    borderLeftWidth: isFramed ? '1px' : '0px',
    borderLeftColor: sectionBorderColor,
    borderRightStyle: isFramed ? 'solid' : 'none',
    borderRightWidth: isFramed ? '1px' : '0px',
    borderRightColor: sectionBorderColor,
  };

  if (activeItems.length === 0) {
    if (!isPreview) return null;
    return (
      <div className={outerWrapperClass} style={outerWrapperStyle}>
        <div
          style={sectionStyle}
          className={`w-full rounded-xl overflow-hidden ${containerPaddingClass} flex items-center justify-center gap-2 text-xs`}
        >
          <span
            style={{ backgroundColor: accentColor }}
            className="w-2 h-2 rounded-full shrink-0"
          />
          <span style={{ color: mutedTextColor }}>
            Add an active, non-expired ad or announcement to preview
          </span>
        </div>
      </div>
    );
  }

  const safeStaticIdx = staticIndex % activeItems.length;
  const currentStaticItem = activeItems[safeStaticIdx];

  const pxPerSec = SPEED_PX_PER_SEC[config.speed] || SPEED_PX_PER_SEC.normal;
  const fallbackWidth = Math.max(1, repeatedItems.length) * 380;
  const effectiveHalfWidth = halfTrackWidth > 0 ? halfTrackWidth : fallbackWidth;
  const durationSeconds = Math.max(4, effectiveHalfWidth / pxPerSec);

  const resolveMedia = (item: RibbonItem) => {
    const linkedPlayer = item.linkedPlayerUid ? playersById?.get(item.linkedPlayerUid) : undefined;
    const rawLogo = item.imageUrl || findPlayerBusinessLogo(linkedPlayer, item.title);
    const safeLogo = rawLogo ? normalizeSafeImageUrl(rawLogo) : '';
    const hasLogo = Boolean(safeLogo) && !failedImages[`logo_${item.id}`];

    const rawOwnerAvatar = linkedPlayer?.approvedPhotoUrl || '';
    const safeOwnerAvatar = rawOwnerAvatar ? normalizeSafeImageUrl(rawOwnerAvatar) : '';
    const hasOwnerAvatar = Boolean(safeOwnerAvatar) && !failedImages[`avatar_${item.id}`];

    const ownerName =
      item.ownerName ||
      (linkedPlayer ? `${linkedPlayer.firstName} ${linkedPlayer.lastName}`.trim() : '');

    return {
      safeLogo: hasLogo ? safeLogo : '',
      safeOwnerAvatar: hasOwnerAvatar ? safeOwnerAvatar : '',
      ownerName,
    };
  };

  const renderThumbnail = (
    item: RibbonItem,
    meta: (typeof TYPE_META)[RibbonItemType],
    sizeClass = 'w-14 h-14'
  ) => {
    const { safeLogo, safeOwnerAvatar, ownerName } = resolveMedia(item);
    const Icon = meta.icon;

    if (safeLogo) {
      return (
        <div
          className={`${sizeClass} rounded-lg bg-white border border-slate-200/80 overflow-hidden shrink-0 flex items-center justify-center p-1`}
        >
          <img
            src={safeLogo}
            alt={item.title}
            referrerPolicy="no-referrer"
            onError={() => setFailedImages((prev) => ({ ...prev, [`logo_${item.id}`]: true }))}
            className="w-full h-full object-contain"
          />
        </div>
      );
    }

    if (item.type === 'business' && safeOwnerAvatar) {
      return (
        <div
          style={{ borderColor: cardBorderColor, backgroundColor: cardBgColor }}
          className={`${sizeClass} rounded-lg border overflow-hidden shrink-0`}
        >
          <img
            src={safeOwnerAvatar}
            alt={ownerName || item.title}
            referrerPolicy="no-referrer"
            onError={() => setFailedImages((prev) => ({ ...prev, [`avatar_${item.id}`]: true }))}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    return (
      <div
        style={{ borderColor: cardBorderColor, backgroundColor: cardBgColor }}
        className={`${sizeClass} rounded-lg border shrink-0 flex items-center justify-center`}
      >
        <Icon
          className={height === 'slim' ? 'w-4 h-4' : 'w-5 h-5 sm:w-6 sm:h-6'}
          style={{ color: accentColor } as React.CSSProperties}
        />
      </div>
    );
  };

  const renderContactLine = (item: RibbonItem, compact = false) => {
    const safeUrl = item.website ? normalizeSafeHttpUrl(item.website) : '';
    const hasContact = Boolean(item.phone || item.address || safeUrl);
    if (!hasContact) return null;

    return (
      <div
        style={{ color: mutedTextColor }}
        className={`flex items-center gap-x-2.5 gap-y-0.5 text-[11px] leading-tight ${
          compact ? 'overflow-hidden whitespace-nowrap' : 'flex-wrap'
        }`}
      >
        {item.phone && (
          <a
            href={`tel:${item.phone.replace(/[^\d+]/g, '')}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: textColor }}
            className="inline-flex items-center gap-1 font-mono-tabular opacity-90 hover:opacity-100 shrink-0"
          >
            <Phone className="w-3 h-3 shrink-0" style={{ color: subtleTextColor }} />
            <span>{item.phone}</span>
          </a>
        )}
        {item.address && (
          <span className="inline-flex items-center gap-1 truncate min-w-0">
            <MapPin className="w-3 h-3 shrink-0" style={{ color: subtleTextColor }} />
            <span className="truncate">{item.address}</span>
          </span>
        )}
        {safeUrl && (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: accentColor }}
            className="inline-flex items-center gap-1 hover:underline font-medium truncate min-w-0"
          >
            <Globe className="w-3 h-3 shrink-0" />
            <span className="truncate">{formatDisplayDomain(safeUrl)}</span>
          </a>
        )}
      </div>
    );
  };

  const renderOwnerInline = (item: RibbonItem) => {
    const { safeOwnerAvatar, ownerName } = resolveMedia(item);
    if (!ownerName) return null;

    return (
      <>
        <span aria-hidden="true" style={{ color: dividerColor }} className="shrink-0">
          ·
        </span>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {safeOwnerAvatar && (
            <img
              src={safeOwnerAvatar}
              alt={ownerName}
              referrerPolicy="no-referrer"
              onError={() => setFailedImages((prev) => ({ ...prev, [`avatar_${item.id}`]: true }))}
              style={{ borderColor: cardBorderColor }}
              className="w-4 h-4 rounded-full object-cover border shrink-0"
            />
          )}
          <span style={{ color: mutedTextColor }} className="truncate">
            {ownerName}
          </span>
        </span>
      </>
    );
  };

  const renderMovingCard = (item: RibbonItem, keyStr: string) => {
    const meta = TYPE_META[item.type] || TYPE_META.announcement;
    const isSlim = height === 'slim';
    const isTall = height === 'tall';

    const cardSizeClasses = isSlim
      ? 'gap-2.5 px-3 py-1.5 min-w-[240px] max-w-[380px]'
      : isTall
        ? 'gap-4 px-4 py-3 min-w-[340px] max-w-[520px]'
        : 'gap-3.5 px-3.5 py-2.5 min-w-[300px] max-w-[460px]';

    const thumbClass = isSlim ? 'w-9 h-9' : isTall ? 'w-16 h-16' : 'w-14 h-14';

    return (
      <div
        key={keyStr}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedItem(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedItem(item);
          }
        }}
        style={{
          backgroundColor: cardBgColor,
          borderColor: cardBorderColor,
        }}
        className={`flex items-center rounded-xl border text-left transition-opacity hover:opacity-95 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${cardSizeClasses}`}
      >
        {renderThumbnail(item, meta, thumbClass)}

        <div className={`min-w-0 flex-1 ${isSlim ? 'space-y-0.5' : 'space-y-1'}`}>
          {!isSlim && (
            <div className="flex items-center gap-1.5 text-[11px] leading-none min-w-0">
              <span style={{ color: accentColor }} className="font-semibold shrink-0">
                {meta.label}
              </span>
              {item.category && (
                <>
                  <span aria-hidden="true" style={{ color: dividerColor }} className="shrink-0">
                    ·
                  </span>
                  <span style={{ color: subtleTextColor }} className="truncate">
                    {item.category}
                  </span>
                </>
              )}
              {renderOwnerInline(item)}
            </div>
          )}

          <div className="flex items-baseline gap-2 min-w-0">
            {isSlim && (
              <span style={{ color: accentColor }} className="text-[10px] font-semibold shrink-0">
                {meta.label}
              </span>
            )}
            <span
              style={{ color: textColor }}
              className={`font-bold truncate leading-snug ${
                isTall ? 'text-base' : isSlim ? 'text-xs' : 'text-sm'
              }`}
            >
              {item.title}
            </span>
          </div>

          {!isSlim && item.text && (
            <div
              style={{ color: mutedTextColor }}
              className={`truncate leading-snug ${isTall ? 'text-sm' : 'text-xs'}`}
            >
              {item.text}
            </div>
          )}

          {isSlim
            ? item.text && (
                <div style={{ color: mutedTextColor }} className="text-[11px] truncate leading-tight">
                  {item.text}
                </div>
              )
            : renderContactLine(item, true)}
        </div>
      </div>
    );
  };

  const selectedMeta = selectedItem ? TYPE_META[selectedItem.type] || TYPE_META.announcement : null;
  const selectedSafeUrl = selectedItem?.website ? normalizeSafeHttpUrl(selectedItem.website) : '';
  const selectedMedia = selectedItem ? resolveMedia(selectedItem) : null;

  const isSlim = height === 'slim';
  const isTall = height === 'tall';
  const staticThumbClass = isSlim
    ? 'w-9 h-9'
    : isTall
      ? 'w-16 h-16 sm:w-[72px] sm:h-[72px]'
      : 'w-14 h-14 sm:w-16 sm:h-16';

  return (
    <>
      <div className={outerWrapperClass} style={outerWrapperStyle}>
        <section
          aria-label="Club Ads and Announcements"
          style={sectionStyle}
          onMouseEnter={() => setHoveringStatic(true)}
          onMouseLeave={() => setHoveringStatic(false)}
          className={`w-full overflow-hidden ${isFramed ? 'rounded-xl shadow-xs' : ''}`}
        >
          <div className={`w-full ${containerPaddingClass} flex items-center justify-between gap-3`}>
            {config.mode === 'moving' ? (
              <>
                <div
                  className={`club-ribbon-marquee flex-1 min-w-0 overflow-hidden ${
                    paused ? 'club-ribbon-paused' : ''
                  }`}
                >
                  <div
                    key={`${config.mode}-${config.speed}-${direction}-${height}-${width}-${activeItems.length}`}
                    className={`club-ribbon-track ${
                      direction === 'right' ? 'club-ribbon-track-reverse' : ''
                    }`}
                    style={{
                      animationDuration: `${durationSeconds.toFixed(2)}s`,
                      animationDirection: direction === 'right' ? 'reverse' : 'normal',
                    }}
                  >
                    {[0, 1].map((dupIndex) => (
                      <div
                        key={dupIndex}
                        ref={dupIndex === 0 ? firstHalfRef : undefined}
                        aria-hidden={dupIndex === 1 || undefined}
                        className="flex items-center gap-4 pr-4 shrink-0"
                      >
                        {repeatedItems.map(({ item, copyIdx }) =>
                          renderMovingCard(item, `${dupIndex}-${copyIdx}-${item.id}`)
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {showControls && (
                  <button
                    type="button"
                    onClick={() => setPaused((p) => !p)}
                    aria-label={paused ? 'Play ribbon' : 'Pause ribbon'}
                    title={paused ? 'Play' : 'Pause'}
                    style={{
                      color: mutedTextColor,
                      borderColor: cardBorderColor,
                      backgroundColor: cardBgColor,
                    }}
                    className="p-2 rounded-lg border hover:opacity-90 transition-opacity shrink-0"
                  >
                    {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const meta = TYPE_META[currentStaticItem.type] || TYPE_META.announcement;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedItem(currentStaticItem)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedItem(currentStaticItem);
                        }
                      }}
                      className="flex-1 min-w-0 flex items-center gap-3.5 sm:gap-4 text-left group rounded-lg py-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2"
                    >
                      {renderThumbnail(currentStaticItem, meta, staticThumbClass)}

                      <div className={`min-w-0 flex-1 ${isSlim ? 'space-y-0.5' : 'space-y-1'}`}>
                        {!isSlim && (
                          <div className="flex items-center gap-1.5 text-[11px] leading-none min-w-0 flex-wrap">
                            <span style={{ color: accentColor }} className="font-semibold shrink-0">
                              {meta.label}
                            </span>
                            {currentStaticItem.category && (
                              <>
                                <span
                                  aria-hidden="true"
                                  style={{ color: dividerColor }}
                                  className="shrink-0"
                                >
                                  ·
                                </span>
                                <span style={{ color: subtleTextColor }} className="truncate">
                                  {currentStaticItem.category}
                                </span>
                              </>
                            )}
                            {renderOwnerInline(currentStaticItem)}
                          </div>
                        )}

                        <div className="flex items-baseline gap-2 min-w-0">
                          {isSlim && (
                            <span
                              style={{ color: accentColor }}
                              className="text-[10px] font-semibold shrink-0"
                            >
                              {meta.label}
                            </span>
                          )}
                          <span
                            style={{ color: textColor }}
                            className={`font-bold group-hover:underline truncate leading-snug ${
                              isTall
                                ? 'text-base sm:text-lg'
                                : isSlim
                                  ? 'text-xs sm:text-sm'
                                  : 'text-sm sm:text-base'
                            }`}
                          >
                            {currentStaticItem.title}
                          </span>
                        </div>

                        {currentStaticItem.text && (
                          <div
                            style={{ color: mutedTextColor }}
                            className={`line-clamp-1 leading-snug ${
                              isTall
                                ? 'text-sm'
                                : isSlim
                                  ? 'text-[11px]'
                                  : 'text-xs sm:text-sm'
                            }`}
                          >
                            {currentStaticItem.text}
                          </div>
                        )}

                        {!isSlim && renderContactLine(currentStaticItem, false)}
                      </div>
                    </div>
                  );
                })()}

                {showControls && activeItems.length > 1 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      style={{ color: subtleTextColor }}
                      className="text-xs font-mono-tabular mr-1 hidden sm:inline"
                    >
                      {safeStaticIdx + 1}/{activeItems.length}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setStaticIndex((i) => (i - 1 + activeItems.length) % activeItems.length)
                      }
                      aria-label="Previous ribbon item"
                      style={{ color: mutedTextColor }}
                      className="p-2 rounded-lg hover:opacity-80 transition-opacity"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setStaticIndex((i) => (i + 1) % activeItems.length)}
                      aria-label="Next ribbon item"
                      style={{ color: mutedTextColor }}
                      className="p-2 rounded-lg hover:opacity-80 transition-opacity"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* Detail Modal on Click */}
      {selectedItem && selectedMeta && selectedMedia && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ribbon-detail-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3.5 min-w-0">
                {selectedMedia.safeLogo && (
                  <div className="w-16 h-16 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1.5">
                    <img
                      src={selectedMedia.safeLogo}
                      alt={selectedItem.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <selectedMeta.icon
                      className={`w-3.5 h-3.5 shrink-0 ${selectedMeta.modalAccentText}`}
                    />
                    <span className={`font-semibold ${selectedMeta.modalAccentText}`}>
                      {selectedMeta.label}
                    </span>
                    {selectedItem.category && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-500">{selectedItem.category}</span>
                      </>
                    )}
                  </div>
                  <h2
                    id="ribbon-detail-title"
                    className="font-display text-xl font-bold text-slate-900 mt-1"
                  >
                    {selectedItem.title}
                  </h2>
                  {selectedMedia.ownerName && (
                    <div className="flex items-center gap-2 mt-1.5">
                      {selectedMedia.safeOwnerAvatar && (
                        <img
                          src={selectedMedia.safeOwnerAvatar}
                          alt={selectedMedia.ownerName}
                          referrerPolicy="no-referrer"
                          className="w-6 h-6 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <span className="text-xs font-medium text-slate-600">
                        {selectedMedia.ownerName}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {selectedItem.text && (
                <p className="text-sm text-slate-700 leading-relaxed">{selectedItem.text}</p>
              )}

              {(selectedItem.phone || selectedSafeUrl || selectedItem.address) && (
                <div className="pt-3 border-t border-slate-100 space-y-2.5 text-xs">
                  {selectedItem.phone && (
                    <a
                      href={`tel:${selectedItem.phone.replace(/[^\d+]/g, '')}`}
                      className="flex items-center gap-2 text-slate-800 hover:text-emerald-700 font-mono-tabular"
                    >
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{selectedItem.phone}</span>
                    </a>
                  )}
                  {selectedItem.address && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{selectedItem.address}</span>
                    </div>
                  )}
                  {selectedSafeUrl && (
                    <a
                      href={selectedSafeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800 font-semibold break-all"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      <span>{formatDisplayDomain(selectedSafeUrl)}</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
