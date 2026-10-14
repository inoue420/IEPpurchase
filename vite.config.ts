import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { readGitVersion } from './scripts/gitVersion'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(readGitVersion(fileURLToPath(new URL('.', import.meta.url)), command === 'serve')),
  },
}))
