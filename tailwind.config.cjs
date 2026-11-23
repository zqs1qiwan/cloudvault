module.exports = {
  content: ['./public/**/*.{html,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#e0fbff',
          100: '#b3f5ff',
          200: '#80eeff',
          300: '#4de7ff',
          // The dashboard is theme-aware. These accent utilities used to bake in
          // the dark-theme cyan, so every icon or outline written with
          // `text-accent-400` / `border-accent-400` vanished on the light theme.
          400: 'rgb(var(--color-primary-channels) / <alpha-value>)',
          500: 'rgb(var(--color-primary-channels) / <alpha-value>)',
          600: 'rgb(var(--color-primary-strong-channels) / <alpha-value>)',
          700: 'rgb(var(--color-primary-strong-channels) / <alpha-value>)',
          800: 'rgb(var(--color-primary-strong-channels) / <alpha-value>)',
          900: 'rgb(var(--color-primary-strong-channels) / <alpha-value>)',
        },
        warm: '#FFB800',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Noto Sans SC', 'monospace'],
        sans: ['Outfit', 'Noto Sans SC', '-apple-system', 'sans-serif'],
      },
      borderRadius: { sm: '4px', DEFAULT: '6px', md: '8px', lg: '10px', xl: '12px' },
    },
  },
};
