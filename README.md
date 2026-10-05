# KinElora Family Intelligence

<a href="https://www.paypal.com/donate/?hosted_button_id=CFANQH892RPH2" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/%F0%9F%92%B9%20Donate%20with%20PayPal-PayPal-0070BA?style=for-the-badge&logo=paypal&logoColor=white" alt="Donate with PayPal" height="28"></a>
<a href="https://github.com/sponsors/DigiSphereX" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/%E2%98%95%20Sponsor%20on%20GitHub-ea4aaa?style=for-the-badge&logo=github&logoColor=white" alt="Sponsor on GitHub" height="28"></a>

![Version](https://img.shields.io/badge/version-1.0.0-f5c518)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)
![Languages](https://img.shields.io/badge/languages-14-informational)
![Offline](https://img.shields.io/badge/data-local%20SQLite-success)
![License](https://img.shields.io/badge/license-MIT-green)

KinElora Family Intelligence is a private, offline-first desktop application for
building and studying a family tree: it keeps every relative, relationship, date,
place, source and event in a local SQLite database, then turns that data into a
dashboard, an interactive family tree, a family timeline and an evidence library.
It runs as one portable executable with no installation, no account and no cloud
service — your family data never leaves your computer. A complete fictional demo
family (Johnson Family, 4 generations, 16 members) ships with the project so you
can explore every screen before entering anything of your own.

## What it does

- **Member records** — names and name display formats, birth and death details,
  gender, blood type, occupation, education, phone, email, national ID,
  birth/death place with translatable region codes, notes and anniversaries.
- **Dual-parent relationships** — mothers and fathers are tracked independently,
  with a fallback for unknown or single parents.
- **Family tree** — interactive and zoomable, with expand/collapse, fit and center,
  a minimap, and one-click **PNG** and **PDF** export.
- **Dashboard** — age-group distribution, generation depth, gender split, zodiac
  distribution, family statistics and upcoming birthdays and anniversaries.
- **Timeline** — family events (births, marriages, deaths, and custom events) with
  years, participants and places.
- **Sources & evidence** — a source catalog with authors, repositories, archive
  references, and claims linked to the evidence that supports them.
- **Relatives index** — an always-up-to-date map of children and parents per member.
- **Horoscope** — Chinese zodiac, numerology and love & marriage sections, computed
  locally from member birth dates (entertainment only).
- **Analysis tools** — age calculator, age difference, life milestones and
  life expectancy.
- **Import / export** — CSV import and export, calendar export, and printing.
- **Search** — global search by name or zodiac sign, from any screen.
- **14 interface languages** — English, Arabic, French, Spanish, German, Italian,
  Portuguese, Turkish, Urdu, Persian, Hindi, Chinese, Russian and Indonesian.
  English is the default and every other language falls back to English for any
  string it has not translated yet.
- **Dark and light themes**, plus a trash view with restore for deleted records.

## Download / Getting started

1. Download the portable executable from the
   [GitHub Releases page](https://github.com/DigiSphereX/kinelora-family-intelligence/releases).
2. Extract the archive to any folder you like (for example `C:\KinElora`).
3. Double-click **`KinElora Family Intelligence.exe`**.
4. On first launch, either **register your own family** or open the bundled demo
   database and log in with the sample credentials below.

No installer, no admin rights, no Python and no internet connection are required.

### Try the demo family first

The repository ships a complete, fully fictional demo database so that every
screen can be explored immediately:

| Field | Value |
|---|---|
| Family | `Johnson Family` |
| Password | `SamplePass123` |

To load it: close the application, back up your current
`data\family_tracker.db`, copy `sample-data\sample-english.db` over
`data\family_tracker.db`, and start the application again. You can also import
`sample-data\sample-english.csv` from inside the app with **Import CSV**, which
is the safer route because it merges into your own database instead of replacing it.

## Usage

1. **Register a family** on first launch, or sign in with the demo family.
2. **Add members** with the *Add Member* button — name, dates, gender, place,
   contact details and notes.
3. **Link relatives** by setting each member's parents and spouse; the tree,
   relatives index and dashboard update automatically.
4. **Explore the tree** — zoom, expand or collapse branches, then export the
   chart as PNG or PDF.
5. **Record sources** in *Sources & Evidence* and attach claims to the evidence
   that backs them.
6. **Switch language and theme** at any time from the header; your choice is
   remembered the next time you open the app.
7. **Back up or hand over your data** with *Export CSV* — and re-import it on any
   machine with *Import CSV*.

## Screenshots

All pages in the English interface, captured from the released build with the
demo family loaded (1440x900):

![Login](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/01-login.png)
![Dashboard](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/02-dashboard.png)
![Members](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/03-members.png)
![Relatives](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/04-relatives.png)
![Horoscope](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/05-horoscope.png)
![Sources and evidence](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/06-sources.png)
![Timeline](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/07-timeline.png)
![Family tree](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/08-tree.png)
![Settings](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/09-settings.png)
![Trash](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/10-trash.png)
![Dashboard light theme](https://raw.githubusercontent.com/DigiSphereX/kinelora-family-intelligence/main/ScreenShot/11-dashboard-light.png)

## How it works

- **Stack** — Python + Flask + pywebview (Edge WebView2) + SQLAlchemy on SQLite.
  The desktop window is a native shell around a local web interface; there is no
  browser tab and no remote server involved.
- **Storage** — everything lives in `data\family_tracker.db` next to the
  executable, alongside a local `secret.key`. Nothing is uploaded, and the app
  works with no network connection at all.
- **Internationalization** — one JSON dictionary per language under
  `_internal/family_tracker/static/vendor/i18n/`, loaded on demand. English is the
  reference dictionary; any missing key in another language falls back to English
  automatically, so the interface never shows raw key names.
- **Identity** — each family is a separate account with its own password; the
  session keeps one family active at a time.

### What this repository publishes

This repository is the **open interface layer and the English demo dataset**:

| Path | Contents |
|---|---|
| `_internal/family_tracker/templates/` | `index.html`, `login.html`, `register.html` — the complete application interface |
| `_internal/family_tracker/static/` | Logo, application icon, vendored libraries (charts, PDF, canvas capture), web fonts and the 14 translation dictionaries |
| `sample-data/` | The fictional Johnson Family demo database, CSV and JSON export |
| `ScreenShot/` | Screenshots of every page |

The runtime engine is bundled inside the released executable, so the application
is shipped ready to run; the source tree here documents and publishes the
interface it renders, and can be used as the reference for skinning, translating
or extending the UI.

## Requirements

- Windows 10 or Windows 11 (64-bit)
- Microsoft Edge WebView2 runtime — preinstalled on current Windows 10/11;
  otherwise install the free *Edge WebView2 Evergreen Runtime*
- ~400 MB free disk space; no admin rights and no installation required

## Disclaimer

The demo family (Johnson Family) is entirely fictional and represents no real
people. Horoscope, numerology, love & marriage and life expectancy results are
**entertainment features computed from birth dates — they are not scientific,
medical, legal or genealogical advice**. Always verify facts against primary
sources and keep your own backups of the database.

## License

MIT — see [LICENSE](LICENSE). The interface layer and the demo dataset in this
repository are released under the MIT License.

---

## ☕ Support this project

KinElora Family Intelligence is **free, offline and open source (MIT)** — no ads, no
tracking, no premium tier, and your family data never leaves your computer. If it
saved you time or brought your family tree back to life, a small contribution keeps
it maintained and free for everyone.

<table>
<tr>
<td align="center" width="50%">

**PayPal — one-time gift**

[![Donate with PayPal](https://img.shields.io/badge/%F0%9F%92%B9%20Donate%20with%20PayPal-PayPal-0070BA?style=for-the-badge&logo=paypal&logoColor=white&logoSize=auto)](https://www.paypal.com/donate/?hosted_button_id=CFANQH892RPH2)

Any amount helps. One click, no account required.

</td>
<td align="center" width="50%">

**GitHub Sponsors — monthly**

[![Sponsor on GitHub](https://img.shields.io/badge/%E2%98%95%20Sponsor%20on%20GitHub-ea4aaa?style=for-the-badge&logo=github&logoColor=white&logoSize=auto)](https://github.com/sponsors/DigiSphereX)

Recurring support for long-term maintenance and new releases.

</td>
</tr>
</table>

**Not able to donate? These help just as much:**

- ⭐ **Star the repository** so other families can find the project.
- 🌐 **Improve a translation** — English is the reference dictionary; the other 13
  languages fall back to English for any string not yet translated, so completing
  them is a genuinely useful contribution.
- 🐛 **Report a bug or send feedback** via [GitHub issues](https://github.com/DigiSphereX/kinelora-family-intelligence/issues).
- 📖 **Share it** with the family or genealogy group you care about.

Thank you for supporting independent software. 💛

---

© 2026 DigiSphereX — KinElora Family Intelligence v1.0.0
