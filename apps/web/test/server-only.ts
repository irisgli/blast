/**
 * Stands in for `server-only` under test.
 *
 * That package exists to fail a build when a server module is pulled into a client
 * component, which it does by throwing from its client entry. Vitest resolves through
 * Node, gets that entry, and the throw lands on a suite that is legitimately running
 * the module on a server. The guard stays real where it does its job — the build —
 * and is a no-op where it would only be in the way.
 */
export {};
