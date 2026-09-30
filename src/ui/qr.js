import { createQrMatrix } from '../qr-code.js';

const QUIET = 3;
const EYE_COLORS = ['#d62d31', '#1a6fc4', '#23933a'];
const DOT_COLOR = '#12131a';

/**
 * Render text as a branded QR code: round dots and UNO-coloured corner eyes.
 * Returns SVG markup; throws if the text is too long to encode.
 */
export function styledQrSvg(text, { label = 'QR code' } = {}) {
    const modules = createQrMatrix(text);
    const count = modules.length;
    const size = count + QUIET * 2;
    const eyes = [[0, 0], [count - 7, 0], [0, count - 7]];
    const inEye = (x, y) => eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7);

    let dots = '';
    for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
            if (modules[y][x] && !inEye(x, y)) dots += `M${x + QUIET + 0.5} ${y + QUIET + 0.08}a.42.42 0 1 0 .001 0z`;
        }
    }

    const eyeMarkup = eyes.map(([ex, ey], i) => {
        const x = ex + QUIET;
        const y = ey + QUIET;
        return `<g fill="${EYE_COLORS[i]}"><path fill-rule="evenodd" d="${roundedRect(x, y, 7, 2.2)}${roundedRect(x + 1, y + 1, 5, 1.4)}"/><path d="${roundedRect(x + 2, y + 2, 3, 0.9)}"/></g>`;
    }).join('');

    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"><rect width="${size}" height="${size}" rx="2" fill="#fff"/><path fill="${DOT_COLOR}" d="${dots}"/>${eyeMarkup}</svg>`;
}

function roundedRect(x, y, s, r) {
    return `M${x + r} ${y}h${s - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${s - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${s - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${s - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
}
