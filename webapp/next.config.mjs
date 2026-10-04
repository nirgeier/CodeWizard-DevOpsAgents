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
};

export default nextConfig;

