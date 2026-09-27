import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY

  console.info('[Queue-Nect] Build env validation:', {
    urlExists: Boolean(supabaseUrl),
    keyExists: Boolean(supabasePublishableKey),
    keyLength: supabasePublishableKey?.length ?? 0,
    keyPrefix: supabasePublishableKey?.substring(0, 14) ?? 'missing',
  })

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Missing required Vite Supabase env vars: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.join(root, 'src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
