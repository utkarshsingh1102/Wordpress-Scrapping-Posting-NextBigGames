// Patterns for images we don't want to republish to WordPress —
// site logos and small thumbnail-size assets that came from share-icon UI.

const LOGO_PATTERNS = [
  /gamigion-smoke/i,
  /\/Logo[._-]/i,
  /\/gamigonfi\./i,
];

function isLogo(url: string): boolean {
  return LOGO_PATTERNS.some((re) => re.test(url));
}

// WordPress auto-generates thumbnail variants with `-WxH` suffixes.
// Anything <= 200px on both axes is almost certainly an icon, not content.
function isSmallThumbnail(url: string): boolean {
  const m = /-(\d+)x(\d+)\.(png|jpe?g|gif|webp|svg)(\?|$)/i.exec(url);
  if (!m) return false;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  return w <= 200 && h <= 200;
}

export function shouldSkipImage(url: string): boolean {
  return isLogo(url) || isSmallThumbnail(url);
}
