import { useTheme } from "@/hooks/use-theme.js";
import type { FC } from "react";
import { LuMoon, LuSun } from "react-icons/lu";

export const ThemeToggle: FC<{ className?: string }> = ({ className }) => {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={className}
      aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
    >
      {resolvedTheme === "dark" ? (
        <LuSun className="h-4 w-4" />
      ) : (
        <LuMoon className="h-4 w-4" />
      )}
    </button>
  );
};
