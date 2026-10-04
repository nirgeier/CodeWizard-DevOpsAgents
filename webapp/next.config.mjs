import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 16 auto-generates AGENTS.md/CLAUDE.md for AI agents; not wanted here.
  agentRules: false,
  turbopack: {
    root: __dirname,
  },
  // Baileys is CommonJS, ships its own generated protobuf modules and reaches for
  // native crypto helpers. Keep it out of the server bundle so Node resolves it
  // from node_modules at runtime - the WhatsApp session now lives inside the
  // Next server process (see lib/whatsapp/session.ts).
  serverExternalPackages: ['@whiskeysockets/baileys', 'qrcode'],

};

export default nextConfig;

