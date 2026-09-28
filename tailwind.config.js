export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {
    fontFamily: { sans: ['Jost', 'Inter', 'sans-serif'], ui: ['Inter', 'Arial', 'sans-serif'], serif: ['Cormorant Garamond', 'Georgia', 'serif'] },
    colors: { brand: { green: '#166a3a', soft: '#326a41', yellow: '#dfbf0a', gold: '#d8be3f', red: '#ff0000', badge: '#ff5722', ink: '#121212' } },
    maxWidth: { page: '1600px' },
  } },
  plugins: [],
}
