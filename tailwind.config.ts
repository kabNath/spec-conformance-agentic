import type { Config } from "tailwindcss";

// Portfolio-matched design system: warm near-white page, dark slate panels,
// mint-green accent, Karma (serif) + Inter (sans). Sober radii, smooth motion.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#1f262b", 2: "#2b333c" },        // page text on light bg
        paper: { DEFAULT: "#f8f5ef", 2: "#fffdf8" },       // warm near-white page
        tint: "#fbf9f4",
        line: { DEFAULT: "#e7e1d4", 2: "#ddd6c6" },        // light-surface borders
        // Dark slate panels (cards / sidebar) — softer than near-black
        panel: { DEFAULT: "#2b333d", 2: "#313945", 3: "#37404c" },
        inkdk: "#f4f3f0",                                  // text on dark panels
        // Brand accent — light blue (conformant verdict stays green, see `green`)
        accent: { DEFAULT: "#6cb6ef", dark: "#2f7dc4", soft: "#e6f1fb" },
        // Semantic verdict colors (distinct hues): green / red / amber
        green: { DEFAULT: "#2F7D5B", soft: "#e6f0e9" },
        redink: { DEFAULT: "#A8432B", soft: "#f6e7e1" },
        amber: { DEFAULT: "#b07d1a", dark: "#8a5f14", soft: "#f7edd6" },
        sky: { DEFAULT: "#3a6db8", soft: "#e3eaf6" },
        mut: { DEFAULT: "#73705F", 2: "#9a9683" },         // page muted (light bg)
        mutdk: "#9aa3ad",                                  // muted on dark panels
        // Phase / category palette
        ph1: "#5B7FA6", ph2: "#7A5FA6", ph3: "#7bdc8f", ph4: "#A8432B", ph5: "#3a8f56", ph6: "#1A6080",
      },
      fontFamily: {
        serif: ['"Karma"', '"Noto Serif TC"', "Georgia", "serif"],
        sans: ['"Inter"', '"Noto Sans TC"', "system-ui", "sans-serif"],
        mono: ['"Inter"', '"Noto Sans TC"', "system-ui", "sans-serif"],
      },
      letterSpacing: { wider2: ".14em", wider3: ".16em" },
      keyframes: {
        pulse2: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        rise: { from: { opacity: "0", transform: "translateY(5px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        heroIn: { from: { opacity: "0", transform: "translateY(22px)" }, to: { opacity: "1", transform: "none" } },
        floatY: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
      },
      animation: {
        "pulse-saff": "pulse2 2s infinite",
        rise: "rise .25s ease both",
        "hero-in": "heroIn .8s cubic-bezier(.2,.7,.2,1) both",
        floaty: "floatY 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
