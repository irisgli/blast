---
name: bundle-delta
description: Attribute a client JavaScript payload increase to the dependencies a change added. Use when client JS grew and the question is what accounts for it.
---

# Attributing a payload increase

A payload number tells you there is a problem. Attribution tells you whether it is a
fixable one. A 20 KB increase that is one dependency is a conversation about that
dependency; the same 20 KB spread across application code usually is not.

## Run the attribution

Call `attribute_payload` with the measured delta from the build manifest finding and
the dependencies from the change profile. It returns each dependency's share and the
remainder that application code accounts for.

The same function is available as a command line script for a person or a CI job
holding a change profile:

```bash
echo '{"clientBytesDelta": 18432, "dependenciesAdded": [...]}' \
  | node agent/subagents/performance/skills/bundle-delta/scripts/attribute.mjs
```

Use the tool. The script exists so the numbers in a brief can be reproduced outside it.

## Reading the result

**A dependency dominates.** Name it, with its share. Ask whether a lighter alternative
or a dynamic import would work. This is the case worth raising in review, because it is
the one with an obvious next step.

**The remainder dominates.** The growth is the feature itself. Attribution has nothing
more to offer, and saying so is more useful than implying there is a dependency to
swap out.

**Dependency bytes are null.** No build measured them. Report the total and say
attribution was not available; do not estimate a dependency's size from its name or
your recollection of it.

A dependency's own size is not the whole story — it may pull transitive dependencies
the manifest already counted in the remainder. Present shares as a guide to where to
look, not as an exact decomposition.
