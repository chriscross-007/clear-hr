// Classes for in-page sticky bands (<StickyPageHeader>,
// <DataGrid stickyHeader /> toolbar; the dashboard top bar and sidebar
// are position: fixed instead) so they stay opaque when a wide
// table makes the whole page scroll sideways.
//
// Without these, table rows past a band's right-hand edge scroll up
// beside the band. They paint the band's background (and, for bands
// with a bottom border, the border line) far out to the right using a
// spread box-shadow, clipped so it only extends sideways. Box-shadows
// don't add scroll width; a wide pseudo-element would. The 12px on the
// left keeps focus outlines on the first control from being clipped.
//
// Plain module (not "use client") so server components can import it.

export const STICKY_BAND_EXTEND_RIGHT =
  "shadow-[0_0_0_100vmax_var(--background)] [clip-path:inset(0_-100vmax_0_-12px)]";

/** Same, for bands with a 1px bottom border. The spread grows every
 *  side, so both shadows are lifted by the spread: the border-coloured
 *  one ends at the band's bottom edge and the background one 1px above
 *  it, leaving a 1px line that continues the band's border-b. */
export const STICKY_HEADER_EXTEND_RIGHT =
  "shadow-[0_calc(-100vmax_-_1px)_0_100vmax_var(--background),0_-100vmax_0_100vmax_var(--border)] [clip-path:inset(0_-100vmax_0_-12px)]";
