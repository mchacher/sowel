# Plugins

Everything Sowel connects to -- and every automation recipe it runs -- comes as a **plugin**. A fresh Sowel install has zero plugins: you pick the integrations and recipes you need from the store, and only those run on your instance.

Plugins are managed from **Administration > Plugins** (admin only).

---

## The two tabs

**Installed** lists what runs on your instance:

- **Integrations** show their connection status and how many devices they feed. From here you can disable, re-enable, update, or uninstall each one.
- **Recipes** are the automation templates available when you create recipe instances.

**Store** lists what you can install. Entries come from the official Sowel catalogue, plus your own personal sources (see below). The **Refresh** button re-reads the catalogue immediately, useful right after a new plugin or version is announced.

When a newer version of an installed plugin is available, an update badge appears on its row (and in the topbar updates sheet). Updating keeps all your settings, devices, equipment bindings and history: only the plugin code changes.

---

## Trust levels

Every store entry belongs to one of three trust levels, so you always know whose code you are about to run:

| Level         | Badge               | Who publishes it                   | What Sowel checks                                                                         |
| ------------- | ------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| **Official**  | none                | The Sowel maintainer               | Integrity hash pinned in the official catalogue, code maintained with Sowel itself        |
| **Community** | amber **Community** | A third-party developer            | Integrity hash pinned in the official catalogue; the code itself is not reviewed by Sowel |
| **Personal**  | blue **Personal**   | You (your own GitHub repositories) | Integrity hash you approve yourself at install, then pinned (see below)                   |

Installing a community plugin asks for a one-time confirmation. Installing or updating a personal plugin always asks for confirmation, showing exactly what you are about to run.

---

## Personal sources

Personal sources let you install **your own plugins and recipes** without publishing them to the official catalogue. Typical uses: a recipe you wrote for your own home, or trying out a plugin you are developing before sharing it.

### Requirements

A personal source is a **public GitHub repository** that has at least one release with a `sowel-*.tar.gz` asset -- the standard Sowel plugin packaging. If you are writing your first recipe, the [Recipe Development guide](../technical/recipe-development.md) walks through producing exactly that.

### Adding a source

1. Open **Administration > Plugins > Store** and scroll to **Personal sources**.
2. Enter the repository as `owner/repo` (for example `jdoe/sowel-recipe-my-recipe`) and click **Add**.
3. The source appears in the list with its latest release version. If the repository has no release yet, it is kept with a "no release yet" hint and becomes installable as soon as you publish one.

The plugin then shows up in the store with the blue **Personal** badge.

### Installing: the fingerprint confirmation

When you click **Install** on a personal plugin, Sowel downloads the release, computes its **SHA256 fingerprint**, and shows it in a confirmation dialog together with the repository and version.

- Confirming installs exactly the content matching that fingerprint and **pins** it. If the file ever changes behind the same version, Sowel refuses it.
- Every later **update** shows the same dialog again with the new version and new fingerprint, because the content changed since you last approved it. Nothing updates behind your back.

!!! warning "You are trusting the repository owner"
Nobody reviews the code of a personal plugin. It runs with the same privileges as Sowel itself. Only add repositories you own or fully trust -- the fingerprint guarantees _what_ you install never changes silently, not that the code is safe.

### Removing a source

Removing a source does **not** uninstall plugins already installed from it: they keep running. It only stops future installs and updates from that repository. Re-adding the source later restores updates.

---

## For plugin and recipe authors

Want to build one? The technical guides cover the full journey, from scaffolding to publishing:

- [Recipe Development](../technical/recipe-development.md) -- automation templates
- [Plugin Development](../technical/plugin-development.md) -- device integrations, packaging and releases

Once your plugin is worth sharing beyond your own home, the community level is the next step: an entry in the official catalogue, so any Sowel user can install it from the store.
