# Illustrated asset catalog

26 machine illustrations, 40 item illustrations, and 6 terrain illustrations.

All are individual 256 × 256 scalable SVG files in `public/assets/illustrated/`. Machine sprites are layered into the existing canvas renderer. Some original procedural effects remain for animations and status feedback.

Note: these are programmatically authored vector illustrations, not individually hand-painted raster artwork.

## How the game uses these

- **Machines:** drawn from the SVGs, rasterized once when the page loads. Live information is drawn on top: recipe badge, status light, output arrow, progress bar, furnace glow, fuel and charge meters, module pips.
- **Belts and the wind turbine:** stay animated and drawn in code, so belts move and turbine blades spin. Belt rails are color-coded by tier.
- **Terrain:** the SVG tiles are blended softly into the ground.
- **Items:** the item SVGs are not used in game. Ten of them share the same plain cube shape (iron plate, steel, beam, concrete, wire, rocket part and others), which made them impossible to tell apart on a belt. The in-game item icons keep their distinct shapes.
- The SVGs only load when the game is served over http(s), such as from the website. Opened any other way, the game falls back to its built-in drawings.
