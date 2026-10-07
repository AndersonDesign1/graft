import { withGraft } from "@usegraft/sdk-next/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // your existing Next.js options
  cacheComponents: true,
};

export default withGraft(nextConfig);
