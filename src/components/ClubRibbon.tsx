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
  normalizeSafeHttpUrl,
  normalizeSafeImageUrl,
  PlayerProfile,
  RibbonConfig,
  RibbonItem,
  RibbonItemType,
  RibbonSpeed,
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
    accentText: string;
    modalAccentText: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  business: {
    label: 'Business',
    accentText: 'text-emerald-300',
    modalAccentText: 'text-emerald-700',
    icon: Briefcase,
  },
  news: {
    label: 'News',
    accentText: 'text-sky-300',
    modalAccentText: 'text-sky-700',
    icon: Newspaper,
  },
  announcement: {
    label: 'Announcement',
    accentText: 'text-amber-300',
    modalAccentText: 'text-amber-700',
    icon: Megaphone,
  },
};

// Pixels per second — distinctly different speeds regardless of how many items exist
const SPEED_PX_PER_SEC: Record<RibbonSpeed, number> = {
  slow: 28,
  normal: 64,
  fast: 132,
};

function formatDisplayDomain(safeUrl: string): string {
  return safeUrl.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
}

export const ClubRibbon: React.FC<ClubRibbonProps> = ({
  config,
  playersById,
  isPreview = false,
}) => {
  const activeItems = useMemo(
    () => (config.items || []).filter((item) => item.active && item.title.trim().length > 0),
    [config.items]
  );

  const [paused, setPaused] = useState(false);
  const [staticIndex, setStaticIndex] = useState(0);
  const [selectedItem, setSelectedItem] = useState<RibbonItem | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [halfTrackWidth, setHalfTrackWidth] = useState<number>(0);

  const firstHalfRef = useRef<HTMLDivElement | null>(null);

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
  }, [config.mode, config.speed, repeatedItems]);

  if (!config.enabled && !isPreview) {
    return null;
  }

  if (activeItems.length === 0) {
    if (!isPreview) return null;
    return (
      <div className="w-full bg-slate-900 text-slate-400 border border-slate-800 rounded-xl px-5 min-h-[86px] flex items-center justify-center text-xs">
        Add an active item to preview the ribbon
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
    const rawLogo = item.imageUrl || linkedPlayer?.business?.logoUrl || '';
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
          className={`${sizeClass} rounded-lg bg-slate-800 border border-slate-700/80 overflow-hidden shrink-0`}
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
        className={`${sizeClass} rounded-lg bg-slate-800 border border-slate-700/80 shrink-0 flex items-center justify-center`}
      >
        <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${meta.accentText}`} />
      </div>
    );
  };

  const renderContactLine = (item: RibbonItem, compact = false) => {
    const safeUrl = item.website ? normalizeSafeHttpUrl(item.website) : '';
    const hasContact = Boolean(item.phone || item.address || safeUrl);
    if (!hasContact) return null;

    return (
      <div
        className={`flex items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-300 leading-tight ${
          compact ? 'overflow-hidden whitespace-nowrap' : 'flex-wrap'
        }`}
      >
        {item.phone && (
          <a
            href={`tel:${item.phone.replace(/[^\d+]/g, '')}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 font-mono-tabular text-slate-200 hover:text-white shrink-0"
          >
            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
            <span>{item.phone}</span>
          </a>
        )}
        {item.address && (
          <span className="inline-flex items-center gap-1 text-slate-300 truncate min-w-0">
            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="truncate">{item.address}</span>
          </span>
        )}
        {safeUrl && (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 hover:underline font-medium truncate min-w-0"
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
        <span aria-hidden="true" className="text-slate-600 shrink-0">
          ·
        </span>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {safeOwnerAvatar && (
            <img
              src={safeOwnerAvatar}
              alt={ownerName}
              referrerPolicy="no-referrer"
              onError={() => setFailedImages((prev) => ({ ...prev, [`avatar_${item.id}`]: true }))}
              className="w-4 h-4 rounded-full object-cover border border-slate-600 shrink-0"
            />
          )}
          <span className="text-slate-300 truncate">{ownerName}</span>
        </span>
      </>
    );
  };

  const renderMovingCard = (item: RibbonItem, keyStr: string) => {
    const meta = TYPE_META[item.type] || TYPE_META.announcement;

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
        className="flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/75 text-left transition-colors shrink-0 min-w-[300px] max-w-[460px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        {renderThumbnail(item, meta, 'w-14 h-14')}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] leading-none min-w-0">
            <span className={`font-semibold shrink-0 ${meta.accentText}`}>{meta.label}</span>
            {item.category && (
              <>
                <span aria-hidden="true" className="text-slate-600 shrink-0">
                  ·
                </span>
                <span className="text-slate-400 truncate">{item.category}</span>
              </>
            )}
            {renderOwnerInline(item)}
          </div>

          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-sm font-bold text-white truncate leading-snug">
              {item.title}
            </span>
          </div>

          {item.text && (
            <div className="text-xs text-slate-300 truncate leading-snug">{item.text}</div>
          )}

          {renderContactLine(item, true)}
        </div>
      </div>
    );
  };

  const selectedMeta = selectedItem ? TYPE_META[selectedItem.type] || TYPE_META.announcement : null;
  const selectedSafeUrl = selectedItem?.website ? normalizeSafeHttpUrl(selectedItem.website) : '';
  const selectedMedia = selectedItem ? resolveMedia(selectedItem) : null;

  return (
    <>
      <section
        aria-label="Club Ribbon"
        className={`w-full bg-slate-900 text-slate-100 border-b border-slate-800 ${
          isPreview ? 'rounded-xl border overflow-hidden' : ''
        }`}
      >
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 min-h-[92px] sm:min-h-[98px] flex items-center justify-between gap-3">
          {config.mode === 'moving' ? (
            <>
              <div
                className={`club-ribbon-marquee flex-1 min-w-0 overflow-hidden ${
                  paused ? 'club-ribbon-paused' : ''
                }`}
              >
                <div
                  key={`${config.speed}-${activeItems.length}`}
                  className="club-ribbon-track"
                  style={{
                    animationDuration: `${durationSeconds.toFixed(2)}s`,
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

              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? 'Play ribbon' : 'Pause ribbon'}
                title={paused ? 'Play' : 'Pause'}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-colors shrink-0"
              >
                {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
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
                    className="flex-1 min-w-0 flex items-center gap-3.5 sm:gap-4 text-left group rounded-lg py-0.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    {renderThumbnail(currentStaticItem, meta, 'w-14 h-14 sm:w-16 sm:h-16')}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] leading-none min-w-0 flex-wrap">
                        <span className={`font-semibold shrink-0 ${meta.accentText}`}>
                          {meta.label}
                        </span>
                        {currentStaticItem.category && (
                          <>
                            <span aria-hidden="true" className="text-slate-600 shrink-0">
                              ·
                            </span>
                            <span className="text-slate-400 truncate">
                              {currentStaticItem.category}
                            </span>
                          </>
                        )}
                        {renderOwnerInline(currentStaticItem)}
                      </div>

                      <div className="text-sm sm:text-base font-bold text-white group-hover:underline truncate leading-snug">
                        {currentStaticItem.title}
                      </div>

                      {currentStaticItem.text && (
                        <div className="text-xs sm:text-sm text-slate-300 line-clamp-1 leading-snug">
                          {currentStaticItem.text}
                        </div>
                      )}

                      {renderContactLine(currentStaticItem, false)}
                    </div>
                  </div>
                );
              })()}

              {activeItems.length > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs font-mono-tabular text-slate-400 mr-1 hidden sm:inline">
                    {safeStaticIdx + 1}/{activeItems.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setStaticIndex((i) => (i - 1 + activeItems.length) % activeItems.length)
                    }
                    aria-label="Previous ribbon item"
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaticIndex((i) => (i + 1) % activeItems.length)}
                    aria-label="Next ribbon item"
                    className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

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
