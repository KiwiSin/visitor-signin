# Visitor Sign-In

Self-hosted visitor sign-in for reception. Visitors sign in on an iPad, agree to your Health & Safety rules, choose who they're visiting, and that person gets an email straight away. Runs as one Portainer stack on your own server.

![Kiosk home screen](docs/screenshots/kiosk-home.png)

## What it does

- **Reception iPad (kiosk):** full-screen web app with your logo, colours and wallpapers, live clock, Sign In, Sign Out and Staff in / out.
- **Sign-in flow:** visit type (Visitor, Contractor, Courier, Interview), details, choose a host, Health & Safety rules, safety questions, finger signature.
- **Alerts:** email to the host (or their team's shared mailbox), a copy to the reception mailbox, and a separate alert to your Health & Safety contact when a safety answer is flagged. Failed emails retry for 24 hours.
- **Admin portal:** dashboard of who's on site, visitor log with CSV export and signatures, staff and teams (manual or CSV import), tablet pairing, branding, email settings, H&S text and questions, visit types, admin users.
- **Emergency roll call:** wardens open a personal link on their phone (added to the home screen). Start a roll call from a phone, the reception iPad or Admin; everyone signed in appears, wardens tick people safe, call missing people with one tap, and add anyone not on the list. Several wardens can tick at once. It keeps working with no Wi-Fi and syncs when back online. Wardens and reception are emailed the list when it starts. Reports are kept 7 years with CSV export.
- **Many businesses on one install:** a Host console (`/host`) to create businesses from their name, send each a one-time setup link, pause or delete them. Each business gets everything above, completely separate, at `/b/<web-address>/`. See [docs/hosting.md](docs/hosting.md).
- **Business hours and automatic sign-out:** opening hours and time zone per business; anyone still signed in is signed out at a set time (default 11:00 pm) or after closing time, with an optional daily list to reception.
- **Works offline:** if the network drops, the iPad keeps signing people in and sends them when it reconnects.
- **Privacy:** visit records and signatures are deleted automatically after 12 months (configurable).
- **Backups:** nightly database and uploads backup, kept 30 days.

## Install with Portainer

You need a Docker host with Portainer, and a web address with HTTPS for the iPads (for example `https://visitors.yourcompany.co.nz` through Nginx Proxy Manager, Traefik or Caddy).

1. **Stacks › Add stack › Repository**
   - Repository URL: `https://github.com/KiwiSin/visitor-signin`
   - Repository reference: `refs/heads/main`
   - Compose path: `docker-compose.yml`
   - Private repo: turn on **Authentication** and use a GitHub personal access token with read access.
2. If the image is private, add **Registries › GitHub (ghcr.io)** with a token that has `read:packages`.
3. Add the environment variables (see [.env.example](.env.example)). At minimum:

   | Variable | Example |
   | --- | --- |
   | `DB_PASSWORD` | a long random string |
   | `SECRET_KEY` | a long random string (`openssl rand -hex 32`) |
   | `APP_URL` | `https://visitors.yourcompany.co.nz` |

4. **Deploy the stack.** Open **Containers › visitor-signin-app-1 › Logs** and copy the first-time setup link. Open it to create your account (the Host Admin) and name your company, the first business.
5. Point your reverse proxy at port `8080` on the Docker host (change with `APP_PORT`).

Then in Admin:

1. **Settings › Email & alerts:** choose *SMTP relay (no login)*, enter your mail server and port 25, the *Send from* address and the reception mailbox. Send a test.
2. **Staff & teams:** add people, or import a CSV (`name, email, team, mobile, role`).
3. **Settings › Branding:** logo, colour, wallpapers, assembly point.
4. **Settings › Health & Safety:** paste your rules and safety questions.
5. **Tablets:** add each iPad and pair it (steps below).
6. **Staff & teams › fire wardens › Send roll call link:** each warden opens it on their phone and adds it to the home screen. Run a drill from Admin › Roll calls.

Full guide: [docs/install.md](docs/install.md). Hosting other businesses: [docs/hosting.md](docs/hosting.md). IT checklist for the mail relay: [docs/email-relay.md](docs/email-relay.md).

## Setting up an iPad

1. On the iPad, open Safari and go to `https://visitors.yourcompany.co.nz/kiosk`.
2. Tap **Share › Add to Home Screen** and open the new **Sign In** icon (it runs full screen).
3. In Admin › Tablets click **Add tablet** and type the 6-digit code into the iPad.
4. **Settings › Accessibility › Guided Access** on; open the app and triple-click the top/side button to lock it.
5. **Settings › Display & Brightness › Auto-Lock:** Never. Keep it on power.

## Updating

- Pushing to `main` builds `ghcr.io/kiwisin/visitor-signin:latest` (GitHub Actions). In Portainer, **Pull and redeploy** the stack, or turn on **GitOps updates**.
- To control upgrades, tag a release (`git tag v0.2.0 && git push --tags`) and set `APP_VERSION=v0.2.0`.
- Database changes run automatically when the app starts.

## Backups and restore

The `backup` service writes `visitor-db-*.dump` and `visitor-uploads-*.tar.gz` every night to `BACKUP_PATH` (a named volume by default; set a host path such as `/mnt/nas/visitor-backups` to keep them off the server, and make it writable by user id 1000).

Restore a database backup:

```sh
docker exec -i <db-container> pg_restore -U visitor -d visitor --clean --if-exists < visitor-db-YYYYMMDD-HHMM.dump
```

## Development

```sh
npm install
# needs a Postgres database
DATABASE_URL=postgres://user:pass@localhost:5432/visitor npm run dev:server
npm run dev:web          # http://localhost:5173 (proxies /api to :8080)
npm run build            # builds the web app into web/dist
npm run smoke -- http://localhost:8080 <setup-token> <smtp-host> <smtp-port>
node scripts/rollcall-test.mjs http://localhost:8080
node scripts/multibusiness-test.mjs http://localhost:8080
```

Stack: Node.js 22 (Fastify), PostgreSQL, React (Vite), Nodemailer.

## Roadmap

- Pre-registration with QR invites
- Contractor inductions with 12-month expiry
- Microsoft Teams Workflow, Slack and webhook alerts
- Microsoft 365, Google Workspace and Active Directory staff sync
- Badge printing (network or USB label printer)
