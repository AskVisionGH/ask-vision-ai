import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  /** Path-only canonical (e.g. "/auth"). Origin is filled in automatically. */
  canonicalPath?: string;
  /** Set true for authed/private pages so they don't show up in search. */
  noindex?: boolean;
  /** Optional OG image override (absolute URL). */
  image?: string;
  /** og:type — defaults to "website". */
  type?: "website" | "article";
}

const SITE_ORIGIN = "https://app.askvision.ai";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/og-vision.jpg`;

/**
 * Per-route SEO. Title is auto-suffixed with "— Vision" unless it already
 * contains "Vision". Description should be <160 chars; title <60 chars.
 */
export const SEO = ({
  title,
  description,
  canonicalPath,
  noindex = false,
  image = DEFAULT_IMAGE,
  type = "website",
}: SEOProps) => {
  const fullTitle = title.includes("Vision") ? title : `${title} — Vision`;
  const canonical = canonicalPath
    ? `${SITE_ORIGIN}${canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`}`
    : undefined;
  const robots = noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large";

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="robots" content={robots} />
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      {canonical && <meta property="og:url" content={canonical} />}
      <meta property="og:image" content={image} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
};
