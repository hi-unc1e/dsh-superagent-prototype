const { heroui } = require('@heroui/react')

module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}', './node_modules/@heroui/react/node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  darkMode: 'class',
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            primary: { DEFAULT: '#2C5A4F', foreground: '#ffffff' },
          },
        },
      },
    }),
  ],
}
