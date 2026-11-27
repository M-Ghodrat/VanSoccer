import React, { useState } from 'react';
import { BUSINESS_CATEGORY_SUGGESTIONS } from '../types';

const PRESET_CATEGORIES: string[] = BUSINESS_CATEGORY_SUGGESTIONS.filter((c) => c !== 'Other');

interface BusinessCategorySelectProps {
  value: string;
  onChange: (nextCategory: string) => void;
  id?: string;
  className?: string;
}

export const BusinessCategorySelect: React.FC<BusinessCategorySelectProps> = ({
  value,
  onChange,
  id,
  className = '',
}) => {
  const trimmed = value.trim();
  const isPreset = trimmed === '' || PRESET_CATEGORIES.includes(trimmed);
  const [explicitOther, setExplicitOther] = useState(trimmed === 'Other' || (!isPreset && trimmed.length > 0));

  const selectValue =
    explicitOther || (!isPreset && trimmed.length > 0) || trimmed === 'Other'
      ? 'Other'
      : trimmed;

  const showCustomInput = selectValue === 'Other';
  const customInputValue = trimmed === 'Other' ? '' : value;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <select
        id={id}
        value={selectValue}
        onChange={(e) => {
          const picked = e.target.value;
          if (picked === 'Other') {
            setExplicitOther(true);
            if (PRESET_CATEGORIES.includes(trimmed) || trimmed === '') {
              onChange('Other');
            }
          } else {
            setExplicitOther(false);
            onChange(picked);
          }
        }}
        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
      >
        <option value="">Select category...</option>
        {PRESET_CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
        <option value="Other">Other (Custom)</option>
      </select>

      {showCustomInput && (
        <input
          type="text"
          maxLength={50}
          value={customInputValue}
          onChange={(e) => onChange(e.target.value || 'Other')}
          placeholder="Enter custom category (optional)"
          className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      )}
    </div>
  );
};
