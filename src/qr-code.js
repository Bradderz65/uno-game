const VERSION_INFO = [
    null,
    { size: 21, dataCodewords: 19, eccCodewords: 7, alignment: [] },
    { size: 25, dataCodewords: 34, eccCodewords: 10, alignment: [6, 18] },
    { size: 29, dataCodewords: 55, eccCodewords: 15, alignment: [6, 22] },
    { size: 33, dataCodewords: 80, eccCodewords: 20, alignment: [6, 26] },
    { size: 37, dataCodewords: 108, eccCodewords: 26, alignment: [6, 30] }
];

const FORMAT_ECC_L = 1;
const MASK_PATTERN = 0;

export function createQrSvg(text, options = {}) {
    const quiet = options.quiet ?? 4;
    const scale = options.scale ?? 6;
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = pickVersion(bytes.length);
    const info = VERSION_INFO[version];
    const modules = createMatrix(info.size);
    const reserved = createMatrix(info.size);

    drawFunctionPatterns(modules, reserved, version);

    const dataCodewords = encodeData(bytes, info.dataCodewords, version);
    const ecc = reedSolomon(dataCodewords, info.eccCodewords);
    placeDataBits(modules, reserved, [...dataCodewords, ...ecc]);
    drawFormatBits(modules, reserved, FORMAT_ECC_L, MASK_PATTERN);

    const size = (info.size + quiet * 2) * scale;
    const darkCells = [];
    for (let y = 0; y < info.size; y++) {
        for (let x = 0; x < info.size; x++) {
            if (modules[y][x]) {
                darkCells.push(`<rect x="${(x + quiet) * scale}" y="${(y + quiet) * scale}" width="${scale}" height="${scale}"/>`);
            }
        }
    }

    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Join game QR code" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#111">${darkCells.join('')}</g></svg>`;
}

function pickVersion(byteLength) {
    for (let version = 1; version < VERSION_INFO.length; version++) {
        const info = VERSION_INFO[version];
        const bitLength = 4 + 8 + byteLength * 8;
        const requiredCodewords = Math.ceil((bitLength + 4) / 8);
        if (requiredCodewords <= info.dataCodewords) return version;
    }
    throw new Error('Invite URL is too long for the built-in QR encoder');
}

function createMatrix(size) {
    return Array.from({ length: size }, () => Array(size).fill(false));
}

function setModule(modules, reserved, x, y, value, isReserved = true) {
    if (x < 0 || y < 0 || y >= modules.length || x >= modules.length) return;
    modules[y][x] = Boolean(value);
    if (isReserved) reserved[y][x] = true;
}

function drawFunctionPatterns(modules, reserved, version) {
    const size = modules.length;
    drawFinder(modules, reserved, 0, 0);
    drawFinder(modules, reserved, size - 7, 0);
    drawFinder(modules, reserved, 0, size - 7);

    for (let i = 8; i < size - 8; i++) {
        setModule(modules, reserved, i, 6, i % 2 === 0);
        setModule(modules, reserved, 6, i, i % 2 === 0);
    }

    for (const y of VERSION_INFO[version].alignment) {
        for (const x of VERSION_INFO[version].alignment) {
            const nearFinder = (x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6);
            if (!nearFinder) drawAlignment(modules, reserved, x - 2, y - 2);
        }
    }

    setModule(modules, reserved, 8, size - 8, true);

    for (let i = 0; i < 9; i++) {
        if (i !== 6) {
            reserved[8][i] = true;
            reserved[i][8] = true;
        }
    }
    for (let i = 0; i < 8; i++) {
        reserved[size - 1 - i][8] = true;
        reserved[8][size - 1 - i] = true;
    }
}

function drawFinder(modules, reserved, left, top) {
    for (let y = -1; y <= 7; y++) {
        for (let x = -1; x <= 7; x++) {
            const xx = left + x;
            const yy = top + y;
            const dark = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
            setModule(modules, reserved, xx, yy, dark);
        }
    }
}

function drawAlignment(modules, reserved, left, top) {
    for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
            setModule(modules, reserved, left + x, top + y, x === 0 || x === 4 || y === 0 || y === 4 || (x === 2 && y === 2));
        }
    }
}

function encodeData(bytes, dataCodewords, version) {
    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, version < 10 ? 8 : 16);
    for (const byte of bytes) appendBits(bits, byte, 8);
    appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
        codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
    }
    for (let pad = 0xec; codewords.length < dataCodewords; pad = pad === 0xec ? 0x11 : 0xec) {
        codewords.push(pad);
    }
    return codewords;
}

function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function placeDataBits(modules, reserved, codewords) {
    const size = modules.length;
    const bits = [];
    for (const codeword of codewords) appendBits(bits, codeword, 8);

    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right--;
        for (let rowOffset = 0; rowOffset < size; rowOffset++) {
            const y = upward ? size - 1 - rowOffset : rowOffset;
            for (let col = 0; col < 2; col++) {
                const x = right - col;
                if (reserved[y][x]) continue;
                const bit = bitIndex < bits.length ? bits[bitIndex++] : 0;
                modules[y][x] = Boolean(bit) !== shouldMask(x, y);
            }
        }
        upward = !upward;
    }
}

function shouldMask(x, y) {
    return (x + y) % 2 === 0;
}

function drawFormatBits(modules, reserved, eccLevel, maskPattern) {
    const size = modules.length;
    const bits = getFormatBits((eccLevel << 3) | maskPattern);
    const first = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
        [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    const second = [
        [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
        [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
    ];

    for (let i = 0; i < 15; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        setModule(modules, reserved, first[i][0], first[i][1], bit);
        setModule(modules, reserved, second[i][0], second[i][1], bit);
    }
}

function getFormatBits(data) {
    let value = data << 10;
    const generator = 0b10100110111;
    for (let i = 14; i >= 10; i--) {
        if (((value >>> i) & 1) !== 0) value ^= generator << (i - 10);
    }
    return ((data << 10) | value) ^ 0b101010000010010;
}

function reedSolomon(data, degree) {
    const generator = rsGenerator(degree);
    const result = Array(degree).fill(0);

    for (const byte of data) {
        const factor = byte ^ result.shift();
        result.push(0);
        for (let i = 0; i < degree; i++) {
            result[i] ^= gfMul(generator[i], factor);
        }
    }
    return result;
}

function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= gfMul(poly[j], gfPow(2, i));
            next[j + 1] ^= poly[j];
        }
        poly = next;
    }
    return poly.slice(0, degree).reverse();
}

function gfPow(value, power) {
    let result = 1;
    for (let i = 0; i < power; i++) result = gfMul(result, value);
    return result;
}

function gfMul(a, b) {
    let result = 0;
    while (b > 0) {
        if (b & 1) result ^= a;
        a <<= 1;
        if (a & 0x100) a ^= 0x11d;
        b >>>= 1;
    }
    return result;
}
