/* ---------- Generated house "photos" (inline SVG, no image files needed) ---------- */
function photo(hue, variant) {
  variant = variant || 0;
  const wall = `hsl(${(hue + variant * 24) % 360} 38% ${72 - variant * 3}%)`;
  const roof = `hsl(${(hue + 190) % 360} 30% ${32 + variant * 4}%)`;
  const door = `hsl(${(hue + 30) % 360} 45% 30%)`;
  const sunX = 70 + variant * 90;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${(hue + 150) % 360} 60% 84%)"/><stop offset="1" stop-color="#fdf6e3"/></linearGradient></defs>
  <rect width="400" height="260" fill="url(#s)"/>
  <circle cx="${sunX}" cy="52" r="24" fill="#f6c453"/>
  <rect y="196" width="400" height="64" fill="hsl(${(hue + 95) % 360} 32% 56%)"/>
  <rect x="${110 - variant * 12}" y="104" width="${190 + variant * 12}" height="98" fill="${wall}"/>
  <polygon points="${96 - variant * 12},108 ${205 + variant * 0},50 ${314 + variant * 0},108" fill="${roof}"/>
  <rect x="${186 + variant * 4}" y="140" width="34" height="62" rx="3" fill="${door}"/>
  <rect x="${128 - variant * 8}" y="128" width="38" height="34" rx="3" fill="#fff8e6" stroke="${roof}" stroke-width="3"/>
  <rect x="${246 + variant * 4}" y="128" width="38" height="34" rx="3" fill="#fff8e6" stroke="${roof}" stroke-width="3"/>
  <rect x="330" y="150" width="8" height="48" fill="hsl(30 30% 30%)"/>
  <circle cx="334" cy="140" r="24" fill="hsl(${(hue + 100) % 360} 40% 38%)"/>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
