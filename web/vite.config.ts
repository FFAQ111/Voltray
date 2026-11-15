import path from "node:path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Bind IPv4 explicitly: in the dev container "localhost" resolves to ::1 only,
  // which VS Code port forwarding (targets 127.0.0.1) cannot reach.
  server: { host: "127.0.0.1" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
