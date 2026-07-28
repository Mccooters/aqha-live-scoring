/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // The vendored lib/vendor/xlsx-js-style.min.js (styled spreadsheet
      // export) probes Node built-ins it never uses in the browser — the same
      // stubbing its npm package declares via its "browser" field.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        crypto: false,
        stream: false,
        process: false,
        buffer: false,
      };
    }
    return config;
  },
};
export default nextConfig;
