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
          400: '#00E5FF',
          500: '#00E5FF',
          600: '#00b8cc',
          700: '#008a99',
          800: '#005d66',
          900: '#002f33',
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
