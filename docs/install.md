# Install guide

This guide takes you from an empty Docker host to iPads signing visitors in. Allow about an hour.

## 1. Before you start

| You need | Notes |
| --- | --- |
| A Docker host with Portainer | Any Linux server, NAS or VM. 1 CPU and 1 GB RAM is plenty. |
| A web address | e.g. `visitors.yourcompany.co.nz`, added to your internal DNS and pointing at the Docker host. |
| HTTPS | The iPads only work offline over HTTPS. Use the reverse proxy you already have (Nginx Proxy Manager, Traefik, Caddy). |
| A way to send email | An SMTP relay (e.g. your Exchange server on port 25), or an SMTP account with a username and password. |
| Two random strings | For `DB_PASSWORD` and `SECRET_KEY`. `openssl rand -hex 32` makes one. |

The stack does **not** need to be reachable from the internet.

## 2. Deploy the stack in Portainer

1. **Stacks › Add stack**, name it `visitor-signin`, and choose **Repository**.
2. Repository URL `https://github.com/KiwiSin/visitor-signin`, reference `refs/heads/main`, compose path `docker-compose.yml`.
3. The repository is private, so turn on **Authentication**: your GitHub username and a personal access token (fine-grained, read-only access to this repository's contents).
4. Under **Environment variables** add:

   ```
   DB_PASSWORD=<random string>
   SECRET_KEY=<another random string>
   APP_URL=https://visitors.yourcompany.co.nz
   TZ=Pacific/Auckland
   ```

   Optional: `APP_PORT` (default 8080), `BACKUP_PATH` (e.g. `/mnt/nas/visitor-backups`), `BACKUP_HOUR` (default 2), `APP_VERSION` (default `latest`).
5. The app image lives in GitHub Container Registry. If the package is private, add it once under **Registries › Add registry › Custom**: URL `ghcr.io`, your GitHub username, and a token with `read:packages`.
6. **Deploy the stack.**

Keep `SECRET_KEY` safe and never change it after setup: it encrypts stored passwords.

## 3. Reverse proxy and HTTPS

Add a proxy host for `visitors.yourcompany.co.nz` that forwards to `http://<docker-host>:8080`, with a certificate. For an internal-only name, a DNS-challenge Let's Encrypt certificate works well (Nginx Proxy Manager and Traefik both support it).

## 4. Create the admin account

1. In Portainer, open **Containers › visitor-signin-app-1 › Logs**.
2. Copy the line that starts with `https://…/admin/setup?token=…` and open it.
3. Enter your company name, your name, email and a password (10+ characters). This makes you the **Host Admin** (you can add other businesses later at `/host`) and your company the first business.

The link only works until the first admin is created. If you lose it, restart the app container and a new one is printed.

## 5. Set it up in Admin

| Where | What to do |
| --- | --- |
| Settings › Email & alerts | Choose **SMTP relay (no login)**, mail server and port 25, *Send from* (e.g. `reception@…`), sender name. Save, then **Send test**. Set the reception shared mailbox and the Health & Safety contact. |
| Staff & teams | Add staff, or download the CSV template, fill it in and **Import CSV**. Mark fire wardens. Give teams a shared mailbox if some staff have no email. |
| Settings › Branding | Company name, logo (PNG), brand colour, wallpapers, emergency assembly point. |
| Settings › Health & Safety | Your rules, the yes/no safety questions and which answer raises a flag, the privacy note and how long to keep records. |
| Settings › Visit types | Which types show, and what each asks (company, email, vehicle rego, induction card, host, signature). |
| Tablets | Add each iPad and pair it. |

## 6. Set up each iPad

1. Safari › `https://visitors.yourcompany.co.nz/kiosk`
2. **Share › Add to Home Screen**, then open the **Sign In** icon.
3. In Admin › Tablets, **Add tablet** (e.g. "Tablet 1 · Main entrance") and type the 6-digit code into the iPad. Set what it **opens to**, e.g. the warehouse tablet opens to Contractor.
4. **Settings › Accessibility › Guided Access** on, with a passcode. Open the app and triple-click the top/side button to start it.
5. **Settings › Display & Brightness › Auto-Lock › Never**, and keep it on power.

To move a tablet or replace an iPad, click **Re-pair** in Admin and enter the new code.

## 7. Staff phone sign-in and fire wardens

Staff can sign themselves in and out from their own phone with one tap, so they don't need to stop at the reception iPad.

**Set up the site (once):** **Settings › Staff phone app**.
- Find your address, or stand at reception and click **Use this device's location**, then check the pin is on your building. Drag it if not.
- **Distance allowed:** 200 m suits most sites. Phones indoors can be 50–100 m out; the app allows for that.
- **Allow signing out from anywhere** is on by default, for people who leave and forget.
- **If the phone won't share its location:** *Don't allow* (default) means they sign in on the reception iPad instead.
- Locations are checked when someone taps Sign In, then thrown away. Nothing is stored or tracked. The check works on any Wi-Fi or mobile data.
- Phones only share their location with sites on **https**, so the reverse proxy in step 3 is required for this.

**Send the links:** click **Email links to N staff without one** (Settings › Staff phone app), or open someone in **Staff & teams** and use **Phone sign-in › Email link**. Each link works on one phone and expires after 7 days if it isn't opened. On a new phone, send a new link; the old phone stops working once it is opened.

**What staff do:** open the email **on their phone** and tap **Open my sign-in**.
- iPhone: it asks them to tap Share › **Add to Home Screen** first, then open **Sign in** from the home screen (iPhone keeps home-screen apps separate from Safari, so the link finishes setting up there).
- Android: it sets up straight away; then ⋮ › **Add to Home screen**.
- The first time they tap **Sign In**, the phone asks to share its location: choose **Allow**.

**Groups:** in **Staff & teams**, tap groups on each person (Fire warden, First aider, Management, or add your own with **+ Group**). Groups show in the staff list and can be used to filter it. The CSV import takes a `groups` column, separated by `;` (e.g. `Fire warden; First aider`).

**Fire wardens:** people in the **Fire warden** group see an **Emergency roll call** button in their phone app and are emailed when a roll call starts. No separate link is needed.
1. The phone keeps a copy of who is on site each time the roll call is opened. In an evacuation, wardens open it as they leave the building; it then works at the assembly point with no Wi-Fi.
2. Run a drill: start a roll call from a phone, tick people safe, end it, and check the report in **Admin › Roll calls**.

Who appears in a roll call: visitors and contractors signed in, and staff marked **In** (on the tablet, their phone, or by an admin). Anyone else can be added by name on the spot. A roll call can also be started from the reception iPad (**Staff in / out › Emergency roll call**). If someone's phone is lost, open them in **Staff & teams** and click **Turn off phone sign-in**.

## 8. Check it works

1. Sign yourself in on the iPad, choosing a colleague as host.
2. Check they got the email, and that the dashboard shows you on site.
3. Sign out on the iPad.
4. Turn the iPad's Wi-Fi off, sign in again, turn it back on: the sign-in arrives within 20 seconds.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Emails not arriving | Settings › Email & alerts › *Recent emails* shows the error. Common causes: the relay doesn't allow the Docker host's IP; wrong port; the server needs STARTTLS. |
| "Relay access denied" | Ask IT to allow the Docker host's IP on the receive connector (see `email-relay.md`). |
| iPad shows "Offline" | Check its Wi-Fi and that it can open the address in Safari. Sign-ins are kept and sent when it reconnects. |
| Warden's roll call says "Open from your warden link" | The link was turned off or replaced. Send a new one from Staff & teams. |
| iPad asks for a code again | It was re-paired or removed in Admin. Make a new code in Admin › Tablets. |
| Forgot the admin password | Another admin can add you again. If nobody can sign in, run `docker exec -it <db-container> psql -U visitor -c "delete from admin_users"`, restart the app and use the new setup link. |
