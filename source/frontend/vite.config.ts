import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite configuration for React frontend (HMR + TSX transform).
export default defineConfig({
  plugins: [react()],
})
