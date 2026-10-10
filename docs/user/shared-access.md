# Shared Access

Shared access lets **someone who is not a Sowel user** open a gate for a while: a child coming home
from school, a tradesperson on Tuesday, a neighbour watering the plants, the guests of a holiday
let. Each person gets a **link**, and optionally a **code**, that opens only the gates you chose,
only on the dates and at the hours you chose, and that you can put on hold or revoke in one click.

It is narrower than a Sowel account (which opens everything) and safer than a remote (which you
cannot take back).

!!! note "Off by default"
Until you turn it on, Sowel shows no page, no panel and no public address for it, and nothing
in its behaviour changes. Only an **admin** can manage accesses.

## Turning it on

1. Go to **Settings** and open the **Shared access** section.
2. Switch it on.
3. Fill in the **public address** the invitations will point to, for example
   `https://access.example.org`, and the **path** of the page (`/access/` by default).

The public address must reach Sowel from outside your home network — see
[Remote Access](remote-access.md). If you give the page a host name of its own, point it at the
`/access/` path of Sowel and set the path to `/`.

Once the feature is on, the **On the home screen** part gives the page the **name** and **icon** it
takes when a visitor adds it to their home screen — your logo, for instance. Pick a square image of
at least 512 px, preferably on a solid background (iOS fills transparency with black): it is cropped
to its centre and resized to the sizes iOS and Android ask for. A phone that already installed it
keeps the old icon until it installs the page again.

!!! warning "Put a reverse proxy in front"
The visitor's page is the one part of Sowel that answers without an account. Serve it over
HTTPS only, and let your reverse proxy apply its own request quota (below).

### A request quota at the reverse proxy { #reverse-proxy-quota }

Exposing `/access/` publicly **requires a rate quota at your reverse proxy**. Sowel slows wrong
codes down and caps how many wrong answers it holds at once, but it sees every visitor through the
proxy's address, so it cannot count tries per visitor: only the proxy can. A minimal Caddy example,
with the [caddy-ratelimit](https://github.com/mholt/caddy-ratelimit) module (build Caddy with
`xcaddy build --with github.com/mholt/caddy-ratelimit`):

```caddyfile
{
  order rate_limit before reverse_proxy
}

sowel.example.org {
  @access path /access/* /api/v1/shared-access/public/*
  rate_limit @access {
    zone shared_access {
      key    {remote_host}
      events 30
      window 1m
    }
  }
  reverse_proxy localhost:3000
}
```

30 requests a minute per address is plenty for a person at a gate. If Caddy itself sits behind
another proxy or a tunnel, key on the visitor's real address instead of `{remote_host}` (behind
Cloudflare, `{http.request.header.CF-Connecting-IP}`). A [CrowdSec](https://www.crowdsec.net/)
bouncer on the proxy is a good complement: it bans the addresses that keep guessing.

Once it is on, **Shared access** appears in the main menu, after Analyse.

## Creating an access

On the **Shared access** page, press **Create an access**, next to the tabs: on a gate's tab it
creates the access on that gate, and with a single gate in the house on that one; otherwise it asks
for the gate first. You can also open a gate's page and press **Create an access** in its
**Shared access** panel. Then:

- **Name** — who it is for: _Plumber_, _Léa_, _Neighbours_.
- **Gates** — the gates it opens. Only `gate` equipments can be listed. When a gate's command has
  several values (open / close / stop), choose the one that opens.
- **Dates** — **All the time**, or **From … to …**. The end cannot be before the start.
- **Hours** — **All day**, or **By time windows**, one or more every day (`08:00–20:00`). A window
  does not cross midnight, and two windows do not overlap.
- **With a code** — on by default. The code is eight characters, shown `4K7M-9QT2`, meant to be
  read out over the phone or shown on a sign. Untick it for someone who will only ever tap the link:
  the link carries a token of its own that cannot be guessed.

Once the access is created, the invitation shows the link, the code and a **QR code** of the link,
which a phone can scan straight from your screen; the same comes back after a code change and in
the editor. The QR code is drawn by your browser: the link never leaves it. Later, copy the link
with the link icon on the line and send it however you like.

## What the visitor sees

The link opens a dark page with one warm disc per gate. The visitor **pulls the disc upward** out of
its socket to open; released too early, it falls back and nothing is sent. On a keyboard, **Enter**
twice does the same. Without the link, the page asks for the code.

The page never says whether the gate is open or closed. It shows only **the visitor's own
commands**, and speaks in words only when the gate will not move — outside the hours, not yet
valid, on hold, revoked — and then it says why.

The page is in French on a phone set to French, and in English on any other phone. It fits on one
screen. The gear at the top right opens **Settings**: the phone's last
commands, and a **QR code** the visitor can have a companion scan to set up a second phone on the
same access. When the companion is not there, **Share** sends the same link through the phone's
share sheet (Messages, WhatsApp, email…), and **Copy the link** copies it. No code is shown there.

While the page is not on the home screen, a small card explains how to put it there, **for the
phone in hand**: on an iPhone, "Share" then "Add to Home Screen"; on Android, the browser's
**Install** button, or the path in its menu. Once installed it opens straight on the disc, **without
asking for the code again**, as the same phone.

## Managing accesses

Each line shows the name, the code, the dates, the hours, how many phones are set up and the last
use. From the line you can:

- **Copy the link**, **edit**, **put on hold** and **resume**;
- **Change the code** — this also renews the link. Choose whether the phones already set up keep
  working (a lost email) or are cut off (a lost phone);
- read **this access's journal** — every opening, refusal and change, kept a year;
- click **N phones** to see each phone set up, named like _iPhone · 7K3F_, and **cut** one on its
  own — it goes back to the code screen, the others keep working;
- **Revoke**, then **delete** once revoked or ended. The journal outlives the access.

The **Activity** feed names every opening: _Shared access — Plumber_.

## Arming a gate

Each gate carries an **armed** switch, on its page and on its tab. Disarmed, every press on that gate
is refused and the visitor is told the house refused it; the accesses are kept. Disarming the garage
leaves the entrance gate alone.

## Profiles and plugins

A plugin (for example a booking system connector) can create accesses on its own: one per stay,
ending with the stay. It never chooses what opens — **you** do, with **profiles**.

The **Profiles** tab holds them. A profile has a name, the gates, the dates and hours (the same two
groups as an access), whether its accesses get a code, and the one plugin it is **granted** to.
A **Default** profile is created when you turn the feature on, with your gate already listed if you
have only one; a plugin's access that names no profile uses it. It cannot be deleted; the others can.

A plugin's access always has an end. Sowel ends it on its own, even if the plugin is stopped, and a
guest who comes back gets a new link and a new code.

## Safety

- A code is looked up before anything else, and a **correct code is never slowed down**. Wrong codes
  are answered more and more slowly past ten in ten minutes, and past 25 you are alerted.
- More than six phones on one access raises an alert — information, never a block below 50. At
  50 phones, a further phone is refused.
- Every link is derived from a secret kept in Sowel's settings, which ride in the backup: whoever
  holds a backup can rebuild the live links. Keep backups like a key. **Change the code** kills an
  access's old link.
- Codes are erased seven days after their access ends.
