'use client';

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';

type Themes = 'system' | 'light' | 'dark';
export const ThemeContext = createContext<{
  theme: Themes;
  handleThemeChange: (theme: Themes) => void;
}>({ theme: 'light', handleThemeChange: () => {} });

const LS_THEME_KEY = 'theme';

function getInitialTheme(): Themes {
  if (typeof window === 'undefined') return 'light';
  return (localStorage.getItem(LS_THEME_KEY) as Themes) || 'light';
}

export function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Themes>(getInitialTheme);

  const applyThemeToDOM = useCallback((themeValue: Themes) => {
    if (themeValue === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (themeValue === 'system' && window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const handleThemeChange = useCallback(
    (themeValue: Themes) => {
      localStorage.setItem(LS_THEME_KEY, themeValue);
      setTheme(themeValue);
      applyThemeToDOM(themeValue);
    },
    [applyThemeToDOM],
  );

  const value = useMemo(() => ({ theme, handleThemeChange }), [theme, handleThemeChange]);

  // Sync DOM on mount — the inline script in <head> already set the correct class,
  // so this just ensures React state matches. No visible flash will occur.
  useEffect(() => {
    const savedTheme = (localStorage.getItem(LS_THEME_KEY) as Themes) || 'light';
    setTheme(savedTheme);
    applyThemeToDOM(savedTheme);
  }, [applyThemeToDOM]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
