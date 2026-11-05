# LFE Office app

A small website for the IUB Live-in Field Experience (LFE) program with three parts:

- **Officials** — who runs LFE and how to reach them
- **Find my group** — students enter their ID and see their section, group, partner campus and dates
- **Meetings** (`meetings.html`, staff) — record A Student/Guardian, B Student (other), C Other and D Monitor/SoD meetings with outcome, follow-up, referral and audio; PDF per meeting, Excel for all.
  Records are stored **only in the browser of the computer used** — nothing is uploaded to GitHub. Export to Excel regularly as a backup.

## Updating the content

Everything shown on the site comes from the `data/` folder. Edit these files on GitHub
(open the file → pencil icon → edit → **Commit changes**). The site updates within a minute or two.

| File | What it controls |
|---|---|
| `data/officials.json` | People shown on the Officials tab |
| `data/groups.csv` | Student list for the group finder (export from Excel as CSV, same column names) |
| `data/iub-programs.json` | IUB schools and majors used in the Meeting Records dropdowns |
| `data/groups-info.json` | Semester name and the note under the finder |

`groups.csv` columns: `student_id, name, section, group, venue, field_start, field_end, faculty`

> Note: this repository is public, so anyone can download `groups.csv`. Only include what students
> need to see (avoid phone numbers, CGPA, etc.).

## Staff sign in (Meeting Records)

Meeting Records opens with a sign-in window. Choose your role, then enter your email and password.

| Role | Email(s) allowed by default |
|---|---|
| LFE Coordinator | `coordinator.lfe@iub.edu.bd` (fixed, cannot be changed or removed) |
| LFE Program Officer | `t.islam@iub.edu.bd` |
| LFE Jr. Program Officer | `arif.tanz@iub.edu.bd` |

**Setting up a device (Coordinator, once per device or browser)**
1. Sign in as Coordinator and choose the password. This password protects the records on that device.
2. You are shown a **recovery code** only once. Write it down and keep it safe and private.
   If the Coordinator password is ever forgotten, the code is the only way back in. Use **Forgot password?** and enter the code.
3. The **👥 Users** window then opens. **The Coordinator sets up each officer's email and password:**
   - Check the email shown for each role, or add a new one. Type a password, or leave it blank to generate one.
   - Tick **They must change it at first sign-in** if the officer should replace it with their own. This is ticked by default.
   - Tell each officer their password. It is shown only until the Users window is closed.

**Coordinator only: 👥 Users**
- Add an email with its password, or remove an email, for the Program Officer and Jr. Program Officer.
- **Change password** sets a new password for an officer, for example when they forget theirs.
- Make a new recovery code. The old code then stops working.

**Other rules**
- Program Officers can only record meetings under their own role. The Coordinator can pick any role.
- Each record notes who entered it and who last edited it.
- Staff are signed out after 30 minutes without activity (not while recording audio). They also need to sign in again after closing or reloading the page.

## Records are encrypted

Records and audio are stored encrypted (AES-256) in the browser. They can only be read after someone signs in.
Records saved by the earlier unencrypted version are encrypted automatically the first time someone signs in.

## Backup and restore

- **⬇ Backup** (any signed-in staff member) saves one encrypted `.json` file. The file holds every meeting, its audio, and the list of staff emails.
  You choose a backup password, and you need it to restore. Keep backups somewhere safe, such as IUB OneDrive or Google Drive.
  The list page shows a reminder if no backup has been made in 7 days.
- **⬆ Restore** (Coordinator only) merges a backup into this device. New meetings are added. Where both have the same meeting, the most recently edited version is kept.
  Staff emails from the backup are added too. Give them temporary passwords on the new device.
- To **move or combine records between devices**, make a backup on one device and restore it on the other.
- Excel export is for reading and reporting. Use **Backup** to keep the records safe.

## Other features

- **Follow-ups:** a record's page has **✓ Mark follow-up done**. Starting a follow-up meeting from a record marks the earlier one done automatically.
  The list shows follow-ups that are due and overdue.
- **Reference numbers** are fixed when a record is first saved. They do not change if the date is edited later.
- **Audio consent:** when audio is attached, the officer must tick that everyone present agreed to the recording.
- **Bangla text in PDFs:** the built-in PDF maker can't draw Bangla. For records that contain Bangla, **Download PDF** opens the browser's print window instead. Choose **Save as PDF** there.

## Offline single-file version

`LFE_Meeting_Records.html` is the whole Meeting Records app in one file. Download it and double-click
to open in Chrome or Edge, with no internet needed. Records are saved in that browser on that computer, the same as the
online version, and it needs its own Coordinator setup. **Records entered in the offline file and on the website are kept separately** — pick one and stick to it.

To rebuild it after changes: `python3 tools/build_standalone.py`

## Install as an app (Windows, Android, iPhone)

Meeting Records is an installable web app. Open
https://coordinatorlfe-ops.github.io/LFE-OFFICIAN/meetings.html and:

- **Windows (Chrome or Edge):** click **⬇ Install app** on the page (or the install icon in the address bar). It appears in the Start menu and opens in its own window.
- **Android (Chrome):** tap **⬇ Install app**, or menu ⋮ → **Install app** / **Add to Home screen**.
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

Once installed it works offline. Each device keeps its own records; back up with **Export all to Excel**.

When app files change, bump `VERSION` in `sw.js` so installed apps update.
