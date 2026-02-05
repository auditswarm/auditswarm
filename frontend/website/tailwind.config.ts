import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0D1B2A',
        primary: {
          DEFAULT: '#F5A623',
          50: '#FEF7E8',
          100: '#FDECC6',
          200: '#FBD98E',
          300: '#F9C656',
          400: '#F7B93C',
          500: '#F5A623',
          600: '#D68C13',
          700: '#A66B0F',
          800: '#764B0A',
          900: '#462C06',
        },
        surface: {
          DEFAULT: '#1B2838',
          light: '#243447',
          dark: '#0D1B2A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hex-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 0l25.98 15v30L30 60 4.02 45V15z' fill='none' stroke='%23F5A623' stroke-opacity='0.03'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};

export default config;
