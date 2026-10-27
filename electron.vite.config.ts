import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { externalizeDepsPlugin } from 'electron-vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    main: {
      define: {
        'process.env.GITHUB_CLIENT_ID': JSON.stringify(env.GITHUB_CLIENT_ID ?? ''),
      },
      build: {
        rollupOptions: {
          input: resolve('electron/main/index.ts'),
        },
      },
      plugins: [externalizeDepsPlugin()],
    },
    preload: {
      build: {
        rollupOptions: {
          input: resolve('electron/preload/index.ts'),
          output: {
            format: 'cjs',
            entryFileNames: 'index.cjs',
          },
        },
      },
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      root: resolve('.'),
      build: {
        rollupOptions: {
          input: resolve('index.html'),
        },
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': resolve('src'),
        },
      },
    },
  }
})
