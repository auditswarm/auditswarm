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
        primary: {
          50: '#fef7e6',
          100: '#fdecc0',
          200: '#fbdf95',
          300: '#f9d169',
          400: '#f7c23d',
          500: '#f5b311', // Primary gold/honey
          600: '#c48f0d',
          700: '#936b0a',
          800: '#624706',
          900: '#312403',
        },
        secondary: {
          50: '#fef3e7',
          100: '#fde0c4',
          200: '#fccc9c',
          300: '#fbb674',
          400: '#fa9f4c',
          500: '#f98824', // Orange accent
          600: '#c76c1d',
          700: '#955116',
          800: '#63360e',
          900: '#321b07',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
