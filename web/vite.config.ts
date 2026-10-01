import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时：Vite 提供 SPA，其余动态路由代理到 Node 服务（pnpm dev 同时启动两者）
const target = process.env.API_URL ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, ws: true },
      '^/(c|d|uploads)/': { target },
      '^/(search|sitemap\\.xml|robots\\.txt)?(\\?.*)?$': { target },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
