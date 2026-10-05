# Sample English Data (Johnson Family)

A complete, **entirely fictional** demo dataset, prepared to exercise every
KinElora module on clean, consistent English data.

## Files

| File | Description |
|---|---|
| `sample-english.db` | Complete SQLite database (matching the application schema) with 16 linked members |
| `sample-english.csv` | CSV import file fully compatible with `/api/import/csv` (17 columns in the server order, no language tags) |
| `sample-english.json` | Full JSON dump (members + relationships) as a reference / export |

## Login (for `sample-english.db`)

- Family name: **Johnson Family**
- Password: **`SamplePass123`**

## Data content (scenarios covered)

- **4 generations** — James Sr (1935, died 2010) → his children → grandchildren →
  great-grandchildren.
- **Mother / father** — the father via `parent_id`, the mother via
  `relationships.biological_parent` (10 mother links).
- **Special cases**:
  - An unmarried mother with a child of unknown father (Olivia ← Susan).
  - A deliberately unknown mother (Daniel) to exercise the fallback path.
  - Deaths (James Sr, Robert, Daniel).
- **Marriages** — 4 couples with dates (1958, 1984, 2015, 2016) in
  `member_spouses` plus bidirectional `spouse_id`.
- **Field variety** — 9 different blood types, 8 countries (US, GB, DE, AE),
  varied occupations and education, mixed `notify_birthday` flags, and birth
  regions in the translatable `◈KE:en` format (see *Language* below).
- **Side modules** — 4 places, 3 events (wedding / birth / death), 3 tags,
  media, and 2 sources + a citation.

## How to use it

### Via the application (import)

```
POST /api/import/csv   (multipart: file=sample-english.csv, mode=merge)
```

In the UI: *Import CSV* in the sidebar → choose `sample-english.csv`. This merges
the demo family into your existing database and is the safest option.

### Full demo database (tree, relationships and marriages ready to use)

1. Close the application.
2. Back up your current database first.
3. Copy `sample-english.db` over `data\family_tracker.db`.
4. Start the application and log in with the demo family
   (`Johnson Family` / `SamplePass123`).

### Language

All names and places are in English. Birth regions are encoded with the
`◈KE:en` marker (for example `Berlin◈KE:en`) to exercise language switching and
the `decodeRegion` rule — the interface displays them as plain place names in the
active language.

---

All people in this dataset are **fictional** and represent no real individuals.
