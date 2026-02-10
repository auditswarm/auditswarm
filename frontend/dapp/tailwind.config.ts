import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
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
        secondary: {
          50: '#fef3e7',
          100: '#fde0c4',
          200: '#fccc9c',
          300: '#fbb674',
          400: '#fa9f4c',
          500: '#f98824',
          600: '#c76c1d',
          700: '#955116',
          800: '#63360e',
          900: '#321b07',
        },
        surface: {
          DEFAULT: '#1B2838',
          light: '#243447',
          dark: '#0D1B2A',
        },
      },
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
        display: ['Syne', 'system-ui', 'sans-serif'],
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
