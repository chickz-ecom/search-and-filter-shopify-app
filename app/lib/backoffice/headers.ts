// Back-office (8.2): không cho nhúng iframe (clickjacking), không cache, không index.
export const BACKOFFICE_HEADERS = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
};
