---
hide:
  - navigation
  - toc
---

<div class="sowel-hero" markdown>

<svg class="sowel-logo" xmlns="http://www.w3.org/2000/svg" viewBox="25 15 150 155" aria-label="Sowel logo">
  <path class="house"     d="M100 30 L160 90 Q165 95 160 100 L160 150 Q160 158 152 158 L48 158 Q40 158 40 150 L40 100 Q35 95 40 90 Z"/>
  <path class="smile"     d="M75 115 Q100 140 125 115"/>
  <path class="left-eye"  d="M78 95 Q83 87 88 95"/>
  <path class="right-eye" d="M112 95 Q117 87 122 95"/>
</svg>

# Sowel

**Don't program your home. _Apply recipes to it._**<br/>
A home automation engine for _comfort_, _safety_ and _energy efficiency_ — without writing a single line of code.

[Get started :material-arrow-right:](user/getting-started.md){ .md-button .md-button--primary }
[See it on GitHub](https://github.com/mchacher/sowel){ .md-button }

</div>

## A different way to automate your home

Most home automation tools turn you into a part-time developer: YAML files, scripts, flows, conditions, edge cases. The result is fragile spaghetti that only one person in the household can debug.

**Sowel takes the opposite path.**

Instead of writing automations, you **pick a recipe** — _Motion Light_, _Presence Thermostat_, _Pool Pump Schedule_, _Sunset Shutters_ — and **apply it to a zone**. Each recipe encodes a thoughtful, road-tested pattern for a specific need: comfort, safety, or energy efficiency. You configure a few obvious settings (a duration, a temperature, a time window), not a programming language.

Your house stops being a side project. It just works.

## What makes Sowel singular

<div class="grid cards" markdown>

- :material-chef-hat:{ .lg .middle } **Recipes, not scripts**

  ***

  Each recipe is a curated automation pattern: motion-triggered lighting, presence-based heating, scheduled irrigation, sunset shutters. You drop it on a zone, set a few values, and it runs.

  No flows to wire. No edge cases to chase.

- :material-home-outline:{ .lg .middle } **Equipments, not devices**

  ***

  Three switches and a motion sensor in your kitchen become one _Kitchen Lights_ equipment. Network plumbing vanishes into something you can name, group, and reason about.

- :material-shape-outline:{ .lg .middle } **Zones that aggregate themselves**

  ***

  A zone called _Ground Floor_ tells you the average temperature, the brightest room, the highest humidity — automatically. No formulas, no glue code, no dashboards to wire.

- :material-weather-night:{ .lg .middle } **Modes that switch the whole house**

  ***

  Day, Night, Holiday, Cocoon — one tap flips your home over: dimmer lights, lower thermostats, closed shutters. Modes follow a calendar that knows when you're away.

</div>

## Deploy in minutes — yours from day one

<div class="sowel-pills" markdown>

- :material-docker: **One Docker container.** `docker compose up -d`. That's the install.
- :material-shield-check-outline: **Stays at home.** No cloud, no telemetry, no third-party account. Your data lives on your hardware.
- :material-puzzle-outline: **Plug in what you own.** Zigbee, Panasonic, Netatmo, Shelly, Legrand, MQTT-anything — install integrations like you install apps. Skip what you don't need.
- :material-update: **Self-updating.** Plugins and the engine update from GitHub. No SSH, no fiddling, no reboots scheduled at 3 a.m.

</div>

## Take a tour

<div class="grid cards" markdown>

- :material-book-account-outline:{ .lg .middle } **For users**

  ***

  Set up your home, configure equipments, and apply your first recipes.

  [User guide :octicons-arrow-right-24:](user/getting-started.md)

- :material-cog-outline:{ .lg .middle } **For builders**

  ***

  Architecture, plugin development, recipes, and the data model.

  [Technical guide :octicons-arrow-right-24:](technical/index.md)

</div>

<p class="sowel-foot">Sowel is licensed under <a href="https://github.com/mchacher/sowel/blob/main/LICENSE">AGPL-3.0</a> · <a href="https://github.com/mchacher/sowel">GitHub</a></p>
