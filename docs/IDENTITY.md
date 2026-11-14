# Reentry identity

The mark is a curling wave with a dark forest-green body, an emerald crest, a pale inner lip and a black-green soil contour. Three small contour marks give the lower edge a digital cadence. The artwork has no enclosing tile or background. `src/shared/brand.js` holds the inline vector; `public/reentry-mark.svg` and `favicon.svg` are the standalone variants. Transparent PNG exports cover installed-app and Apple touch icons.

Interface typography uses Geist. Large headings and editorial titles retain Manrope. Prices, quantities and numeric metrics use Geist Mono with tabular figures and a distinguished zero. The shared tokens are `--font-ui`, `--font-display` and `--font-numbers`; use these for new components. `[data-number]` and `.numeric` use the numeric family automatically.

All fonts are served from `/fonts`, with no external requests. Geist and Geist Mono are pinned Fontsource packages and copied by `scripts/build.mjs`, including their licenses. Their combined Latin variable payload is approximately 52KB. Critical preloads plus `font-display: optional` avoid a late interface font swap; display-font preload preserves the established heading metrics.

Sources: [Geist](https://vercel.com/font), [upstream font repository and SIL Open Font License](https://github.com/vercel/geist-font), [Fontsource Geist Mono](https://fontsource.org/fonts/geist-mono/install).

When revising the mark, synchronize the standalone SVG paths with `reentryMarkPaths`, then regenerate transparent PNGs at 180px, 192px and 512px. Keep the 64×64 viewBox and verify the silhouette at 16px/32px as well as display size. The brand does not animate continuously; the crest responds subtly to hover and honors reduced motion.
