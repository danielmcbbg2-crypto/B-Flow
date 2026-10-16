/** @type {import('tailwindcss').Config} */
// Brand: nextphasemaintenance.com.au — orange #FE5520 with black type on light grey (#F7F7F7),
// square corners, Roboto headings and an Avenir-style body (Nunito Sans).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Square corners everywhere, like the website. `full` stays for dots and progress bars.
    borderRadius: {
      none: '0',
      sm: '0',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      full: '9999px',
    },
    extend: {
      fontFamily: {
        sans: ['"Nunito Sans"', 'Avenir', '"Avenir Next"', 'system-ui', 'sans-serif'],
        display: ['Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Neutral greys instead of Tailwind's blue-tinted slate, so every existing `slate-*` class follows the brand.
        slate: {
          50: '#F7F7F7',
          100: '#EFEFEF',
          200: '#E2E2E2',
          300: '#CFCFCF',
          400: '#A3A3A3',
          500: '#6E6E6E',
          600: '#4F4F4F',
          700: '#383838',
          800: '#1F1F1F',
          900: '#000000',
        },
        accent: {
          DEFAULT: '#FE5520',
          dark: '#E2460F',
          // Darker orange for small text on white/grey (meets 4.5:1 contrast).
          ink: '#C93D10',
          soft: '#FFF1EB',
          // Visually the same orange, nudged to clear 3:1 for large headings on the #F7F7F7 background.
          heading: '#FC5420',
          amber: '#D97706',
        },
      },
    },
  },
  plugins: [],
}
