# LFE Office app

A small website for the IUB Live-in Field Experience (LFE) program with three parts:

- **Officials** — who runs LFE and how to reach them
- **Find my group** — students enter their ID and see their section, group, partner campus and dates
- **Meetings** (`meetings.html`, staff) — record student/guardian, student and other meetings with outcome, follow-up, referral and audio; PDF per meeting, Excel for all.
  Records are stored **only in the browser of the computer used** — nothing is uploaded to GitHub. Export to Excel regularly as a backup.

## Updating the content

Everything shown on the site comes from the `data/` folder. Edit these files on GitHub
(open the file → pencil icon → edit → **Commit changes**). The site updates within a minute or two.

| File | What it controls |
|---|---|
| `data/officials.json` | People shown on the Officials tab |
| `data/groups.csv` | Student list for the group finder (export from Excel as CSV, same column names) |
| `data/groups-info.json` | Semester name and the note under the finder |

`groups.csv` columns: `student_id, name, section, group, venue, field_start, field_end, faculty`

> Note: this repository is public, so anyone can download `groups.csv`. Only include what students
> need to see (avoid phone numbers, CGPA, etc.).
