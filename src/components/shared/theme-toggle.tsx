"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const themes = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Laptop },
];

const subscribe = () => () => undefined;

export function ThemeToggle() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { theme, setTheme } = useTheme();

  if (!mounted) {
    return <div className="size-9 rounded-lg border border-border bg-muted" />;
  }

  const currentIndex = Math.max(
    0,
    themes.findIndex((item) => item.value === theme),
  );
  const current = themes[currentIndex];
  const Icon = current.icon;

  function cycleTheme() {
    setTheme(themes[(currentIndex + 1) % themes.length].value);
  }

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-foreground-muted transition-colors hover:bg-muted hover:text-foreground"
      aria-label={`Tema: ${current.label}. Cambiar tema`}
      title={`Tema: ${current.label}`}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
