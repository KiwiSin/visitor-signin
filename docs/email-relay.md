# Email relay checklist (for IT)

Visitor Sign-In only **sends** email (host alerts, reception copies, safety flags). It never reads a mailbox.

## Option A: existing SMTP relay with no login (recommended for on-site Exchange)

1. Find the IP address of the Docker host running the stack.
2. Allow that IP to send through your relay.
   - **Exchange 2016/2019/SE:** Exchange already accepts anonymous mail to **internal** recipients on the default Frontend receive connector (port 25), so internal host alerts usually work with no change. To be explicit, or to allow external recipients, create a dedicated receive connector scoped to the Docker host's IP:

     ```powershell
     New-ReceiveConnector -Name "Visitor Sign-In relay" -TransportRole FrontendTransport -Custom `
       -Bindings 0.0.0.0:25 -RemoteIpRanges <docker-host-ip> -PermissionGroups AnonymousUsers
     # Only if alerts must reach external addresses:
     Get-ReceiveConnector "Visitor Sign-In relay" | Add-ADPermission -User "NT AUTHORITY\ANONYMOUS LOGON" `
       -ExtendedRights "Ms-Exch-SMTP-Accept-Any-Recipient"
     ```
3. Create the sender address, e.g. a `reception@` shared mailbox, so replies have somewhere to go.
4. In Admin › Settings › Email & alerts:
   - Method: **SMTP relay (no login)**
   - Mail server: your Exchange server's name or IP
   - Port: **25**, Security: **None** (or STARTTLS if your connector requires it)
   - Turn on **Accept self-signed certificate** if Exchange uses its own certificate
   - Send from: `reception@yourcompany.co.nz`
5. **Send test.**

Internal email keeps working when the internet is down, because everything stays on your network.

## Option B: SMTP with a username and password

For hosted email or services such as SendGrid, Mailgun, Amazon SES or Brevo: choose **SMTP with login**, port 587 with STARTTLS (or 465 with TLS), and enter the username and password or API key. The password is stored encrypted.

Note for Microsoft 365: basic-auth SMTP (username + password to `smtp.office365.com`) is being retired by Microsoft. Use a relay (Option A) or wait for the Microsoft 365 connection on the roadmap.

## Who gets each email

| Email | Goes to |
| --- | --- |
| "Your visitor has arrived" | The host's own email; if they have none, their team's mailbox |
| Reception copy | The reception mailbox (always if *copy every arrival* is on; otherwise only visits with no host email) |
| Safety flag | The Health & Safety contact, when a visitor gives a flagged answer |
