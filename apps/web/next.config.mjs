const nextConfig={output:'standalone',async rewrites(){return [{source:'/api/:path*',destination:`${process.env.INTERNAL_API_URL||'http://127.0.0.1:3101'}/api/:path*`}];}};
export default nextConfig;
