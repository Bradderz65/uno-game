import { $, $$ } from '../lib/dom.js';

function showModal(dialog) {
    if (!dialog.open) dialog.showModal();
}

/** Resolves with the dialog's returnValue once it closes. */
function waitForClose(dialog) {
    return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    });
}

export async function confirmDialog({ title, text = '', confirmLabel = 'Confirm', danger = true }) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const ok = $('#confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    dialog.returnValue = 'cancel';
    showModal(dialog);
    ok.focus();
    return (await waitForClose(dialog)) === 'ok';
}

export async function pickColor() {
    const dialog = $('#color-dialog');
    dialog.returnValue = '';

    const onKey = event => {
        const index = ['1', '2', '3', '4'].indexOf(event.key);
        if (index >= 0) dialog.close(['red', 'yellow', 'green', 'blue'][index]);
    };
    dialog.addEventListener('keydown', onKey);
    showModal(dialog);
    const color = await waitForClose(dialog);
    dialog.removeEventListener('keydown', onKey);
    return color || null;
}

export function initRulesDialog() {
    const dialog = $('#rules-dialog');
    for (const button of $$('[data-open-rules]')) {
        button.addEventListener('click', () => showModal(dialog));
    }
}

/** Clicking the dimmed backdrop closes light-weight dialogs. */
export function enableBackdropClose(dialog, value = '') {
    dialog.addEventListener('click', event => {
        if (event.target === dialog) dialog.close(value);
    });
}
