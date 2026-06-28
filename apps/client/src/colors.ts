export function materialEdgeColor(hexColor: string): string {
  const rgb = parseHexColor(hexColor);
  if (!rgb) {
    return hexColor;
  }

  const average = (rgb.r + rgb.g + rgb.b) / 3;
  const saturate = 1.28;
  const darken = 0.52;

  return rgbToHex({
    r: clampColor((average + (rgb.r - average) * saturate) * darken),
    g: clampColor((average + (rgb.g - average) * saturate) * darken),
    b: clampColor((average + (rgb.b - average) * saturate) * darken)
  });
}

function parseHexColor(hexColor: string): { readonly r: number; readonly g: number; readonly b: number } | undefined {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hexColor);
  if (!match) {
    return undefined;
  }

  return {
    r: Number.parseInt(match[1] ?? "0", 16),
    g: Number.parseInt(match[2] ?? "0", 16),
    b: Number.parseInt(match[3] ?? "0", 16)
  };
}

function rgbToHex(rgb: { readonly r: number; readonly g: number; readonly b: number }): string {
  return `#${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}`;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
