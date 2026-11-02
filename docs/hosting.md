# Hosting several businesses

One install of Visitor Sign-In can run sign-in for many businesses. Each business is completely separate: its own admins, reception tablets, staff, branding, email settings, Health & Safety rules, visit records, roll calls and business hours.

## Who does what

| Role | What they can do | Where |
| --- | --- | --- |
| **Host Admin** (you) | Create, pause and delete businesses; send setup links; set the default H&S text and safety questions new businesses start with; add other Host Admins; open any business's admin to help | `/host` |
| **Business admin** | Everything for their own business only | `/b/<web-address>/admin` |
| **Warden** | Emergency roll call for their business | their personal link |
| **Reception tablet** | Sign-in for the business it was paired to | `/b/<web-address>/kiosk` |

The person who first set up the install is a Host Admin, and their company is the first business.

## Adding a business

1. Open `/host` and click **New business**.
2. Type the company name. The web address is made from it (`Acme Ltd` → `acme-ltd`); you can change it.
3. Copy the **setup link** and send it to the company. It works once and expires after 14 days. If it expires or gets lost, open **Manage** and make a new one.
4. The company opens the link, creates their admin account, and lands in their own admin to add their logo and colours, H&S rules, staff and iPads.

New businesses start with a copy of the **Defaults for new businesses** (H&S text and safety questions). Changing the defaults later doesn't touch existing businesses.

## Addresses

| Page | Address |
| --- | --- |
| Business admin | `https://your-server/b/acme-ltd/admin` |
| Reception iPad | `https://your-server/b/acme-ltd/kiosk` |
| Staff phone app | `https://your-server/b/acme-ltd/me#invite=…` (personal link, emailed from Admin) |
| Roll call | `https://your-server/b/acme-ltd/rollcall` (fire wardens, from the staff app) |
| Setup link | `https://your-server/b/acme-ltd/setup?token=…` |
| Host console | `https://your-server/host` |

The plain addresses (`/admin`, `/kiosk`, `/rollcall`) open the **default business**: the first one, or the one named in `DEFAULT_BUSINESS`. So an install that was set up before businesses existed keeps working at its old addresses.

A tablet that pairs at `/kiosk` moves itself to its business's own address, so its home-screen icon always opens the right business.

## Pausing and deleting

- **Pause** (Manage › Active switch off): the business's tablets, admins and staff phone apps stop working; its data is kept. Turn it back on to resume.
- **Delete**: removes the business and all its data (staff, tablets, visits, signatures, roll calls, settings). You must type its web address to confirm. Host Admins attached to it keep their accounts.

## Moving to your own domain later

When you buy a domain you can give each business its own subdomain, e.g. `acme.signin.example.com`:

1. DNS: add `signin.example.com` and a wildcard `*.signin.example.com` pointing at your server.
2. Reverse proxy: a certificate covering both (a wildcard certificate via DNS challenge), forwarding all of them to the app.
3. Stack environment: `APP_URL=https://signin.example.com` and `BASE_DOMAIN=signin.example.com`. Redeploy.

Links the app makes (setup links, staff phone links, emails) then use the subdomain form. The `/b/<web-address>/` form keeps working too, so nothing already sent breaks.

## Business hours and automatic sign-out

Each business sets its opening hours and time zone in **Settings › Business hours**, and how people who forget to sign out are handled:

- **At a set time** (default 11:00 pm), **after closing time** (+ a number of minutes), or **off**.
- Visitors, staff, or both.
- Optionally email the reception mailbox the list of who was signed out.

It runs once a day per business in that business's time zone. If the server was off at the time, it runs as soon as it's back. The visitor log shows these sign-outs as "auto".
