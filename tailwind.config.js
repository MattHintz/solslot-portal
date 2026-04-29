/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#020b0b',
          2: '#031615',
        },
        surface: 'rgba(255,255,255,0.04)',
        brand: {
          DEFAULT: '#7cffb2',
          2: '#00d3a7',
          3: '#2ce7ff',
          soft: 'rgba(124,255,178,0.12)',
        },
        text: {
          DEFAULT: '#eafff7',
          muted: 'rgba(234,255,247,0.7)',
        },
        border: 'rgba(234,255,247,0.14)',
      },
      fontFamily: {
        sans: [
          'Space Grotesk',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        display: ['Fraunces', 'Times New Roman', 'Times', 'serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        soft: '0 24px 70px rgba(0,0,0,0.55)',
        tight: '0 14px 34px rgba(0,0,0,0.45)',
        glow: '0 22px 66px rgba(124,255,178,0.12)',
      },
      borderRadius: {
        pill: '999px',
        card: '18px',
      },
      maxWidth: {
        container: '1200px',
      },
    },
  },
  plugins: [],
};
