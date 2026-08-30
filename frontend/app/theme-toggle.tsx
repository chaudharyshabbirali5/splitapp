'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import type { ThemePreference } from '@/lib/theme';

import { useTheme } from './theme-provider';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * Three-state theme control: light | dark | system.
 *
 * Uses the design system's .segment-pill, which styles its selected state from
 * `label:has(:checked)` — so these are real radio inputs, not buttons. That
 * gets correct arrow-key behaviour and screen-reader semantics for free.
 *
 * Built and wired, but deliberately NOT mounted yet: its home is the Profile
 * screen, and Profile is Stage 4. Drop <ThemeToggle /> in there when that stage
 * lands — the mechanism behind it is already live.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <fieldset className="segment-pill grid-cols-3">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => (
        <label key={value}>
          <input
            type="radio"
            name="theme"
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
            className="sr-only"
          />
          <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="mr-1.5" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
