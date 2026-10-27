import type { NextConfig } from "next";

// GitHub project pages are hosted under the repository name, not the upstream ChatStory path.
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "private-chat-analyzer";
const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  ...(isGithubPages
    ? {
        basePath: `/${repoName}`,
        assetPrefix: `/${repoName}`,
      }
    : {}),
};

export default nextConfig;
