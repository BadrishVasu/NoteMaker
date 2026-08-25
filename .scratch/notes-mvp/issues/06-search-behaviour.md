# Search behaviour

Type: grilling
Status: open
Blocked by: 03

## Question

Client-side search is locked; its behaviour is not.

Settle: substring matching or tokenised word matching, and whether prefix matching counts. Whether
results are ranked or simply filtered, and if ranked, by what — recency, match count,
title-over-body. Whether search reads title and body or title alone. Whether Notes in the Trash are
searched. Whether search is incremental as you type, and what happens at a corpus size where a
naive scan starts to feel slow. Whether an index is built and maintained, or every query is a fresh
pass.

Depends on ticket 03: what search can read is determined by which local store is the source of
truth.
