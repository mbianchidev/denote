import type { CSSProperties } from "react";
import type { PluginAuthoringColor, PluginSourceEdit, PluginTextStyle } from "@denote/plugin-sdk";

export interface AuthoringSelection {
  source: string;
  from: number;
  to: number;
  restore: () => void;
  apply?: (edit: PluginSourceEdit, next: string) => boolean;
}

export interface AuthoringEditorBinding {
  styles: () => { source: string; spans: PluginTextStyle[] } | null;
  registerSelection: (capture: () => AuthoringSelection | null) => () => void;
  registerEdit: (apply: (edit: PluginSourceEdit, next: string) => boolean) => () => void;
  sourcePreparation: { current: ((source: string) => void) | null };
}

export const TEXT_STYLE_PALETTE = {
  yellow: {
    dark: { background: "#67562a", ink: "#fff4d0", foreground: "#f2d87c" },
    light: { background: "#fff0b3", ink: "#3d2c00", foreground: "#725600" },
  },
  red: {
    dark: { background: "#613c40", ink: "#ffe4e5", foreground: "#ffb4bd" },
    light: { background: "#ffdce0", ink: "#6e1830", foreground: "#9b2643" },
  },
  green: {
    dark: { background: "#2f5547", ink: "#e0fff0", foreground: "#add7bc" },
    light: { background: "#d7f0df", ink: "#174b31", foreground: "#276344" },
  },
  blue: {
    dark: { background: "#304b65", ink: "#e2f1ff", foreground: "#a9cdf1" },
    light: { background: "#dcecff", ink: "#173e64", foreground: "#285f91" },
  },
  purple: {
    dark: { background: "#503f68", ink: "#f4e7ff", foreground: "#d7bcf1" },
    light: { background: "#eedfff", ink: "#4a2666", foreground: "#6e3e91" },
  },
} satisfies Record<PluginAuthoringColor, Record<"dark" | "light", {
  background: string; ink: string; foreground: string;
}>>;

export function textStyleVariables(color: PluginAuthoringColor): CSSProperties {
  const palette = TEXT_STYLE_PALETTE[color];
  return {
    "--style-dark-bg": palette.dark.background, "--style-dark-ink": palette.dark.ink,
    "--style-light-bg": palette.light.background, "--style-light-ink": palette.light.ink,
    "--style-dark-foreground": palette.dark.foreground, "--style-light-foreground": palette.light.foreground,
  } as CSSProperties;
}
