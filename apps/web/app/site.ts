/**
 * Where this surface lives, for the places that have to name it in full.
 *
 * `metadataBase` needs it so a share card resolves to an absolute URL, and the
 * verification block on the page prints commands a reader runs from their own machine,
 * which is the one place a relative URL is no use.
 */
export const SITE_URL = "https://blast-ruby.vercel.app";
export const REPO_URL = "https://github.com/irisgli/blast";
export const DOCS_URL = `${REPO_URL}/blob/main/docs`;
