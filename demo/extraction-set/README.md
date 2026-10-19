# Extraction test set (invented text)

15 short implementation documents (3 to 6 sentences) in the vocabulary of the invented LCP extract, each with the list of ATOMIC requirements an extractor should return (`doc-NN.expected.json`), the sentences that are NOT requirements (`non_requirement_sentences`), and the source sentence of every expected requirement.

**Status: the expected lists are a first draft and are to be validated by a human before any run.** Nothing here comes from a specification.

Measure (not run yet): `scripts/eval-extraction.ts` (recall and precision of the extraction with 95 % Wilson intervals). Estimated cost per pass: see the script header.
