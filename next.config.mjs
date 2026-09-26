/** @type {import('next').NextConfig} */
const supabaseHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname; } catch { return undefined; }
})();

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    serverActions: { bodySizeLimit: '26mb' },   // photo and document uploads go through server actions
  },
  images: {
    remotePatterns: supabaseHost ? [{ protocol: 'https', hostname: supabaseHost }, { protocol: 'http', hostname: supabaseHost }] : [],
  },
};
export default nextConfig;
