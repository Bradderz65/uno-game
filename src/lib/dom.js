export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Tiny element builder: h('button', { class: 'btn', onclick }, 'Label').
 * Strings become text nodes, so user-provided text is never parsed as HTML.
 */
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'style' && typeof value === 'object') {
            for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
        } else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? '' : value);
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${name}`);
    svg.append(use);
    return svg;
}

export function hashHue(text) {
    let hash = 0;
    for (const ch of String(text)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return hash % 360;
}

export function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : [...parts[0]].slice(0, 2).join('');
    return letters.toUpperCase();
}

export function avatar(player) {
    return h('span', {
        class: `avatar${player.connected === false ? ' is-offline' : ''}`,
        style: { '--hue': hashHue(player.name) },
        'aria-hidden': 'true'
    }, player.isBot ? icon('i-bot') : initials(player.name));
}

/** Replace children only when the rendered key changes, to avoid churn. */
export function setKeyed(el, key, build) {
    if (el.dataset.renderKey === key) return false;
    el.dataset.renderKey = key;
    el.replaceChildren(...[build()].flat().filter(Boolean));
    return true;
}
