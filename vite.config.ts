/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { execSync } from 'node:child_process'

function gitInfo() {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim()
    const dirty = execSync('git status --porcelain --untracked-files=no').toString().trim() !== ''
    return { sha, dirty }
  } catch {
    return { sha: 'unknown', dirty: false }
  }
}
const BUILD = { ...gitInfo(), time: new Date().toISOString() }

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'build-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) })
      },
    },
  ],
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          charts: ['recharts'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
