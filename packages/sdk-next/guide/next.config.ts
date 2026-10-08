import { withGraft } from "@usegraft/sdk-next/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // your existing Next.js options
};

export default withGraft(nextConfig);
