/**
 * Putting the language onto markup that was written in English.
 *
 * The pages are hand-written HTML with their sentences in them, which is what
 * makes them readable as files and what shows through if the scripts never run.
 * Each of those sentences carries the key it is really a copy of, and this
 * swaps it for whatever the language in use says — including the ones a
 * visitor never sees, since a screen reader reads aria-labels aloud and there is
 * no sense in it reading them aloud in English.
 *
 * Sentences with emphasis or a link inside them cannot be swapped this way: the
 * emphasis falls in a different place in another language, and in Korean often
 * in a different order. Those are built out of parts instead — see {@link em}.
 */

import { language, t } from "./language.js";

/** Where the text of an element goes, by the attribute that names its key. */
const INTO = {
  "data-i18n": (node, said) => {
    node.textContent = said;
  },
  "data-i18n-placeholder": (node, said) => {
    node.placeholder = said;
  },
  "data-i18n-label": (node, said) => {
    node.setAttribute("aria-label", said);
  },
};

/**
 * Say the whole page in the language in use.
 *
 * The declared language goes with it: it is what tells a screen reader which
 * voice to read the page in, and a browser whether to offer to translate it.
 */
export function translatePage(root = document) {
  document.documentElement.lang = language();

  for (const [attribute, put] of Object.entries(INTO)) {
    for (const node of root.querySelectorAll(`[${attribute}]`)) {
      put(node, t(node.getAttribute(attribute)));
    }
  }
}

/**
 * A marked-up part of a sentence. A language hands back its sentence as text
 * and parts in its own order, and the page puts them into an element with
 * `replaceChildren`.
 */
const marked = (tag) => (text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

export const strong = marked("strong");
export const em = marked("em");
