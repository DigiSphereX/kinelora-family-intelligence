# Changelog
All notable changes to KinElora Family Intelligence are documented here.

## 1.0.0 - 2026-10-05

First public release of KinElora Family Intelligence.

- Portable single-executable desktop application: Windows 10/11, no installer, no
  admin rights, no cloud account and fully offline.
- Private local storage in `data\family_tracker.db` (SQLite) with a per-family
  account and password.
- Member records with names and name display formats, birth and death details,
  gender, blood type, occupation, education, contacts, notes, anniversaries and
  birth/death places including translatable region codes.
- Independent mother and father relationships, with a fallback for unknown or
  single parents.
- Interactive family tree with zoom, expand/collapse, fit, center, a minimap and
  one-click PNG and PDF export.
- Dashboard with age-group distribution, generation depth, gender split, zodiac
  distribution, family statistics and upcoming birthdays and anniversaries.
- Timeline of family events (births, marriages, deaths, custom events) with
  years, participants and places.
- Sources & Evidence catalog with authors, repositories, archive references, and
  claims linked to their supporting evidence.
- Relatives index (children and parents per member).
- Horoscope module with Chinese zodiac, numerology and love & marriage sections.
- Analysis tools: age calculator, age difference, life milestones and life
  expectancy.
- CSV import and export, calendar export and printing.
- Global search by name or zodiac sign.
- Trash view with restore for deleted records.
- Dark and light themes.
- 14 interface languages with automatic English fallback: English, Arabic,
  French, Spanish, German, Italian, Portuguese, Turkish, Urdu, Persian, Hindi,
  Chinese, Russian and Indonesian. English is the default.
- Published the complete interface layer (templates, static assets, translation
  dictionaries) under the MIT License.
- Added the fictional English demo dataset (Johnson Family, 4 generations,
  16 members) as SQLite database, CSV and JSON.
- **Fix:** date columns that stored empty strings (`''`) instead of `NULL` made
  the application fail with `Invalid isoformat string: ''` when reading an
  existing database, which broke the dashboard, tree, timeline, horoscope and
  relatives index. The shipped sample database is now normalized to `NULL`.

[1.0.0]: https://github.com/DigiSphereX/kinelora-family-intelligence/releases/tag/v1.0.0
