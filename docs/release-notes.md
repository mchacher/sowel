# Release notes

Sowel has been versioned and shipped through CI/CD since `v1.0.0` (April 2026, spec 055). Every release is published as:

- A signed GitHub release with a generated changelog — [github.com/mchacher/sowel/releases](https://github.com/mchacher/sowel/releases)
- A multi-arch Docker image tagged `ghcr.io/mchacher/sowel:<version>` and `:latest`

This page summarises every published version, newest first. For the full diff between two versions use `https://github.com/mchacher/sowel/compare/v<a>...v<b>`.

**Updating a running instance.** Sowel polls GitHub every hour and surfaces the available update in the topbar. Click the pill to open the updates sheet and apply the new version in one click (added in v1.9.0). On the command line: `cd /opt/sowel && docker compose pull && docker compose up -d`.

---

## 1.64.x: What the test suite cannot see

### v1.64.0 — 2026-08-30 { #v1-64-0 }

Four of the five changes here were shaped, or corrected, by looking at the thing on a phone. A five-day strip that passed every component test and crowded the tile it was added to. A confidence rule with a computed height of zero, painting nothing, under a suite that cannot compute layout. A slide-to-confirm no thumb could complete. jsdom lays out nothing and a browser lays out everything, and this release is mostly the difference between the two.

- Feat (ui): **the forecast tile qualifies tomorrow, and the five days sit behind a tap** (spec 168, #850, #851, #857). The dashboard tile showed tomorrow and nothing else, so the confidence the weather plugin has published since 2.0 was invisible on the surface where the forecast is actually read, and nothing said there was more behind the card. The tile now carries the same confidence pill as the panel and the equipment page, centred at its foot, and a tap opens a panel with the five days as columns: day, condition, maximum, minimum, wind, and each day's pill. Nothing appears when the plugin cannot qualify the day, because a grey badge reading "not qualified" spends the foot of a 212 px card saying nothing and is one more thing to mistake for a verdict. The first design shipped in this same release was a five-day strip under the summary and one vertical row per day in the sheet; seen on a real phone against production data, neither held, and both were replaced rather than kept. Two defects only the browser showed: the confidence rule had `box-content` zeroing its height, so `background-clip: content-box` had nothing to paint, and the confidence slots sat on three different baselines because a day with no verdict has nothing under its separator. The panel is now clamped to five columns rather than trusting the feed for its count: its paddings, type sizes and the slot reserved for the pill are tuned for exactly five across a 390 px sheet, and a plugin publishing seven days would have produced 46 px columns with the pill wrapping out of the slot held for it. The clamp drops from the far end, a forecast being least sure furthest out. Also fixed: a `NaN` published by a plugin passed the `typeof value === "number"` gate and rendered as the literal `NaN`, on the equipment page too.
- Feat (recipes): **a recipe package can declare a Dashboard tile, and an instance can be pinned beside the equipment it acts on** (spec 169, #853, issue #852). The declaration belongs to the package: an icon from a closed set, which state keys carry the summary and the countdown, and which actions get a control. A definition without a tile is never listed in the picker and cannot be pinned, because most recipes have nothing worth watching at a glance and the core should not hand them a surface their author never designed. The rendering is not new: the instance row already turns `state.summary`, `state.timerExpiresAt` and cycle actions into a status line, a live countdown and a mode pill, and the same descriptor now reaches a second surface reusing those components rather than reimplementing them. Recipes already publishing those keys gain a tile by adding one field, and not before. A package that stops declaring a tile does not lose the user their widget: it renders as unavailable, since deleting someone's dashboard layout because a third-party package changed its mind is the worse answer.
- Fix (ui): **the live energy page says which meter is frozen, instead of flagging the whole page** (#859, issue #854). The banner was raised from the spec 116 equipment status, a verdict on the whole meter that turns degraded when any streaming binding ages out, voltage and current at five minutes and energy at ten included. The flow diagram draws none of those. On the reference installation the production meter alone flipped online and degraded twelve times in twenty minutes, and the page answered each time with one anonymous "live data stale" sentence, over a grid figure that was updating once a second. The freshness question is now asked of the power readings the diagram actually draws, through the classifier the submeter breakdown and the `?role=submeter` feed already share, and the answer is one line per affected source with its own age: "Production: reading frozen for 3 min", with no grid line at all when the grid is fine. A meter degraded only by a reading this page never shows raises nothing. The page also gains the clock the breakdown already had, because a meter that goes silent sends no event and nothing would otherwise re-render the page at the moment its reading ages out.
- Fix (ui): **the gate confirmation slide fits a thumb** (#860, issue #858). The control filled the sheet, so on a 393 px phone it was a 353 px track with 295 px of travel, starting in the bottom-left corner of the screen: the point farthest from the thumb of the hand holding the phone, on a control whose whole purpose is one-handed use standing in front of a gate. The track is capped at 260 px and centred, so the knob starts at x=72 instead of x=20 and the sweep is 202 px, and the sheet sits 134 px off the bottom edge instead of 88. That height is bought with content rather than with empty space: growing the sheet and floating it off the bottom were both tried on the device and both read as a hole in the layout, so the cancel became a real button instead of a text link, deliberately narrower and lighter than the slide. Travel is derived from the rendered width, so the confirm threshold, the progress fill and the knob all followed the cap; the label did not, and it now takes whichever half the knob is not occupying rather than starting underneath it. A partial drag still snaps back and actuates nothing, which is the whole point of spec 146.
- Maintenance (specs): the UI redesign mockups moved into the spec that owns them (#856).

---

## 1.63.x: A gate that only checked the spelling

### v1.63.0 — 2026-08-30 { #v1-63-0 }

The headline is a privilege escalation that had been shipping for some time, and the rest of the release keeps company with it: five defects where a guard existed, was believed to hold, and did not. A backup guardrail that could never fire, a stale reading presented as a live measurement, a release published without an image half the fleet could pull, and a whole tier of tests asserting on values the engine cannot produce.

- Fix (auth): **an authenticated non-admin could read every admin-only endpoint by percent-encoding one character of the path** (#836). Seven route files gate an admin surface with a hook comparing `request.url`, the raw request target. The router percent-decodes before matching, so `GET /api/v1/%62ackup` reached the `/api/v1/backup` handler while the hook saw a string it did not recognise and let the request through ungated. Nothing stood behind it for reads: the global role gate only inspects `POST/PUT/PATCH/DELETE`, so an admin-only `GET` had that hook as its only protection. Measured against a real router with a `standard` identity, the response body came back. What was exposed is the set worth protecting: the full system export, the server log, the settings map, MQTT broker credentials, notification channel tokens such as a Telegram bot token, and the user list. Mutations were never exposed, because the fail-closed global gate catches those whatever the spelling. The comparison now decodes once, which is what the router does; decoding until stable would be worse than the bug, since it would make the hook see a path the router never will and turn a 404 into a 403 on a route that does not exist. Four of the hooks also matched on a bare prefix, which would have gated a future sibling such as `/api/v1/users-export`. Every gate is now driven through a real router in the suite, asserting both that a non-admin is refused however the path is spelled and that an admin is still served, so the fix cannot pass as a blanket denial. Found while reviewing an unrelated schema conversion that had copied the same hook pattern.
- Fix (backup): **the restored-data guardrail could not fire on a restore, which is how production data normally arrives somewhere it does not belong** (#830, issue #790). The guardrail compares the instance id stored in the settings table, which travels inside backups by design, with the `.instance-id` marker beside the database, which is meant to describe this deployment. The marker was in neither exclusion list, so the export copied it into the archive and the restore wrote it back: both halves of the comparison came from the same deployment and the takeover was structurally always false. Restoring a production archive onto a second machine therefore produced a fully armed instance sharing the origin's MQTT client id, OAuth grants and notification channels, which is precisely the incident the guardrail was built after. Restoring your own backup on the same instance is unaffected and is pinned by a test, since that is the case the change could plausibly have broken. A deliberate shadow run keeps no prompt: it is a copy of production data by definition, the shadow gates already hold it inert, and confirming would stamp the origin's identity onto the shadow's marker.
- Fix (ui): **a submeter reading was presented as a live measurement whatever its age** (#833, issue #744). The consumption breakdown built its whole from the grid and solar meters, refreshed every few seconds, and its parts from whatever each plug last said, at full weight, however old. Measured on production: a water heater drawing 560 W was displayed as 0 W because its clamp had last reported sixteen minutes earlier, and a wood stove was contributing a reading 124 days old. The failure is quiet, since a stale `0 W` reads as "this appliance is off", which is a perfectly plausible thing for a water heater to be. The binding's own staleness flag cannot carry this: the engine applies its electrical window only to declared meters, on purpose, because a steady load stops producing updates and a tight window would flag a healthy appliance on every reporting cycle. A row past its budget now reads "reading outdated" with its age and contributes nothing to the total, the residual or the donut; it stays in the legend, because not knowing is information. The budget is two minutes for a declared meter and ten minutes otherwise, twice the slowest cadence any supported integration polls at, so a healthy appliance on a five-minute poll does not flicker in and out. The shares are also computed from the values actually displayed, so the figures on screen no longer contradict each other.
- Fix (api): **the submeter feed the energy display consumes now says whether a reading may be drawn** (#840, issue #832). The same stale readings shipped there unqualified, and a client cannot work a reading's age out for itself without restating the rule. The rule moved to a shared module and both surfaces call the same function, which is the substance of the change more than either call site: a rule restated per surface is how the breakdown and the arbitration card came to describe one appliance in two contradictory ways. Each entry carries `powerReadingCurrent`, additive so an existing client keeps parsing what it parses today. The energy display's firmware lives in its own repository and needs a change to read it. Equipment cards remain, tracked separately.
- Fix (ws): **free-form strings on the shared system topic are stripped for non-admin clients** (#835, issue #651). `system.error` and the two update events carry operator-facing prose assembled at the call site, on a topic every authenticated client subscribes to by default. No secret flows there today; what this removes is the dependence on every future author remembering. The event is still delivered and its structured fields survive, so a non-admin watching an update still sees the overlay. Alarm text is deliberately not redacted and the reason is now written down: it is rendered as the fallback for alarms with no translation key, so redacting it would blank the header issue banner, and it would close nothing while the activity feed mirrors the same prose on a topic every role may subscribe to.
- Fix (backup): **an archive could carry an entry its own restore would refuse** (#838, issue #829). The export and the restore derived a file's extension by different rules, so any `data/.<name>` entry skipped the extension whitelist entirely, at any depth, and the two dotfile entries in that whitelist had never matched anything. One derivation now serves both. Tightening the restore alone would have reversed the asymmetry rather than closing it, so the export is held to the same list and names what it leaves out, and a restore reports how many entries it refused instead of leaving that in a log line.
- Fix (ci): **an arm64 build failure published a release nobody could install** (#831, issues #764 and #638). The Release job declared the manifest promotion among its dependencies but never checked it, and the updater polls the GitHub Release rather than the container registry, so every Raspberry Pi would have been told an update was available and every pull would then have failed. Worse than the report: the amd64 job also pushed `:latest`, which `docker-compose.yml` pins, so an arm64 failure repointed it at an amd64-only manifest and the next pull would have failed outright rather than merely showing a phantom update. The Release is now gated on the manifest, `:latest` is published only once both architectures are merged, and a withheld release turns the run red instead of leaving a green run with a grey job. A dispatched tag can no longer publish a Release for a version that has no images. Workflow inputs no longer reach a shell script directly.
- Fix (backup): **an equipment name containing a backslash corrupted the InfluxDB half of a backup** (#844). Line protocol escapes with a backslash, and the tag escaper handled the comma, the space and the equals sign but not the backslash itself, so a name ending in one was written verbatim and the parser read the separator that followed as escaped: the tag swallowed the comma and the rest of the line was misread. Tag values carry equipment and device names, so this is whatever the household typed reaching a format with its own escaping. Found while triaging the code-scanning backlog, where two of the three candidates turned out not to be bugs at all: a request body cannot carry a `__proto__` key past the JSON parser, and a computed key in an object literal defines an own property rather than reaching the prototype setter. The same change takes checked-in build output and the operator scripts out of the scanner's scope, which removed a third of a 72-alert backlog that was reporting minified third-party code back to us and failing unrelated pull requests.
- Fix (packages): **a package id and a repo reference are checked where they become a path and a URL** (#845, #847). A package id reached `resolve(pluginsDir, id)` unchecked and the result was handed to `rmSync({ recursive: true })`, `rename()` and `cpSync()`, so an id of `../../etc` would not merely have read the wrong file. `getPackageDir` was already meant to be the one place an id becomes a path, but six call sites bypassed it with their own inline resolve, including install and uninstall. It now states what an id may be and then proves the resolved path stays under the packages root, because the two checks fail differently. The format allows underscores, which is not a detail: `panasonic_cc`, `legrand_energy`, `mcz_maestro` and `netatmo_weather` are real registry ids, and the lowercase-and-dashes rule that seemed obvious would have refused to load four shipped plugins. The same value also reached the path of an authenticated request to GitHub, so one checked constructor now builds that URL. `restoreFromFile` had the same gap in blacklist form, refusing `/`, `\\` and `..` while missing `.`, which resolved to the backups directory itself; it states what a filename may be instead, and refuses a path rather than quietly reading its last segment.
- Maintenance (ci): **third-party actions are pinned to a commit and every release job declares its permissions** (#846). A moving tag is a promise the publisher can rewrite, and these run with package-write rights. The cost is giving up automatic patch updates, which is acceptable because the dependency bot already proposes the new commit weekly, so the update becomes a diff somebody reads. Three jobs inherited the repository default token scope and now take the least they need, one of them nothing at all.
- Maintenance (ci): **test files are typechecked, and the 75 errors that hid there are fixed** (#842, issue #834). The compiler configuration excluded every test, so a test could assert on a type that does not exist and the checks stayed green. Three were exactly that: a filter proven against two event types removed from the engine, a debounce armed by a payload shape the bus cannot produce, and seven route files asserting that a role which has never existed is refused, while the one real non-admin role went untested. The rest is drift, each naming the type that moved under the test. No test behaviour changed, and the gate is blocking from the start because the count is at zero and the point is to keep it there.
- Fix (ui): **the Live page has one heading shape, and the flow diagram has a heading at all** (#848, issue #818). Four cards carried three different headings and one missing: the phase and consumption sections at one size with no icon, the arbitration card at another with an icon and a hint, and the flow diagram, the first thing on the page, unlabelled. The arbitration card read best, so its shape was extracted and used by all four rather than copied, which is how they came to differ.
- Maintenance (api): **the last hand-rolled request bodies are schema-validated** (#837, #841, issue #597). Widget, tariff and plugin bodies were deferred because they are conditional or nested; existence lookups stay in the handler and keep their original status, since converting a shape check is not a reason to renumber an answer a client may depend on. Running the same request bodies through both the old and new validation, and diffing the answers, is what kept the conversion honest: it caught a fractional weekday that no day could ever equal, a slot bound that accepted any truthy value, and a price of infinity that was silently stored as null and poisoned every cost computation until someone re-saved the form.
- Maintenance (docs): the documentation currency gates from spec 167 land alongside a sweep that corrected the architecture reference against the code, retired a French data model describing another product, and completed the specs index (#817, #819 through #827). The plugin registry tracks zigbee2mqtt 2.7.0 and pool-pump-schedule 1.8.2 (#816, #828).

---

## 1.62.x: What never happened, and never said so

### v1.62.0 — 2026-08-29 { #v1-62-0 }

Two of the three headline changes are about the same shape of defect: the engine did something, or failed to, and nothing on screen said so. An order dropped because its integration was not connected yet, and a plugin's new data sitting on a device it never reached.

- Fix (equipments): **an order issued before its integration is connected is no longer lost** (#812, issue #702). Recipe instances went live roughly ninety lines of boot before `integrationRegistry.startAll()` had connected anything, so their first orders were dispatched at integrations that could not carry them. Each failed with "Integration not connected" and was dropped: the recipe advanced its internal state as if it had acted, and nothing brought the device back in line until the next trigger, which for a schedule-driven recipe is hours. Two per boot on the reference installation, in every retained log file. Most were comfort setpoints the next evaluation re-applies, but one was a pool pump OFF, which is the exact failure class of the incident that produced spec 141. Investigating showed the boot window was one symptom of something wider: the guard that refuses to dispatch at a disconnected integration threw before the order outcome was emitted, so neither `equipment.order.executed` nor `equipment.order.failed` reached the bus, and the order confirmation tracker, which exists precisely to model "the order did not land", was blind to this whole class at any time of day. A mid-afternoon MQTT drop lost orders the same way. The fix is two-layered, because either half alone leaves a hole. Recipe instances now start at the very end of boot, behind a bounded wait on the integrations reporting connected, which removes the case that fired on every single restart; only running-instance state waits, since the API has been listening and the recipe packages loaded well before, and the cap means one unreachable cloud integration cannot hold every automation. Whatever still slips through is now held and re-dispatched once when that integration connects, within a window deliberately far tighter than the existing one-hour device-reconnect retry: a schedule-driven command replayed long after its slot would be worse than the one that was lost. Callers still receive the same error they always did, so no installed recipe package changes behaviour. That replay needed a signal that did not exist: `system.integration.connected` was in the event union and plugins were allowed to emit it, but nothing in core ever did, so no consumer could depend on one. The registry now derives it by sampling plugin status, which also covers a plugin that drops and recovers between two samples. A held order stays silent for a grace period before it is surfaced, because the integration is normally back within seconds and alarming on the failure itself would push a failure and a recovery notification per held order on an ordinary restart.
- Feat (equipments): **the values a plugin starts publishing after binding time are now offered, instead of staying invisible** (#813, issue #707). Auto-binding runs once, when an equipment is created. A plugin update that begins publishing new keys creates the device rows at discovery, but nothing revisits an equipment bound before those keys existed. Weather Forecast 2.0.0 published seven new points: the device showed thirty-two, the equipment kept its twenty-five bindings, and the card rendered exactly as before. The only remedy was the device selector, which removes every binding and rebuilds, losing custom aliases and per-binding historization, so owners added the keys one at a time, having first guessed that this was what was needed. Rebuilding automatically was considered and rejected: `data_bindings` records only what is bound and keeps no trace of what was deliberately unbound, so an automatic pass cannot tell a genuinely new key from one the owner deleted, and would become "Sowel puts back what you delete, once per plugin update". Making the trigger a user action removes the need to track that at all, and with it a table, a migration and a detection loop. The bindings section now reports what the devices publish that the equipment is not bound to and offers the list, everything checked, with unchecking as the way the owner keeps the decision; nothing is written before the confirm. Two things the proposal gets right that a plain difference would not, both found in review. On a multi-channel device the equipment owns one functional channel and which one is recorded nowhere but in its own bindings, so the channel is inferred from what is already bound: offering the default first candidate would have put a foreign relay's state and command on the equipment, the cross-channel pollution spec 150 exists to prevent, and left a count that could never reach zero for anyone bound to the second channel. And a point already bound under a renamed alias is skipped before an alias is allocated, so a second temperature sensor is offered `temperature` rather than `temperature_2`, which matters because the zone aggregator folds only the exact alias into the room average. Historization is resolved through the rule the history writer itself applies, moved to a shared module rather than restated in the interface, so the list marks what would start being recorded and counts it before the confirm. The concern was never that values historize, it is that it happened silently; forecast bindings are in fact excluded by that rule, and the list says so.
- Feat (energy): **the arbitration roster fills the need on every row, and says why nothing is starting** (#809, issue #807). The Need column was filled for a pending claim only, so on a typical installation three rows out of four rendered a dash and read as missing data. That was the contract rather than a bug, but two things were wrong with it: what a load takes to start is a property of the load, true whether it runs, waits or sits idle, and blanking it hid the only place the engagement margin was ever visible. And the question a user actually asks in front of that table, why nothing is starting, had no answer on screen although the engine already computed the reason and rendered it nowhere. A gap column now shows it.
- Feat (ui): **the plugins list is rebuilt as a compact row with a detail sheet** (#805, issue #749). On a 390 px viewport the plugin name did not truncate, it disappeared: the action block was horizontal and refused to shrink, so it pushed the name out of the row entirely. The row is now compact and the detail moves into a sheet, which also gives the bulk update banner somewhere to live.
- Fix (ui): **the energy pages are no longer pinned to French** (#808, issue #730). Not one oversight but a duplicate: the period selector existed twice, in the history and energy folders, as the same component, and only the Analyse copy was ever translated. The energy copy also pinned its date formatting to `fr-FR`, a literal repeated sixteen times, so an English user reading their own consumption got French headings and French dates.
- Fix (ui): **the alarm banner is worded in the reader's language** (#811, issue #720). The banner showed each alarm in whatever language its string happened to be written in. Low-battery alerts were composed in English, twice over, on the engine side and again in the interface; a failing integration was composed in French, both by the plugin raising it and by the block that restored it on reload. Whichever language the reader had chosen, some part of the banner contradicted it. The plugins' own poll-failure alarm was re-worded in the same pass.
- Maintenance (deps): **pino 10, and no worker thread for a logger that writes nothing** (#799). Held back because it did not fail the suite, it hung it: about twenty seconds became nine hundred and thirty-four, and one test file sat at over two thousand seconds at zero percent CPU. Blocked rather than busy, which pointed at worker threads rather than at anything pino 10 changed semantically. A silent logger now skips building a transport worker at all.
- Maintenance (deps): **suncalc 2, with the conversion rewritten** (#802, issue #674). Four separate changes in one major, each failing in its own way, so the conversion was rewritten rather than patched, and pinned.
- Maintenance (ci): **the development toolchain is grouped into one proposal per ecosystem** (#798). Excluding linters, the formatter and the compiler from the library groups was right, since a tooling bump fails checks on unchanged code and inside a library group that failure blocks every unrelated update. It also produced a stream of single-package proposals. They are now one per ecosystem, which addresses the noise rather than the symptom.
- Maintenance (dev): **the Node version developers get is pinned, not just floored** (#804). The manifest declared a minimum, which was read as permission: a machine on Homebrew's plain formula sits on an odd-numbered line that never becomes LTS, so it ran a runtime nobody else in the pipeline uses.
- Maintenance (deps): **the interface moves to eslint 10** (#797), catching up with the backend. The four packages peer-lock to each other, so none of the individual proposals could install on its own; bumped together they resolve cleanly, with no runtime dependency touched. Type definitions for the backend follow (#800, #801).
- Refactor (ui): **the equipment type metadata moves into its own module** (#803). A module exporting both a component and something else loses fast refresh, so an edit there reloaded the page instead of preserving state.
- Tests (core): **the shutdown guard is bounded to the closure itself** (#795), adopting the technique from @alpitux's own fix for the same defect, which was open thirty-seven minutes before the guard was written and had not been looked at first.
- Docs: **the plugins detail panel and the bulk update banner are described** (#806), and the technical documentation catches up with this release: the integration lifecycle now covers the connection transitions the registry emits and what rests on them, and the plugin development guide says plainly that a new data point does not reach existing equipments on its own, where the owner picks it up, and why renaming a key is worse than adding one.

## 1.61.x: Off an end-of-life runtime, and a clean audit

### v1.61.0 — 2026-08-28 { #v1-61-0 }

No feature and no behaviour change. This is a maintenance release, and the reason it is worth its own version is that Sowel had been running on a Node that stopped receiving security patches four months earlier.

- Maintenance (core): **the runtime moves from Node 20 to Node 24, the active LTS** (#761, #768, #778). Node 20 reached end of life on 2026-04-30, so every instance had been running an unsupported engine since then. That outranks any single dependency advisory, because it is the thing everything else runs on. The move went to Node 22 first, then straight on to 24: Node 22 is an LTS but entered maintenance in October 2025 and ends on 2027-04-30, so landing there would have meant scheduling the next migration almost immediately. Node 24 runs to 2028-04-28. The line that actually decides the production runtime turned out not to be either `FROM node:` in the Dockerfile, but the NodeSource call in the third stage, which is a plain Debian image chosen for Python 3.13: bumping only the two `FROM` lines would have shipped an unchanged runtime with every check green. Node 24 forced one dependency along with it. `better-sqlite3` 11 compiled fine against Node 24 and passed every smoke test, then crashed ten of the test suites in worker teardown: its `Statement` destructor removes an environment cleanup hook after the environment is gone, which Node 22 tolerated and Node 24 asserts on. That is a teardown-order bug, invisible to anything short of running the suite, and it is exactly why the migration is verified by CI rather than by hand. `better-sqlite3` 13 fixes it, brings SQLite 3.49.2 to 3.53.4, and rather than deferring the same problem to the next Node major, it removes the category: version 13 abandons `prebuild-install` for N-API prebuilds, so the binary it ships is no longer bound to a Node ABI version at all. That also takes twenty-three packages out of the production tree, the entire download chain the old build helper needed. The move also crosses OpenSSL 3.0.19 to 3.5.7, which was treated as the real risk rather than the native modules; outbound TLS was checked against every endpoint the engine calls, and the reference installation's MQTT brokers turned out to use no TLS at all.
- Maintenance (backup): **the backup writer moves to archiver 8** (#752). Not a drop-in bump: archiver 8 removes the callable factory entirely, so both call sites now construct the format class directly. Because this is the code that produces the archive you would restore from after a disaster, it was verified rather than assumed: a real export and restore round trip against a copy of a production database, comparing a content hash of every backed-up table rather than a row count, since a writer that mangled values while preserving cardinality would pass a count check. All thirty tables came back identical. A test was added that reads the exported archive back with an independent unzip implementation and pins the compression method, so a future major cannot report success while writing an archive nobody can open.
- Maintenance (deps): **the frontend build moves to vite 8 and the test runner to vitest 4** (#750, #751). vite 8 replaces rollup with rolldown, so the bundle was compared rather than trusted: slightly smaller, same PWA precache set, and the built page was driven in a browser against real data to confirm it renders. vitest 4 removed the option the UI suite used to route component tests to jsdom, so the two tiers are now expressed as projects; test counts were checked on both sides of the change so the rewrite could not silently stop collecting a tier.
- Security (api): **the rate limiter can no longer be bypassed over IPv6** (#783). `@fastify/rate-limit` counted requests against the raw client address, so anyone holding an IPv6 prefix could rotate through addresses inside their own range and never reach the limit. Version 11.2.0 keys on the /64 prefix instead. There is no fix on the 10.x line, which is what forced the major. The endpoints this guards are the ones that matter, since login and multi-factor verification each carry a tighter limit of ten requests per minute on top of the global one. Sowel does not sit behind a trusted proxy, so the exposure was to direct IPv6 clients rather than to anyone able to forge a header.
- Maintenance (deps): **the remaining major upgrades** (#661, #771, #780, #781, #782, #786, #787). `@fastify/cors` 11 narrows a default set of allowed methods that Sowel already overrides explicitly, so nothing changes for it. `lucide-react` reaches 1.0, which removes the brand icons: every one of the one hundred and sixty-four icons the interface uses was checked against the new package before the bump, and the icon picker resolves through a static import map rather than by name, so no value stored in a dashboard can point at an icon that no longer exists. `@vitejs/plugin-react` 6 drops Babel outright, because Vite 8 performs the refresh transform through Oxc: eight packages leave the tree and the bundles come out identical byte for byte. The rest is lint and test tooling, where one entry was not cosmetic, since rollup carried a high severity path traversal advisory with no fix below 4.59.
- Maintenance (security): **the backend dependency audit goes from twenty-two findings to zero**, three criticals included (#669, #753, #754, #755, #757, #759, #760, #762, #765, #766). Most of it is ordinary advisory patching. The last four had no automated pull request at all, and the reason is structural: none of them needed a manifest change, so there was nothing for the updater to open a pull request against. Every parent already declared a range that admitted the patched child and the lockfile had simply gone stale, so refreshing those entries was the entire fix. Forcing the versions through `overrides` was measured and rejected: it scored worse on the audit count, and npm offers no safety net for one. A control test forcing a major that violated all three of its consumers' declared ranges still reported no invalid dependency at all, because npm treats an override as rewriting the spec rather than breaking it.
- Maintenance (logging): **dotenv no longer prints a banner on stdout at startup** (#758). Its version 17 default logs a line on load even when there is no `.env` file to read, which is the production case, and production logs are newline-delimited JSON captured by Docker. Hygiene rather than a live bug: the line never reached the file transport or the in-app log viewer.
- Tests (api): **the static file serving and the single-page fallback are now covered** (#763). The block that serves the entire React application had no test, so a green suite said nothing about whether a refresh on a client-side route still returns the application instead of a 404. Fourteen cases, including four traversal shapes.
- Fix (core): **the engine no longer risks crashing on the way down** (#792, reported by @alpitux from testing the release candidate). Four subsystems were constructed at startup and never torn down on shutdown, the equipment status tracker among them. It owns a sixty second tick and a two hundred millisecond debounce, and it stayed subscribed to the event bus for the whole shutdown, so live device traffic kept arming fresh work right up to the moment the database closed. A timer armed just before the close fires just after, and the recompute throws on a closed connection; in the worst observed case the crash handler then failed to log, because the logger's worker thread was already exiting, and re-entered itself for sixty fatal lines. Nothing was lost, since the container restarts itself, but a clean stop should be clean. The defect had been latent since v1.14.0 and only became reachable in v1.55.0, when the graceful shutdown was fixed to actually run: before that the process exited before it could bite. The fix is one teardown call per subsystem, and a test that asserts the property rather than the instance, since anything the engine constructs that owns a teardown method must be stopped before the database closes. The unit tests on the tracker itself all passed before the fix, which is exactly why the guard checks the wiring instead.
- Maintenance (ci): **the merge gate drops from about 100 seconds to about 70, without dropping a check** (#784). The UI suite was running inside the backend job while the frontend job sat idle, the gitleaks workflow fired on every branch push and produced a duplicate required check, and the backend job cached the wrong lockfile path. Nothing was removed to get there: every check that gated a merge before still gates it.
- Maintenance (release): **a test build no longer moves the `:latest-arm64` tag** (#789). The manual workflow promises it does not touch `:latest`, and on the amd64 side that held, because the tag list is assembled conditionally. The arm64 job hardcoded `:latest-arm64`, so every test build repointed it. Caught while building the release candidate for this version. The multi-architecture `:latest` was never at risk, since it is assembled in a step that was already gated, but a floating tag pointing at a candidate build is a trap for whoever pulls it next.
- Maintenance (packages): **the pool pump and solar water heater recipes are bumped in the registry** (#748, #788).

## 1.60.x: Describing a load that has no meter of its own

### v1.60.0 — 2026-08-27 { #v1-60-0 }

- Feat (energy): **a recipe can now tell the arbiter whether its load actually needs current** (spec 166). Since v1.59.0 the ribbon can say that a granted load is consuming nothing, but only from the load's own power measurement, which leaves every unmetered load permanently described as "granted" however long it sits idle. On the reference installation that is two of four arbitrated loads: a pool pump exposing only an on/off state, and an inverter pool heat pump driven by a setpoint whose reported state comes from a different device than the one Sowel commands. Reading that relay state was considered and rejected, since it lies on a load with shutdown inertia and says nothing at all about an inverter. The component that knows is the one that asked for the surplus, so a claim handle gains a way to declare it, and the arbiter stays out of the appliance's business: it receives a yes or no and never asks why a pool is warm enough. A fresh measurement always wins, because the declaration says what the recipe wants while the meter says what the appliance does, and the gap between the two is exactly what the previous version was built to show. Two rules came from the review rather than the design: a state the meter has already set is held through a gap in reporting rather than handed back to the recipe, otherwise a load reporting more slowly than the two-minute freshness window flips between the two sources at every gap; and the first contradicting measurement overturns a declaration at once, since on such a load the confirmation window could never mature and a load drawing 2 kW would have read "granted, consuming nothing" for ever. Deliberately not a fault: a heat pump between compressor cycles and a water heater whose thermostat has cut off are both declared needing and measured idle, and both perfectly healthy. Nothing changes for a load with its own meter, and an installation where no recipe declares anything behaves exactly as it did. (#746)
- Maintenance (packages): **the Zigbee2MQTT plugin is bumped to 2.6.0** in the registry, carrying the wire literals of boolean readings added in v1.59.0. (#743)

## 1.59.x: One state for the arbitration surface

### v1.59.0 — 2026-08-27 { #v1-59-0 }

- Feat (energy): **the arbitration card now tells one story instead of two** (spec 165). The card is a roster table above a timeline ribbon, and until now each half decided a load's state on its own: the roster flattened four arrays in the browser and re-derived from their fields, the ribbon replayed the decision journal in the engine. Nothing kept them in step. A water heater holding a grant while drawing nothing read as muted green in one half and a solid "Granted" pill in the other, at the same instant; after sunset a waiting claim read "At rest" above and stayed yellow below. The engine now resolves every load's state in one place and publishes it, the browser renders it, and one vocabulary replaces the three key families that had drifted apart. No arbitration decision changed: not one grant, revoke or reservation differs. (#738)
- Feat (energy): **the ribbon tells a grant that produced something from one that produced nothing.** Every quarter under a grant was painted the same green, so a water heater sat off for a week under an unbroken green band and the surface built to answer "where did my surplus go" could not say that the allocation produced nothing. A quarter where the load held its grant and was measured drawing keeps the current green; one where it held the grant and was measured idle gets the same green at 35 %, muted enough to read at a glance. The measurement is the only evidence used, because a reported relay state lies on an inertial load. Observation only, no control change. (spec 164, #734)
- Feat (devices): **an integration can now declare what a boolean reading looks like on the wire.** Sowel deliberately refuses to guess the polarity of vocabularies like OPEN/CLOSED or LOCK/UNLOCK, since a wrong guess is worse than a visible warning. But it was also refusing on devices that are not ambiguous at all: a Tuya smart plug reporting `child_lock: "UNLOCK"` on an expose that states precisely which literal means on, producing a warning and a raw string in a column declared boolean at every discovery. An integration can now pass the pair it already knows, and the declaration wins over the built in vocabulary. Nothing changes when it is not declared, so the refusal to guess stays exactly where it was. Contributed by computingify. (#728)
- Fix (energy): **the journal no longer accuses a load that draws nothing of ignoring a revoke.** The watchdog had one proof that a load had stopped: grid export rising by half the revoked watts inside the grace window. That proof is worthless for a load that was consuming nothing, and in the evening the export keeps falling for reasons unrelated to the load. On a real installation the water heater, away for the week and drawing nothing, was revoked with the rest and ten minutes later the journal read "did not turn off on request". Worse, the same watchdog marked it unresponsive for twice the grace window, locking an innocent load out of any new grant for about twenty minutes. The watchdog now takes the load's own measurement over the grid proxy, and a load with no evidence either way still falls back to the export proxy, so a recipe that genuinely ignores a revoke is still caught. (#733)
- Fix (energy): **three defects found reviewing the new arbitration surface, fixed before they could reach an installation.** A load claimed before anyone opened the arbiter settings page got a roster row with no ribbon lane under it, the exact divergence spec 165 exists to remove. Dormancy was derived from the raw grid reading and sat in the event coalescing key, so a battery home crossing zero export at night emitted a status event per meter sample, refetching and flickering the card in every open tab. And the read model route's fallback had quietly fallen behind the fields added to it, hidden by an inferred return type. (#740)
- Maintenance (security): **three dependency advisories closed.** `@fastify/multipart` 10.1.1 (two advisories, on the backup upload path, verified end to end against a copy of production data before merging), plus the transitive `brace-expansion` and `serialize-javascript` fixes. (#665, #682, #735)
- Maintenance (deps): **the frontend dependency backlog is cleared.** Fourteen libraries move in one group, react 19.2.8, tailwind 4.3.3, recharts 3.10.1 and the rest, unblocked by a tooltip type migration recharts 3.10 required. i18next 26 and react-i18next 17 land together, along with @types/node 26, globals 17 and lint-staged 17. No behaviour change is expected anywhere; the tooltip formatting is pinned by new tests and the translation rendering was checked against real data. (#737, #739, #668, #659, #656, #666, #670, #660, #736)
- Docs: **an energy monitoring tour on docs.sowel.org**, and the deep dive articles are now reachable from the landing page instead of only by URL. (#731, #726)

## 1.58.x: Knowing when the panels stop performing

### v1.58.1 — 2026-08-26 { #v1-58-1 }

- Fix (energy): **the panel health card now says where its reference stands while it builds.** Observed within an hour of v1.58.0 reaching a live installation: the household backfilled a year of production, opened the health card, and read a generic "waiting for clear midday hours" line. Underneath, the check was working — qualifying days were accumulating — but the reference needs 30 of them since the declared capacity change, and days from before that change describe hardware that is gone. The wait was correct; the silence about it was not, and it read as the history being ignored. The card now shows the days it already has and states its progress: how many clear days are in, how many are needed, and since when they count — with the threshold and the cutoff date coming from the server so the display cannot drift from the rules. The building-state chart deliberately omits the dashed reference line: a figure still under construction is not drawn as a standard. (#725)
- Docs: **two in-depth articles on docs.sowel.org** — the surplus arbiter (every setting documented, the decision loop, the failure modes) and panel health monitoring (the measured design and its validation against a real eight-month outage), each in a reader-facing half and a technical half, in English and French. (#723)

### v1.58.0 — 2026-08-26 { #v1-58-0 }

- Feat (energy): **Sowel now tells the household when the solar installation stops performing** (spec 162). v1.57.0 taught Sowel what the array should produce in any given hour; nothing noticed when it stopped. Once a day, measured production is divided by the sunlight that actually reached the panels — plane-of-array irradiance the forecaster already computes — on clear midday hours only (10-16 h local, direct fraction above 0.75, at least four such hours), so a cloudy week is skipped rather than counted as a failure. The day's ratio is compared with what the array has recently shown itself **capable of**: the 80th centile of the trailing 180 qualifying days, not a median, and that choice is the whole feature. Replayed against a real eight-month single-panel outage on the reference installation, a rolling median covered 7 % of the fault days — the fault fills the window, becomes the reference, and is accepted as the new normal — while the high centile covered 91 % at the same 2 % false-alert rate. Three consecutive clear days more than 10 % below raise one alarm, through the same channel as every other Sowel alarm (notifications, banner, zone activity feed), with the reference frozen at the raise so the fault cannot erode its own baseline; three clear days back above it resolve it. On the replay the detector confirmed the outage in two clear days, held the alert through the winter, resolved it at the repair, and stayed silent through a +1 kWc extension that was declared. The card states its own limits plainly: how fast it can currently see at the rate clear days are arriving (near-dormant in December, and it says so), that it names a fault's size, and never which panel. (#719)
- Feat (ui): **PV monitoring now lives in Energy > Production, its configuration in Settings > Energy** (spec 163). The forecast, its accuracy record and the new health card had all landed on the production meter's equipment page — mixing hourly observation with a once-per-array-change admin act, and hiding "how is my solar doing" behind Equipments while the Production page was a lone bar chart. The monitoring panels now render under that chart, one block per declared meter; the declaration form and the fit-from-history action sit next to tariffs and the arbiter in Settings > Energy; the equipment page keeps what describes the meter as a device. The declared peak power stays visible on the monitoring view — a stale declaration must be seen where it does the damage — and links, for admins, straight to the section that fixes it. (#721)

## 1.57.x: Knowing what the panels will produce

### v1.57.1 — 2026-08-25 { #v1-57-1 }

- Fix (energy): **the production chart now draws what the meter recorded, even before any forecast can be compared against it.** Reported an hour after v1.57.0 reached a live installation: the chart showed the expected-production curve over an empty past while the meter's own readings sat in the database, plainly known and invisible. The measured line was fed from the forecast-versus-actual comparison, which by design only holds hours where a forecast _issued the day before_ can be paired with what happened — and an installation declared this morning has no forecast history at all. So the line had nothing to draw for a full day, which is exactly when a household is looking hardest. The comparison figure still counts only paired hours and is unchanged; the line no longer depends on it. (#717)

### v1.57.0 — 2026-08-25 { #v1-57-0 }

- Feat (energy): **an hourly forecast of what your solar installation will produce, to five days out** (spec 160). Sowel already knew what the panels _had_ produced; it could say nothing about what they were about to. The household declares the installation once — tilt, orientation, peak power, one entry per roof pitch — and everything else is measured rather than asked for. Shading in particular is never declared: the model learns it. On the reference installation it came out as 53 % efficiency at 08 h and 61 % at 20 h, which is that owner's trees, and 89 % at the hottest hours, which is thermal derating. The model is deliberately unremarkable arithmetic, a scalar gain plus one coefficient per hour of the day, refit nightly on a rolling 45 days. Measured against three alternatives on 92 days of production data it beat a physical model of the array (158 W of hourly error against 310 W) and a fit over a dictionary of candidate orientations (323 W). Requires **version 2.3.0 of the Weather Forecast plugin**, which publishes the irradiance the projection needs. (#711)
- Feat (energy): **the forecast can be fitted from production you have already recorded, instead of waiting twelve days for it to learn** (spec 161). Learning from scratch needs about 120 usable daylight hours, so a household that had just declared its installation saw a provisional estimate for a fortnight. One action now rebuilds the model from history Sowel already holds. Measured on days the model had never seen: 186 W of hourly error, and 101.7 kWh predicted against 100.1 recorded. The bound is the whole point — the reference installation gained 1 kWc mid-window, and fitted across that date the gain describes neither the array before nor the one after, doubling the error to 325 W. So the window is the shorter of 45 days and an optional "unchanged since" date, which only the household can supply. Nothing is deleted until a fit has actually succeeded, so a mistyped date cannot cost you the history you had. (#713)
- Feat (ui): **forecast and reality on one timeline.** The expected-production curve and the forecast-versus-actual comparison were two charts stacked on top of each other, showing the same quantity in the same unit on stretches of time that touch — one ends at now, the other starts there. They are now a single chart: the past carries both curves, a marker says where the record stops, and the forecast continues alone. A past hour shows what was actually promised for it the day before, never a value recomputed since, which would flatter the model against its own record. The window reaches back 7, 30 or 90 days. (#714)
- Feat (ui): **the forecast's confidence reads as a colour, not as engineering notation.** `± 0.9 °C` under a temperature tells a household nothing it can act on. Each day now carries a three-level pill — high, moderate, low — with the contributing models named underneath. (#708)
- Feat (activity): **the zone activity feed now records alarms being resolved, not only raised.** It subscribed to `system.alarm.raised` and never to its counterpart, so every incident was told half: a mains outage appeared and never appeared to end. (#709)
- Fix (ui): **a production meter no longer labels the energy it produced as consumed.** The cumulative-energy card never looked at what the equipment was. (#714)
- Fix (ui): **dates and weekdays now render in French for a French household.** Three components compared the detected language against `"fr"` for equality, but the browser reports `fr-FR`; translations resolved correctly while every date beside them stayed American. (#713)
- Maintenance (packages): **the Weather Forecast plugin is bumped to 2.3.0** in the registry, carrying the ensemble confidence, the irradiance series and the 45 days of past irradiance the two features above need. (#715)
- Maintenance (packages): **the NUT community plugin is bumped to 0.2.0.** (#710)
- Maintenance (docs): **a maintainer playbook for triaging dependency updates**, distilled from a full backlog pass: read why a PR is red before acting, bump peer-coupled majors together, and the versions currently held back on purpose. (#690)

## 1.56.x: Knowing how much to trust the forecast

### v1.56.0 — 2026-08-24 { #v1-56-0 }

- Feat (ui): **the forecast card now shows how much to trust its own numbers** (spec 159). Until now it showed one temperature per day with no way to tell a figure the models agree on from one they do not, and a household acting on "tomorrow reaches 34 °C" had no way to know whether that meant 33 to 35 or 29 to 37. The card now prints the uncertainty under each daily maximum and names its source under the row: `AROME 2.5 km`, or `median of 4 models`. A day whose models span 8 °C reads immediately as not actionable, which no single blended number can express. The figures come from **version 2.0 of the Weather Forecast plugin**, which resolves each day across every model that covers the home instead of accepting an undisclosed pick, and derives a genuine rain probability from 51 ensemble members. Until that plugin is updated the card renders exactly as before, so the two can be updated in either order. (#704)
- Maintenance (packages): **a community NUT plugin joins the registry**. `sowel-plugin-nut` exposes the uninterruptible power supplies served by a Network UPS Tools server, the stream shipped by Synology, QNAP, Proxmox and most Linux hosts, and pairs with the UPS equipment type added in v1.53.0. It comes from outside the official author list, so Sowel flags it as a community package and asks for an explicit confirmation at install, showing the archive's fingerprint. It requires Sowel 1.53.0 or later. Contributed by adn-dev-adrien. (#703)

## 1.55.x: Measuring the arbiter, and fixing what every restart was losing

### v1.55.0 — 2026-08-23 { #v1-55-0 }

- Feat (energy): **the arbiter's own behaviour is now measured and kept** (spec 158). The decision journal and the surplus series are purged after 7 days, so questions like "how often does this load start and get revoked minutes later" had no answer past a week, and every tuning change was argued from intuition. An hourly rollup now aggregates them into two daily tables kept 400 days: per load, the number of grants, revokes, **short cycles** (a grant revoked for a surplus deficit inside its own minimum-on window, i.e. a load that started on a surplus that did not hold), and the seconds spent granted, waiting, running outside arbitration or suspended. Per day, the export, the import, the surplus a load was actively waiting for, and the surplus a shiftable load could have used had something scheduled it. Read it with `GET /api/v1/energy/arbiter/metrics` or `scripts/energy/arbiter-metrics.ts`, which opens the database directly and therefore works on a restored backup with no running instance. Pure instrumentation: not one line of the arbiter changed, and no arbitration decision is affected. (#693)
- Fix (core): **the graceful shutdown now actually runs**. An early signal handler registered at the top of boot exited the process immediately, shadowing the real shutdown sequence registered later, and Node runs signal listeners in registration order. The consequence was invisible but real: on every container restart, stop, or self-update, integrations were never closed cleanly, the database was never closed (so the WAL was never checkpointed), and the InfluxDB write buffer was **dropped**, losing whatever energy points were still pending. A single handler now dispatches to the right behaviour depending on how far boot has got, bounded by a watchdog so a stuck plugin cannot turn a clean stop into a kill. (#696)
- Fix (devices): **a device message is now written in one transaction instead of one per attribute**, which is 10 times fewer bytes written to disk and 2.8 times less time per message on the engine's busiest path. The consistency half matters more: events were emitted between the writes, so any consumer re-reading several values of the same equipment saw a partially applied message, once per attribute. In the worst observed case the pool water temperature tracker could persist a stagnant-water reading as the last known good value and serve it for 24 hours. Gate state derivation, submeter classification and zone aggregation were affected the same way. An attribute that cannot be stored is now skipped and logged instead of discarding the whole message, so one bad value from a plugin can no longer make a healthy device look permanently offline. (#697)
- Maintenance (core): **the SQLite `synchronous` pragma is set explicitly** rather than inherited from a dependency's compile flag, so a future bump cannot silently change how often the database is flushed to disk. No behaviour change on an existing installation. (#694)

## 1.54.x: A tap-to-toggle dashboard and a shared power-flow diagram

### v1.54.0 — 2026-08-22 { #v1-54-0 }

- Feat (ui): **the whole dashboard tile now toggles an on/off equipment**. Lights, switches, plugs, water heaters, water valves, heaters, pool pumps, media players and single-action gates switch when you tap anywhere on the card, not just the small button under the icon, matching how the mobile card already behaved. Tiles with several controls (shutters, thermostats, pool covers, VMC) keep their own buttons, and in edit mode the tile stops acting so it can be dragged and renamed safely. A brightness-slider drag released off its track no longer flips the light off. (#689)
- Feat (ui): **the UPS detail panel is rebuilt on a shared power-flow diagram** (spec 157). The Energy · Live routing diagram is extracted into a reusable component, and the UPS panel is rebuilt on it: three cards (the live diagram, a margins-and-thresholds card, and a collapsed technical sheet) replace the previous flat list of undifferentiated rows. Field names are translated, booleans render as a check or a dash instead of the word "false", and no value appears twice. The Energy page renders exactly as before, guarded by a characterization test written before the extraction. (#688)

## 1.53.x: UPS equipment type

### v1.53.0 — 2026-08-21 { #v1-53-0 }

- Feat (equipments): **a new read-only UPS (uninterruptible power supply) equipment type** (spec 156). Model an inverter or UPS as one functional unit with its power state (on mains, on battery, battery low, bypass, overload, output off), its battery charge, its remaining autonomy and its output load. It binds whatever telemetry the plugin reports, renders only the values actually present, and carries no command surface on purpose: an accidental shutdown order to a UPS is unrecoverable, so the orderly-shutdown chain stays with the host running `upsmon`. A new "Power" group gathers UPS equipments in the zone and home views. The companion integration is `sowel-plugin-nut` (Network UPS Tools), which reads the stream shipped by Synology, QNAP, Proxmox and most Linux hosts. (#676)
- Maintenance: **dependency and CI updates**. React Router, PostCSS, nanoid, js-yaml and fast-uri were bumped on the UI, together with a backend minor/patch group and the GitHub Actions used by CI, several of them clearing security advisories. No functional change. (#641, #642, #643, #644, #645, #677, #678, #680)

## 1.52.x: Two-speed ventilation and a steadier arbiter

### v1.52.8 — 2026-08-21 { #v1-52-8 }

- Security (ws): **the live WebSocket now enforces role-based authorization**. Privileged data (MQTT broker and notification publisher configuration, and the server log stream) is delivered only to admin sessions; a non-admin session can no longer subscribe to those streams. Admin behaviour is unchanged. (#646)
- Fix (equipments): **an equipment no longer reads a stale device status as a delivery failure**. After a restart the database still holds the status the last shutdown left behind, until the integration replays the real one a second or two later; the order-confirmation fast path used to treat that as proof the command could not be delivered and raise a false alarm. It now waits for real evidence, and a re-ordered load no longer produces repeated bogus warnings during an integration outage. (#635)

### v1.52.7 — 2026-08-20 { #v1-52-7 }

- Feat (energy): **a per-equipment shutdown delay for the arbiter**. An inertial load (for example an Atlantic Calypso water heater whose heat pump keeps running about 30 minutes after its solar contact opens) no longer triggers a false "revoke not honored" alarm on every release. Set the optional "Shutdown delay" on the equipment's energy panel so the arbiter waits out the tail before flagging it; the anti-cascade protection for other loads stays prompt. With no delay set, behaviour is unchanged. (#632)
- Fix (energy): **cumulative energy is no longer blanked out at the start of an hour, day, month or year**. A zero-width InfluxDB query (for example between 00:00 and 00:59 local, when no hour of the day is closed yet) used to throw and discard every cumulative value for the equipment, producing hundreds of warnings per night. Empty ranges now resolve to 0 without querying, so the readings stay stable across those boundaries. (#633)

### v1.52.6 — 2026-08-19 { #v1-52-6 }

- Feat (equipments): **the per-equipment "invert direction" toggle (spec 154) now covers gate and boolean momentary triggers too**. A relay wired to pulse on the OFF edge instead of ON (reported on a SONOFF MINI-ZBD driving a garage door) can be flipped right from the equipment page, the same toggle already used to invert a shutter's open/close. It stays opt-in per equipment, so existing setups are unaffected. (#628)

### v1.52.5 — 2026-08-19 { #v1-52-5 }

- Feat (equipments): **a per-equipment "invert direction" toggle for shutters and awnings** (spec 154). When a motor's open and close are wired the reverse of what Sowel assumes, and the integration has no bridge-side invert, an admin can now flip the direction on the equipment itself. It applies to every command path (card, zone bulk actions, recipes, modes). (#623)
- Feat (ui): **recipe logs are now reachable on the phone (PWA)**. The log entry point was hidden below 640px; it now opens in a bottom sheet on mobile while keeping the inline panel on desktop. (#622)
- Feat (ui): **the arbiter roster table is now ordered by configured priority** instead of by state, so it reads consistently with the timeline. Each row's state pill still shows whether the load is granted, waiting, suspended or idle. (#621)
- Fix (energy): **an idle submetered load now rolls its daily total over at the hour and midnight boundary**. A power-only submeter that sat at 0 W could keep showing the previous day's cumulative energy overnight (for example a water heater stuck at 2.92 kWh); an hour-aligned refresh now recomputes it from history. (#619)
- Fix (ui): **the "en attente" cells on the arbiter timeline use the same soft waiting tint as the roster table** instead of a solid warning orange, so the timeline reads calmer. (#620)
- Fix (ui): **a two-speed ventilation (VMC) equipment now appears in its zone and home view**. It belongs to a new "Ventilation" group; previously it was silently filtered out of the zone list even though it worked. Its OFF/V1/V2 control is also now a compact segmented pill. (#625)

### v1.52.4 — 2026-08-18 { #v1-52-4 }

- Fix (ui): **the arbiter now labels a load outside arbitration as "hors arbitrage"** instead of the previous, less clear wording, so a load that the energy arbiter is not managing reads unambiguously. (#611)
- Fix (ui): **submetered energy values on the compact equipment card no longer append a redundant "aujourd'hui" suffix**, keeping the card reading tight. (#612)

### v1.52.3 — 2026-08-18 { #v1-52-3 }

- Fix (energy): **the arbiter activity timeline no longer shows a phantom "granted" ribbon after a restart**. When Sowel restarted while a flexible load was granted or waiting, the timeline replayed that state forward to the present even though the load had gone idle. Sowel now closes the dangling segment at the restart boundary, and repairs the persisted journal so every future replay is correct. The load table was always accurate. (#606)

### v1.52.2 — 2026-08-18 { #v1-52-2 }

- Fix (ui): **the "Solar" toggle on the compact equipment card now actuates again**. Tapping it did nothing (the equipment detail page was unaffected); the button's own click handler was being suppressed. Solar automation driven by the energy arbiter was never affected. (#600)

### v1.52.1 — 2026-08-18 { #v1-52-1 }

- Fix (energy): **a load that is manually overridden is no longer listed twice on the arbiter surface**. A flexible load that had a pending request when it was switched on at the wall now appears only as "Suspended", not also as "Waiting". (#599)

### v1.52.0 — 2026-08-18 { #v1-52-0 }

- Feat (equipments): **two-speed ventilation (VMC) is now a dedicated equipment type**. A 2-speed controlled-mechanical-ventilation unit can be modelled directly; its speed order is decomposed into a break-before-make relay sequence so the two windings are never energised at once. Pairs with the vmc-humidity recipe. (#573, #586)
- Feat (equipments): **a dedicated on/off command channel for solar equipment** (spec 152), so a solar production setup can be switched independently of its measurement channel. (#574)
- Feat (energy): **the arbiter surface shows a dormant night state** when no surplus is expected overnight, instead of an idle-looking blank. (#577, #581)
- Fix (cameras): **the HLS live-view proxy now rewrites nested master-to-variant playlists, serves binary `.ts` segments byte-for-byte, and honours the `EXT-X-MAP` tag**. This repairs corrupted segments that affected the Netatmo camera live view. (#580)
- Fix (energy): **the arbiter and activity feed refresh when the connection is re-established or the app returns to the foreground**, so a backgrounded tab no longer shows stale arbitration. (#589, #591)
- Fix (energy): **arbiter timeline pending spans are now closed correctly** instead of leaking open. (#584, #587)
- Fix (energy): **an energy-only submeter is kept out of the live-power display feed**, so the instantaneous power reading is not inflated. (#590, #592)
- Fix (ui): **the equipment detail page no longer refetches on unrelated equipment changes**. (#579)
- Fix (ui): **raw arbiter translation keys (such as the waiting state) are now shown as proper text**. (#575, #576)
- Under the hood: **API input validation hardened** (declarative body schemas across more routes, keeping the 403/404-before-400 ordering) and the equipment order-execution path refactored into named helpers, both fully test-covered. (#453, #482)
- Chore (registry): the vmc-humidity recipe published and updated for native VMC support; zigbee2mqtt registry entry refreshed. (#571, #572, #582, #585)

## 1.51.x: Two-factor authentication and a sharper energy arbiter

### v1.51.0 — 2026-08-17 { #v1-51-0 }

- Feat (auth): **two-factor authentication (TOTP) with backup codes**. Accounts can enable app-based 2FA (Google Authenticator, Authy and the like): a QR-code enrolment in the user settings, a six-digit code at login, and one-time backup codes to recover access if the authenticator is lost. (#541)
- Feat (energy): **a declared flexible load with no active claim now appears in the arbiter roster with a waiting state**. A load you have enrolled but that no automation is currently claiming shows as waiting on the arbitration surface and timeline, instead of being invisible until it next runs. (#561, #562)
- Change (energy): **the surplus arbiter no longer asks you to pick a load class; it is inferred from the equipment type**. The Pilotage énergie panel dropped the Comfort/Deferrable selector. Whether a load is a relay (pool pump, water heater) or self-regulating (thermostat, air conditioner) is a property of the equipment type, so Sowel derives it, and a type with no energy semantics can no longer be declared a flexible load. No migration; existing profiles are unchanged. (#555, #568, #569)
- Fix (energy): **the arbiter surplus curve and pill show the true signed grid balance** (export positive, import negative) instead of an internal reservation figure, so the reading matches your meter. (#563, #565)
- Fix (energy): **a submeter that reports no power measurement is dropped from the consumption breakdown** instead of showing a spurious zero row. (#560, #567)
- Fix (devices): **a `battery_low` indicator is categorised as a generic reading, not a battery level**. (#559)
- Chore (registry): zigbee2mqtt to 2.5.1 (battery_low twin fix), smart-cooling to 2.1.0 (surplus-proportional pre-cooling), pool-pump-schedule to 1.6.2. (#554, #556, #558, #564, #566)

## 1.50.x: Per-equipment surplus tolerance

### v1.50.0 — 2026-08-16 { #v1-50-0 }

- Feat (energy): **how much grid import a flexible load will accept to run on a partial surplus is now set on the equipment, next to its nominal power**. The capacity arbiter engages a load once the surplus covers `nominal power + margin - tolerated import`; that tolerance used to be fixed by each recipe, and now lives on the equipment's energy profile (Pilotage énergie panel) alongside the nominal power and the minimum on/off times. An automation may still override it for a specific claim, but the equipment is the default source of truth, so the same load behaves consistently whatever drives it. Default 0 keeps the previous behaviour. (#550, #551)

## 1.49.x: Universal submetering

### v1.49.0 — 2026-08-16 { #v1-49-0 }

- Feat (energy): **any equipment that measures power or energy now counts in the energy balance, whatever its type**. Submeter enrolment used to be a per-type whitelist (dedicated meters plus metering switches and water heaters); it is now the inverse, so a metering thermostat (an air conditioner on its own energy clamp), a pool pump, an appliance or a metering dimmable light all enter the by-usage breakdown and have their power integrated to energy, with no per-type list to maintain. Only the house total and the production meters are excluded. A binding must carry a real numeric measurement: a boolean on/off reading exposed as "power" (a media player, a thermostat's own switch) is a state, not a measurement, and is never mistaken for a 0 W submeter. The energy display's submeter list is now ordered dedicated meters first so its fixed 8-meter capacity keeps the real clamps. (#523, #548)
- Feat (ui): **the energy profile minimum on and off durations are edited in minutes** instead of seconds, matching how the values are actually reasoned about. (#546, #547)
- Fix (energy): **open unmanaged runs are restored from the journal on startup**, so a load left running outside arbitration keeps its correct timeline after a restart instead of being painted unmanaged until its next full cycle. (#543, #544)
- Chore (registry): pool-pump-schedule bumped to 1.5.0 (the pool heat pump can now heat on solar surplus via its setpoint). (#545)

## 1.48.x: Typed device values and universal gate relays

### v1.48.1 — 2026-08-16 { #v1-48-1 }

- Fix (energy): **a load that is off is no longer painted as "running (unmanaged)" on the arbiter timeline**. A load switched off manually, by a button, or by its own regulation could stay drawn as an unmanaged run indefinitely: an off-triggered suspension mapped unconditionally to unmanaged, the end-of-run close only fired for recipe orders, and a suspension expiry lapsed silently. Decisions now carry the load's on/off state, any observed off (an order from any source or a reported off state, including a comfort load that stops on its own regulation) closes the unmanaged run, and a suspension expiry is journaled with the observed state. (#535, #536)
- Fix (ui): **the Analyse chart X axis stays legible when measurements and states are mixed**. Two series landing on the same instant under different timestamp spellings created two points at the same position, which disabled the axis label thinning and painted every label into an overlapping strip. Reported by Adrien Jouve (computingify). (#537, #539)
- Fix (ui): **the mobile dashboard icon picker opens above the cards in edit mode**. The edit-mode jiggle animation trapped the picker behind the cards below it, with a backdrop that only dimmed its own card; the picker now opens over the whole screen with a full-screen backdrop. Reported by Adrien Jouve (computingify). (#538, #540)
- Chore (registry): pool-pump-schedule bumped to 1.4.2. (#533)

### v1.48.0 — 2026-08-15 { #v1-48-0 }

- Feat (devices): **device values are now normalized once at ingestion, closing the "works in Zigbee2MQTT, fails in Sowel" family of bugs**. A boolean data point always carries a real boolean whatever the device sent ("ON", "true", 1...), numeric strings become numbers, and enum values are recased to their declared form, so every consumer (dashboard, zones, history, recipes, order confirmation) sees one stable type. A value that cannot be safely coerced is kept raw and logged once; polarity-ambiguous vocabularies like OPEN/CLOSED are never guessed. A declaration whose type contradicts its category (a contact sensor declared as text, for instance) is flagged in the log at discovery. No plugin update required: every protocol benefits. (spec 150, #530)
- Feat (equipments): **a gate can now be driven by any on/off relay, including Zigbee dry-contact modules such as the SONOFF MINI-ZBD**. Until now only LoRa relay channels and Somfy RTS remotes were offered as gate actuators; the device picker now proposes any on/off relay as the gate command (momentary action; configure the pulse/inching on the module itself), contact sensors remain bindable on the same equipment for the open/closed state, and the command button now actuates boolean relays (it silently dispatched nothing on them before). (spec 150, #530)
- Fix (ui): **dimmable and colour lights auto-bind again from the equipment creation flow**. The device selector's binding logic had drifted from the backend's and offered zero candidates for these two types; both sides now share a single implementation. (spec 150, #530)
- Fix (energy): **a freshly created power-only submeter shows its energy cumuls at 0 from creation**. A metering water heater that had never run showed its live power panel but no cumuls; it is now enrolled with zeroed counters at creation, and real values take over from the first measurements. (#527, #529)
- Fix (api): **the energy display's submeter query now returns metering relays**. The sowel-energy-display firmware fetches its breakdown via `?type=energy_meter`; since metering relays became consumption submeters that literal filter dropped them. A `?role=submeter` filter was added and the legacy value keeps returning the same submeter set, so an unflashed display picks up a metering water heater with no reflash. (#526, #528)
- Note (equipments): LoRa reed values arriving as strings ("0") previously derived a gate state of closed; normalization now derives open correctly (polarity fix).

## 1.47.x: Water-heater submetering and arbiter UI polish

### v1.47.0 — 2026-08-15 { #v1-47-0 }

- Feat (energy): **a water heater that only measures power is now counted in the energy balance**. A water_heater equipment bound to a power measurement, with no on/off command required, is now treated as a consumption submeter like a dedicated energy meter: its watts are integrated into energy, it appears in the by-usage breakdown, and its day energy shows on its card and detail view. Energy accrues forward from the moment the measurement is bound, with no retroactive backfill. Metering smart plugs (spec 129) also enter the by-usage breakdown for the first time. (#521, #522)
- Fix (energy): **the arbiter surplus curve stays live instead of freezing on a snapshot taken when the page opened**. (#514, #515)
- Fix (energy): **the arbiter state sticker is smaller and coloured by surplus or deficit**. (#511)
- Fix (ui): **the arbiter decision journal reasons follow the app language**. The grant and revoke reasons were shown in English only; they are now localised (FR/EN). (#518, #519)
- Fix (deployment): **container logs are capped and InfluxDB stdout is quieted**. Compose now bounds each container's log file size and sets INFLUXD_LOG_LEVEL so InfluxDB stops flooding stdout, keeping disk use and log noise down on a long-running instance. (#512, #516, #517)
- Internal (ui): the dashboard widget presentation now flows through a shared resolver, with switch, media_player and pool_pump migrated; no user-facing change. (#325, #513)
- Internal (tooling): the Sowel issue skill gained an agent-review phase before the PR is opened. (#520)

## 1.46.x: Analyse page polish, resilient activity, and a clearer arbiter timeline

### v1.46.0 — 2026-08-15 { #v1-46-0 }

- Feat (energy): **the arbiter timeline is redesigned as a signed surplus/deficit curve with per-load ribbons and a decision journal**. The available-surplus view now reads as one continuous curve, green above the line when there is surplus and red below when the house is pulling from the grid, with a lane per profiled load and a running log of the arbiter's grant and revoke decisions. The surplus curve reuses the auto-consumption green so the timeline keeps a single green. (#495, #500, #508)
- Feat (core): **the activity feed and the arbiter decision journal now survive a restart**. Both were kept in memory and wiped whenever Sowel restarted; they are now persisted, so the recent history is still there after an update or a reboot. (#494, #499)
- Feat (equipments): **actuating a gate from a phone now asks for a confirming swipe**. A gate is slow and physical, so an accidental tap (a phone in a pocket) should not open it; a slide-to-confirm guards the action on mobile. (#320, #497)
- Feat (ui): **the Analyse page opens on your first saved chart, on today**. Visiting Analyse used to land on an empty chart builder; it now opens the first saved chart on today's date with the zone and equipment picker collapsed for a cleaner screen. A "New chart" entry (sidebar and mobile drawer) still reaches the empty builder. Reported by Adrien Jouve (computingify). (#498, #505)
- Fix (ui): **the chart point-detail tooltip fits the screen on mobile**. The long "Zone / Equipment / Metric" labels made the tooltip overflow the viewport; it is now a compact card that wraps its labels and stays on-screen. Reported by Adrien Jouve (computingify). (#498, #506)
- Fix (energy): **a relay On/Off curve is now drawn across the whole window**. A state series is only sampled when it changes, so a state that changed once, or not at all, inside the window was drawn from the first sample and stopped at the last one. The step line now starts at the window's left edge in the correct prior state and extends its last value to the right edge. Reported by Adrien Jouve (computingify). (#498, #507)
- Feat (auth): **API token management moved to Settings > Account, and the unused mobile QR login was removed**. Personal API tokens (used by external integrations such as the energy display) now sit next to the password on the Account tab, and the confusing, undocumented QR login on the System tab is gone. (#501)
- Fix (ui): **the dashboard edit button no longer overlaps the bottom navigation on mobile**. On devices with a home indicator the floating edit button dropped onto the "More" / Settings button; its offset now clears the safe-area inset. Reported by Adrien Jouve (computingify). (#496, #504)

## 1.45.x: Arbitration display fixes and UI cleanup

### v1.45.0 — 2026-08-13 { #v1-45-0 }

- Fix (energy): **a load that is actually running is no longer shown as "waiting for surplus"**. When a recipe runs a flexible load as a must-run fallback while its solar-surplus claim stays pending (a hot day with no surplus to grant), the arbitration surface listed it as waiting for surplus even though it was drawing several kW. Such a claim now reads "running (no surplus)" with its own marker; a genuinely idle claim is unchanged. (#491, #492)
- Fix (energy): **a pending arbiter claim shows the surplus it is waiting for, not its own draw**. A claim that tolerates buying a little grid engages well below its own rating, so quoting the full rating read as "it will never start". The row now shows the surplus the arbiter actually tests against, with the appliance rating and the tolerated grid import given as context, and the surplus timeline gained per-run spans for loads running outside arbitration. Contributed by Adrien Jouve (computingify). (#474)
- Fix (ui): **equipment widgets that share a name are told apart by their zone**. Two identically named sensors in different rooms were indistinguishable on the dashboard; each now shows its disambiguating zone on a second line, reusing the shortest-suffix labelling already used elsewhere in the app. Contributed by Adrien Jouve (computingify). (#488)
- Fix (ui): **idle nodes in the live energy diagram stay opaque**. A node at rest dimmed enough for the flow paths to bleed through its icon; the box now keeps full opacity while only its content dims. Contributed by Adrien Jouve (computingify). (#487)
- Fix (ui): **the energy-meter widget now renders on mobile and the media-player widget on desktop**. Each of the two dashboard widget categories rendered on only one breakpoint. (#323, #324, #485)
- Internal (ui): a large maintainability pass on the recipe and publisher UI, with no user-facing change. The 2200-line `ZoneRecipesSection` was split into focused per-component modules with a shared zone-options hook, the notification and MQTT publisher pages were unified onto a shared descriptor-driven editor and mapping-source layer, and a jsdom + Testing Library component-test tier was introduced. (#456, #387, #457, #458, #484, #486, #489, #490)

## 1.44.x: API input validation and OpenAPI

### v1.44.0 — 2026-08-13 { #v1-44-0 }

- Fix (devices): **low battery alerts now name the affected equipment and stay scoped to its zone**. A sensor in low battery surfaced by device name only and showed up in every zone's activity feed. The warning banner and the zone activity now show the bound equipment name next to the device, and the alert is attributed to the equipment's own zone. Contributed by Adrien Jouve (computingify). (spec 143, #472, #473)
- Internal (api): **request bodies are now validated by declarative schemas across most API routes**. The hand-rolled checks duplicated inside route handlers were replaced with Fastify JSON schemas, giving one consistent validation boundary and a single `{ error }` shape for 400 responses. Routes, methods and status codes are unchanged; only the wording of validation error messages changes. Routes that gate on authentication or resource existence inside the handler keep their existing checks for now (tracked in #482). (#452, #475, #476, #477, #478, #479, #480)
- Internal (api): **an OpenAPI 3 description of the API is now generated from those schemas**, served as JSON at `/api/v1/openapi.json` for authenticated users. No interactive documentation UI is mounted. (#452, #481)

## 1.43.x: Low battery alerts and Analyse chart controls

### v1.43.0 — 2026-08-12 { #v1-43-0 }

- Feat (devices): **low battery alerts for battery-powered devices**. A battery-powered sensor could go flat silently: spec 116 treats the radio silence of event-driven battery hardware as normal, so a dead cell still showed as online while the low percentage sat unread. Sowel now watches the battery level of every battery-powered device, raises a system alert at 20% or below (clearing again at 25%), reminds once a week while it stays low, and resolves the alert when the cell is replaced. The equipment card shows a battery marker next to its readings. Devices are detected automatically, and precisely once the Zigbee2MQTT plugin 2.5.0 declares each device's power source. As part of this, system alarms (battery, unconfirmed orders, integration errors) now reach every enabled notification publisher instead of only the first Telegram one, so a web-push-only setup receives them too. Contributed by Adrien Jouve (computingify). (spec 143, #444)
- Feat (ui): **per-series colours and fitted Y axes on the Analyse chart**. Three things were out of reach on an Analyse chart. Series colours followed insertion order with nothing saved, so removing a series recoloured the rest; each series now opens a colour picker and the choice is saved. A measurement axis was anchored at zero, so a tank temperature living between 48 and 55 degrees read as a flat line at the top; a toggle now fits each measurement axis to its own range. And every measurement shared one scale; a chart plotting exactly two quantities now gets an axis each, left and right, grouped by unit. Both settings are optional, so charts saved before this change keep the palette order and the zero-anchored axis, except that a pre-existing chart plotting exactly two different-unit quantities will now open with split left and right axes. Contributed by Adrien Jouve (computingify). (spec 145, #446)
- Internal: broader automated test coverage (the UserManager, several previously-untested backend modules, and the useAuth and useWebSocket UI stores), a tidy-up of the shadow-mode boot gates and the UI API client, and a new CI gate plus backfilled design docs for the spec folders. No user-facing change. (#459, #461, #462, #463, #464, #465, #466, #467, #468)

## 1.42.x: State history and clearer navigation

### v1.42.0 — 2026-08-12 { #v1-42-0 }

- Feat (ui): **equipment states now appear in history, next to measurements**. On/off actuator feedback (a relay, a pump, a switch) was recorded but never drawn, because only numeric series were charted. State values are now stored numerically as well, so the Analyse page can plot a temperature curve and the relay driving it on a single chart, with the relay on its own 0/1 axis on the right. Covers, gates and locks that carry more than two values chart as a plain numeric series. The state historization is core; the Analyse mixed-axis was contributed by Adrien Jouve (computingify). (spec 144, #434, #442)
- Feat (ui): **recipes can show a live status line on their card**. A recipe can now surface a one-line summary of what it is doing, for example a pool pump showing "Filtration 2.1/9.6 h, off-peak" instead of that context living only in the recipe log. (#431)
- Feat (ui): **zone paths are shown in every zone dropdown and label**. Two rooms sharing a name (a "Bathroom" on each floor) were indistinguishable in most pickers; every zone now carries its disambiguating path everywhere. Contributed by Adrien Jouve (computingify). (spec 139, #433)
- Fix (ui): **the energy view is reachable right after local midnight**. "Today" was computed in UTC, so for the first hours after local midnight (until 02:00 in summer) the current day was treated as the future and its data was unreachable. It now uses the local calendar day. (#432)
- Fix (equipments): **report-on-change devices no longer flap between online and degraded**. A metering plug reports power only when it changes, so a steady load stopped updating and the tight freshness window tipped the equipment to degraded on every reporting cycle (180 status changes in an hour on one install). Power, current and voltage that arrive as a bonus on a non-metering equipment are now exempt from that window; dedicated meters still degrade on genuine silence. Contributed by Adrien Jouve (computingify). (spec 116, #440)

---

## 1.41.x: Metering accuracy and acknowledgeable alarms

### v1.41.0 — 2026-08-12 { #v1-41-0 }

- Feat (ui): **banner alarms can now be acknowledged**. An alarm whose condition persists (a socket left unplugged, a plugin that stays offline) used to sit in the header alarm pill with no way to clear it. Each alarm now has an acknowledge action in the alarms sheet; acknowledged alarms move to a muted section you can restore them from, and the header pill only counts the ones you have not acknowledged. The acknowledgement is remembered in your browser and keyed to the exact alarm, so the same one stays hidden across reloads while a genuinely new problem reappears. The pill icon is now an octagon for errors and a triangle for warnings, matching the sheet. (#424)
- Fix (energy): **energy is no longer lost on meters that report many times a minute**. A live energy tick carries the watt-hours accumulated since the previous one, but the generic de-duplication treated it as a sample and dropped most of them, so a chatty meter (the Tuya PJ-1203A publishes about thirty ticks a minute) had its production pinned to zero and left the Production chart empty. Ticks are now summed into one point per minute, the grid energy series has a single writer to remove a double-write, and the HP/HC split is computed over the real one-minute window instead of a thirty-minute one, so energy is no longer smeared across a tariff transition. Past data is not backfilled; figures are correct from this release forward. Contributed by Adrien Jouve (computingify). (#415)
- Fix (equipments): **equipments backed by an on/off state are no longer flagged "degraded" while online**. A boolean power binding (Panasonic Comfort Cloud, a TV, a washing machine) refreshes on the integration's own cadence, often slower than the two-minute streaming window, so a steady on/off value read as stale and tipped the whole equipment to degraded even though the device was online and polling. Boolean states are now exempt from streaming staleness; numeric live reads (Shelly, Legrand clamps) still degrade on genuine silence. (#422)
- Chore (registry): pool-pump-schedule bumped to 1.2.0; smart-cooling to 1.4.0. (#427)

---

## 1.40.x: Energy settings and Activity resilience

### v1.40.0 — 2026-08-11 { #v1-40-0 }

- Feat (ui): **energy settings now live in their own tab**. The tariff schedule and the surplus arbiter moved out of Settings > Administration, where they sat next to user management, into a dedicated **Settings > Energy** tab, so everything energy is in one place. Each of the arbiter's advanced thresholds gained a hover tooltip explaining what it does and its unit, so they are no longer opaque numbers. (#418)
- Fix (energy): the surplus arbiter **no longer mistakes an order re-delivery for a manual override**. When a flexible load's device dropped offline and reconnected with an unconfirmed order, Sowel re-sent that order (the delivery-confirmation retry from v1.39.0) and the arbiter read it as a human taking manual control, suspending itself for two hours. It now ignores its own retry channel, so a flaky Zigbee load no longer shows a spurious "Manual until ..." on its energy panel. (#420)
- Fix (ui): the **Activity panel recovers from transient load failures** instead of staying stuck on "cannot load activity" until you left the zone and came back. It now retries, offers a Retry button, reloads on WebSocket reconnect, and no longer lets a stale request overwrite a newer result. The WebSocket refetch bursts that could exhaust the request rate limit (a full reload per recipe or equipment event) are coalesced, and GET requests retry once on a rate-limit response. Contributed by Adrien Jouve (computingify). (#413)

---

## 1.39.x: Energy surplus arbitration

### v1.39.1 — 2026-08-11 { #v1-39-1 }

- Fix (ui): several fixes to the energy surplus arbiter interface shipped in v1.39.0. The **Enable switch now appears whenever you have a main energy meter** (grid) instead of requiring a separate production meter, so a home whose solar shows up as grid export can actually turn the arbiter on. The **priority list is now honored as shown** (a newly declared load could previously be ignored until you reordered the list). Declaring a flexible load no longer dead-ends: the class and power fields appear when you tick the box, with an inline explanation of Deferrable vs Comfort, an explicit Save, and a confirmation before removing a load. Advanced thresholds can no longer be cleared to a value that silently disables the arbiter, the "Manual until" chip appears in real time, and several accessibility and wording issues were addressed. (#416)

### v1.39.0 — 2026-08-11 { #v1-39-0 }

- Feat (energy): **the energy surplus arbiter** (spec 140). One core referee hands solar surplus to your flexible loads in the priority order you choose, ending the tug-of-war where several surplus-aware automations each switch on when they see export, overshoot together, and collapse it. Declare a pilotable load (pool pump, water heater, ...) on its equipment page (class, nominal power, minimum on/off, pre-filled from the equipment type and its own measurement), enable the arbiter under Settings > Administration > Energy, and order your loads. Energy > Live gains an arbitration surface: an allocation bar of where production is going right now, a day timeline per load, and a plain-language decision journal. **Opt-in and off by default**, and the arbiter issues no orders itself. It is the foundation surplus-aware recipes claim capacity against (`ctx.helpers.energy`); the recipes that use it ship next, so on this release the arbiter is there to enable and observe. Hardened by two independent adversarial review passes before merge. (#412)
- Feat (equipments): **order delivery confirmation** (spec 141). A dispatched order succeeding only proved it reached the integration, not the device: a pool pump OFF sent into a 104-second offline window once left the pump running 15.5 h unnoticed (issue #398). Confirmable orders are now watched for the ordered value to actually appear within 30 s (immediate verdict when every target device is offline); if it does not, Sowel raises a warning alarm (forwarded as a push) and re-dispatches once when the device comes back within the hour. (#404)
- Feat (core): **restored-data guardrail**. A database restored from another deployment carries that deployment's MQTT brokers and channels, so a fully armed instance on such data fights the original. A restored instance now starts inert until you confirm takeover, so the two never race for the same devices. (#405)
- Fix (mqtt): each process uses a **unique MQTT publisher client id** (random per-connection suffix) and throttles reconnect warnings, so a dev instance running on a copy of a production database no longer mutually kicks the original off the broker. (#402)
- Fix (logging): daily log files are **date-stamped and retained across container recreation**, and pre-date-format log files left by older versions are purged automatically at boot. (#403, #408)
- Fix (ui): the equipments list **groups by zone identity, not by zone name** (two rooms sharing a name no longer merge), and the community-plugin badge shows a Users icon rather than a warning triangle. (#406, #411)
- Chore (registry): Zigbee2MQTT bumped to 2.4.0; pool-pump-schedule to 1.1.0; netatmo_weather to 2.1.0. (#397, #409)
- Docs: the several-Zigbee-coordinators setup rules are carried into the device and getting-started pages that already cover Zigbee; new user and developer documentation for the surplus arbiter. (#407)

---

## 1.38.x: Several Zigbee coordinators

### v1.38.0 — 2026-08-10 { #v1-38-0 }

- Feat (settings): **one Sowel instance can now serve several Zigbee coordinators** (large houses, outbuildings out of radio range, coordinator device limits). Zigbee2MQTT drives one coordinator per instance, so the `base_topic` setting of the Zigbee2MQTT integration now accepts a comma-separated list, one entry per Z2M instance on the shared MQTT broker. The core exposes the parsed list to the plugin, and a new **"Several Zigbee coordinators"** section in the host setup guide walks through the whole setup: one container per coordinator, the configuration differences, and why base topics and Zigbee channels must differ. Pairs with the Zigbee2MQTT plugin **2.4.0**, which requires this version. Contributed by Adrien Jouve (computingify). (#395)
- Fix (ui): recipe pickers now **auto-select a zone that holds exactly one candidate** instead of leaving a one-option dropdown, and the chips recapping a filled equipment-list slot read zone-then-equipment, matching the order of the controls that produced them. The candidate-filtering predicate, previously written four times inline, moves to a single tested helper. (#390, #393)
- Fix (packages): the update badge **no longer offers a release you already leapfrogged**. Personal-source installs download the latest release live, but the badge read a 1-hour release cache that nothing invalidated after an install — skip a version, install the next one, and the UI kept proposing a downgrade. The cache is now invalidated after every personal install or update, and a cached version older than the installed one is never surfaced as an update. (#391)

---

## 1.37.x: Recipe tariff helper

### v1.37.1 — 2026-08-10 { #v1-37-1 }

- Fix (ui): **recipe equipment and zone pickers now spell out the zone**, so homonymous rooms and sensors can be told apart (spec 139). An installation with a bathroom per floor used to list "Salle de bain" several times with nothing to choose between, and equipment lists showed the bare name (integrations name every sensor "Température"). Each option now carries the shortest ancestor path that makes it unique, and the same helper tidies up the Analyse view labels. Contributed by Adrien Jouve (computingify). (#386)
- Fix (ui): the **Energy tariff page no longer shows its default hours as if they were saved** (#384). On an instance that never saved a tariff, the standard 06:00-22:00 HP / 22:00-06:00 HC schedule looked configured while it was not, so energy cost attribution and load-shifting recipes appeared broken. The form still lands on those hours for convenience, but a banner now marks them as a suggestion until you click Save. Reported by Adrien Jouve (computingify). (#388)

### v1.37.0 — 2026-08-09 { #v1-37-0 }

- Feat (recipes): **recipes can read the configured HP/HC tariff schedule** (spec 138). A load-shifting recipe (water heater, pool pump, EV charger) no longer has to re-ask for off-peak hours the instance already knows: `ctx.helpers.getTariff()` returns today's off-peak slots and whether the current time is off-peak, straight from the schedule configured under Settings. Read-only by construction, and tariff **prices are deliberately not exposed** to recipe packages — knowing when energy is cheap is enough to schedule a load. Recipes should keep their own time slots as a fallback for instances with no tariff configured. Contributed by Adrien Jouve (computingify). (#379)
- Fix (api): reading the tariff configuration over the API (`GET /api/v1/settings/energy/tariff`) now requires the **admin role**, like the rest of the settings. Any authenticated user could previously read the schedule and the prices; writing was already admin-only, and recipes are unaffected since they read through the new helper. Found during review of #379. (#382)
- Docs: specs index catch-up (specs 137/138) and French translation of the new recipe tariff documentation. (#380)

---

## 1.36.x: Plugin categories, search, energy live metering

### v1.36.0 — 2026-08-09 { #v1-36-0 }

- Feat (plugins): the Plugins page now **groups recipes by category** (spec 137) — Lighting, Heating and cooling, Watering and pool, Scheduling, Safety and monitoring, Energy and display — in both the Installed and Store tabs, with a **search field** that filters integrations and recipes as you type, matching names, descriptions and keywords in the displayed language and ignoring accents. The Store tab also finally displays the French names and descriptions already authored in the catalog (they were silently dropped before). Categories come from the plugin catalog: existing installations pick them up automatically, no recipe update needed. (#375)
- Feat (equipments): **live electrical data on energy meters** — the zone-view card of every meter type (consumption, main, production) now shows the live instantaneous power next to the daily consumption, whether the meter reports a direct power reading or a Legrand NLPC 5-minute demand. The equipment detail page gains an **Electrical metering** panel with live power, voltage, current and power factor tiles, each shown when the corresponding data is bound; the "Energy consumption" cumuls panel is unchanged. (#377)
- Feat (ui): the mobile **"More" drawer** now exposes the full Administration navigation (Devices, Equipments, Zones, Plugins, Logs, Backup, ...) from a single source of truth shared with the desktop sidebar, including the plugin-update badge. Non-admin users get the consultation pages (Equipments, Zones) in the main section. Previously only Settings, Analyse and four admin entries were reachable on mobile. (#374)
- Docs: new **Plugins user guide** page on docs.sowel.org — the two tabs, finding a plugin, trust levels, personal sources, and the fingerprint confirmation flow. (#371)
- Chore (core): installation-specific operations context moved out of the public repository into a private companion repo; new agent skill for personal recipe development; specs index updated. (#368, #370, #372)

---

## 1.35.x: Personal plugin sources

### v1.35.0 — 2026-08-08 { #v1-35-0 }

- Feat (plugins): **personal plugin sources** (spec 136). Add your own public GitHub repositories as plugin sources and install your own integrations and recipes without going through the central registry, neither for the first publication nor for version bumps. A third trust tier appears next to official and community: personal entries carry a blue **Personal** badge, and trust follows a trust-on-first-use model. Sowel downloads the release tarball, shows its version and SHA256 fingerprint in a confirmation dialog, then pins the hash; any later content change (updates included) asks again with the new fingerprint, and backup restores verify re-downloads against the pinned hash. The registry install path is unchanged, and personal packages get extra guards: the manifest repository must match the source, and a plugin id cannot shadow a registry entry. Everything is managed from the new "Personal sources" section of the Plugins page. (#367)
- Chore (registry): **Zigbee2MQTT plugin 2.3.1**: per-device availability topics are now ignored when Z2M's availability feature is disabled, so stale retained availability messages left on the broker no longer mark working devices offline at every boot or reconnect. (#365)
- Chore (registry): **Schedule On/Off recipe 2.0.1**: water heater equipments (introduced in v1.34.0) can now be picked in the recipe's equipment slot. (#366)

---

## 1.34.x: Water heater equipment

### v1.34.0 — 2026-08-08 { #v1-34-0 }

- Feat (equipments): new **water heater** equipment type (spec 135). ON/OFF control through the standard on/off relay channel (Zigbee relays such as the Tuya WHD02 work out of the box), an optional **water temperature** display bound under its own alias so it never skews the zone's room-temperature average, and automatic power/energy display when the relay meters consumption (like metering switches). Creating one from a relay device binds everything automatically, and a custom state-aware icon shows when it is heating. Full desktop and mobile dashboard support. (#359)
- Fix (equipments): boolean on/off commands sent to Zigbee relays through the REST API or by automations were **silently ignored**: the call returned success, but Zigbee2MQTT dropped the payload because binary switches expect their declared wire form (`"ON"`/`"OFF"`), not a JSON boolean. Integrations can now declare the wire representation of a boolean order at discovery time, and Sowel translates the value at dispatch: `true` becomes `"ON"`, or `"LOCK"`, or whatever the device declares. Pairs with the Zigbee2MQTT plugin v2.3.0, which declares those values; orders that do not declare them are dispatched exactly as before. (#360, #362)
- Fix (equipments): relay modules exposing on/off as a boolean order (Tuya WHD02 and similar) could not be associated with a **light or pool pump** equipment: the binding candidate rule only accepted ON/OFF enums for those types, although the same relay bound fine as a switch. Both now accept boolean on/off orders, aligned with the switch rule. (#358)
- Chore (registry): **Netatmo camera** community plugin 1.0.0 added (Netatmo Presence: snapshot, live view, monitoring toggle, spot light, motion detections), binding into the camera equipment type introduced in v1.31.0. By Romain (alpitux). (#356)
- Chore (registry): **Zigbee2MQTT plugin 2.3.0**: the Tuya PJ-1203A bidirectional dual-channel energy meter now lands as one device per channel feeding the energy pipeline (signed energy deltas, same shape as the Shelly Pro 3EM), contributed by Adrien Jouve (computingify); plus the Tuya relay binding fix and the binary wire-value declarations used by the order fix above. (#357, #363)

---

## 1.33.x: Reliability fixes

### v1.33.0 — 2026-08-07 { #v1-33-0 }

- Fix (equipments): battery-powered remotes and wireless buttons are no longer shown as **"Disconnected"** just because they have been silent. These devices only transmit when pressed, so silence is normal — the red badge was a false alarm (and it trained users to ignore red badges, hiding real disconnections). They now stay online; genuine low battery still shows through the battery signal. Applies to every integration (Zigbee, LoRa, ...). (#348)
- Fix (recipes): updating a recipe from the store now restarts its running automations immediately. Before, the new version was loaded and shown in the form, but running instances kept executing the previous version's logic until manually toggled off and on — a silent trap. (#349)
- Fix (plugins): the **Refresh** button on the Plugins page now shows a just-published catalog change within seconds instead of waiting several minutes. It was hitting a cached copy that the refresh could not bypass; it now reads the up-to-date source directly. (#353)

---

## 1.32.x: Weather daily min/max

### v1.32.0 — 2026-08-05 { #v1-32-0 }

- Feat (equipments): weather station equipments now show **today's measured minimum and maximum temperature** in small under each temperature reading — on the desktop dashboard widget, the mobile dashboard widget, and the equipment detail page (outdoor and indoor modules). Sowel tracks the envelope itself from the temperature samples it already receives, so it works with any station that reports a temperature, without configuration and regardless of vendor. The envelope resets at local midnight and survives restarts. Note for the first day after updating: the min/max starts counting from the update, so it becomes fully accurate the next day. (#344)

---

## 1.31.x: Camera equipment

### v1.31.1 — 2026-08-05 { #v1-31-1 }

- Fix (notifications): a notification mapped to an on/off source (typically a recipe alarm) fired its message on both transitions, so a fixed text like "washing machine done" was also sent the moment the alarm cleared — for a state-watch on the idle state, that is exactly when the machine starts a cycle. Such notifications now fire only when the source activates; notifications mapped to state texts (e.g. a mode name) or numeric values are unchanged. (#342)

### v1.31.0 — 2026-08-05 { #v1-31-0 }

- Feat (equipments): new vendor-agnostic **camera** equipment type (spec 133). A camera equipment shows a periodically refreshed snapshot (equipment detail page and dashboard widget) and an on-demand live view (HLS), plus optional monitoring on/off, light mode and siren controls when the integration exposes them. Media is proxied through the Sowel backend, so the browser never talks to the camera or vendor relay directly and the camera's real URL is never exposed. Each feature is enabled by simply binding its data/order category, enforced server-side. No camera integration ships in core: vendor plugins provide the devices (a Netatmo camera community plugin is on its way). Known limitation: live view is not yet available on iOS Safari (snapshots work everywhere). Contributed by Romain (alpitux). (#339)
- Fix (ui): the service worker rule that keeps API calls network-only never actually matched, because the pattern was tested against the full URL instead of the path. No known user-facing impact, fixed for correctness. (#339)
- Chore (plugins): the legacy Netatmo Security plugin (monitoring on/off only) is removed from the plugin store, superseded by the camera equipment type and the upcoming Netatmo camera plugin. Instances that already installed it keep running it; it is simply no longer listed or updated. (#340)

---

## 1.30.x: Three-phase metering

### v1.30.0 — 2026-07-31 { #v1-30-0 }

- Feat (energy): the Energy → Live page can now show a per-phase power breakdown for three-phase installations. A main energy meter equipment may carry `power_l1` / `power_l2` / `power_l3` data bindings (a convention any integration exposing per-phase power can adopt), and when at least two phases are bound, a "Phase breakdown" panel renders one bar per phase under the live flow diagram, making an unbalanced phase visible at a glance. Single-phase installations are unaffected: without those bindings the panel does not exist. Pairs with the Legrand Energy plugin v2.1.0, which now discovers Legrand Drivia with Netatmo three-phase meters (NLY modules, ref. 412175) as a "Total" device plus one device per phase. Contributed by Romain (alpitux). (#336, legrand-energy #1)

---

## 1.29.x: Standard role and dashboard parity

### v1.29.4 — 2026-07-26 { #v1-29-4 }

- Fix (ui): the rain barchart tooltip showed the wrong bar on the 7-day view. A 7-day window renders 8 daily bars, so the weekday used as the chart key repeated and hovering one bar could show another day's value (e.g. hovering today's ~1 mm bar showed "Sunday 19 / 0 mm"). Bars are now keyed on their timestamp. (#334)
- Fix (history): rain totals collapsed to ~0 mm on the 30-day view. Rain is a cumulative total but the daily history stored only the average (about the total divided by 24). Daily rain is now summed from the hourly data, so the 30-day view shows real totals, matching the 24h and 7-day views (which were already correct). (#334)

### v1.29.3 — 2026-07-21 { #v1-29-3 }

- Fix (ui): the bulk "Stop all shutters" / "Stop all awnings" commands (zone toolbar, whole house, dashboard zone widget and its detail sheet, and the physical button-action picker) are now hidden when any shutter in scope cannot actually stop mid-travel (e.g. Bubendorff via iDiamant). This extends the single-shutter fix from v1.29.2 to grouped commands, which act on the whole zone subtree. Groups where every shutter supports Stop are unaffected. (#332)

### v1.29.2 — 2026-07-20 { #v1-29-2 }

- Fix (ui): the shutter Stop button is now hidden when the bridge cannot actually stop the motor mid-travel. Some bridges (confirmed on Bubendorff shutters via an iDiamant with Netatmo bridge) only pause briefly before continuing to the original target, so a Stop button there was misleading. An integration signals this by omitting "STOP" from the move order; every shutter that keeps a real Stop is unaffected. (#327)
- Fix (equipments): shutter auto-binding now works for integrations that do not use Tasmota-style key names. Adding a shutter whose device exposes current_position / target_position / state (e.g. Legrand / Bubendorff Home+Control) produced an equipment with no bindings, shown as offline; a category-based fallback now binds it correctly. (#327)

### v1.29.1 — 2026-07-19 { #v1-29-1 }

- Fix (auth): follow-up to the v1.29.0 Standard role. A Standard user could still see config controls that the server rejects with a 403 (Edit / Delete on an equipment, the equipment Configuration panel, mode activation, chart save / delete, the update pill). These are now hidden, and the config-only pages (devices, calendar, integrations, plugins, MQTT / notification publishers, logs, backup) redirect a Standard user to the dashboard. Actuation (lights, gates, shutters, zone commands) and personal settings (profile, password, API tokens) are unchanged. (#319)

### v1.29.0 — 2026-07-19 { #v1-29-0 }

- Feat (auth): the **Standard** role is now scoped to viewing and operating. A Standard user can browse the dashboard and zones, see equipment states, and actuate equipments (open a gate or a door, toggle a light), but can no longer create, rename or delete equipments, recipes, zones or modes, nor change any configuration. All configuration is now admin-only, hidden in the UI and enforced server-side (a blocked action returns 403, so it cannot be worked around). This answers the surprise that a Standard account could alter equipments and recipes by accident. No migration needed: existing Standard accounts simply lose the config actions they should not have had. (#319)
- Fix (ui): a custom widget icon is now shown identically on a PC browser and on mobile. The desktop dashboard ignored the custom icon for most widget types (a pool-pump icon chosen for a plug showed on Android but reverted to the plug icon on desktop); it now honors the chosen icon for lights, switches, shutters, awnings, thermostats, heaters, water valves and pool equipment, matching mobile. (#318)

---

## 1.28.x: Watering weekdays

### v1.28.2 — 2026-07-18 { #v1-28-2 }

- Fix (ui): on the mobile dashboard, a contact sensor (door/window) modelled as a **Capteur** now shows "Ouvert / Fermé" instead of a bare "Oui / Non". The mobile widget card was formatting boolean sensor values generically; it now uses the same category-aware labels as the desktop card and the zone view (also fixes motion / water-leak / smoke labels on mobile). Note: a motorised door/gate is best modelled as an **Ouvrant**, which already derives open/closed from a contact and displays correctly everywhere. (#316)

### v1.28.1 — 2026-07-18 { #v1-28-1 }

- Fix (weather): rain totals could balloon to absurd values (e.g. 1392 mm over 24h from an actual 11.9 mm), which permanently blocked the Auto Watering rain-skip and plotted a flat "11.9 mm every hour" on rain charts. Netatmo's rolling 1h / 24h totals (`sum_rain_1` / `sum_rain_24`) were summed at every poll. Sowel now reads them as the totals they already are, and no longer stores them as time series. Live weather values are unchanged; existing rain charts self-correct within ~24h. (#312)

### v1.28.0 — 2026-07-17 { #v1-28-0 }

- Feat (recipes): recipe forms now support multi-select option fields, shown as toggle chips instead of a single dropdown. This powers a new per-slot **day of week** selector in the Auto Watering recipe (update the recipe to v1.2.0): each watering slot can be limited to chosen weekdays, and leaving it empty keeps watering every day. Example: water at 07:30 on school days and at 09:00 on Wednesday and the weekend. Existing watering schedules are unchanged. (#310, auto-watering #2)

---

## 1.27.x: Metering-aware switch

### v1.27.1 — 2026-07-10 { #v1-27-1 }

- Fix (equipments): creating a Switch / Plug on a metering device (e.g. SONOFF S60ZBTPF) now binds its power/energy, not just the on/off channel. v1.27.0 shipped the display side but the binding step missed the metering data. Note: plugs bound before this fix keep their on/off-only binding; re-create or re-bind them to pick up power/energy. (#302)

### v1.27.0 — 2026-07-10 { #v1-27-0 }

- Feat (equipments): a Switch / Plug now surfaces power and energy when the device reports them. A metering smart plug (e.g. SONOFF S60ZBTPF over Zigbee2MQTT) modelled as a Switch shows its live power next to the on/off toggle, feeds the energy dashboard (history and HP/HC), and appears in the live submeter breakdown, while keeping its ON/OFF control. A basic relay with no metering behaves exactly as before. (#300)

---

## 1.26.x: Notification re-notify

### v1.26.0 — 2026-07-07 { #v1-26-0 }

- Feat (notifications): notification mappings gain an explicit re-notify option. While a mapped value stays "active" (e.g. a State Watch alarm), the notification is re-sent on a fixed cadence and stops silently once it clears. Pick "None", "Indefinitely" or "Limited to N reminders" per mapping — distinct from the anti-spam throttle. (#294)

---

## 1.25.x: Notification mapping editor

### v1.25.0 — 2026-07-01 { #v1-25-0 }

- Fix (ui): the notification mapping editor restores the zone filter when you re-edit a mapping. A recipe or equipment picked in a specific zone (e.g. a State Watch in the cave) no longer shows "all zones" with an unfiltered source list. (#291)
- Feat (ui): the recipe source dropdown now shows the equipment(s) each recipe instance applies to, e.g. "State Watch (Machine à laver)", so several instances of the same recipe are distinguishable. (#291)

---

## 1.24.x: Web Push notifications

### v1.24.3 — 2026-06-29 { #v1-24-3 }

- Fix (notifications): Web Push notifications are split into a title (the message) and a body (the value). A longer notification such as "Garage door open since" followed by a timestamp now reads on two lines instead of being truncated onto one. Telegram keeps its single-line format. Note: the "from Sowel" line on the notification is added by the browser/phone itself (it always shows which app sent the push) and cannot be removed.

### v1.24.2 — 2026-06-29 { #v1-24-2 }

- Fix (notifications): the "Test channel" button now delivers a real notification for the Web Push channel. It previously only validated the VAPID keys without sending anything, so it looked like nothing happened. It also returns a clear error when no device has enabled push yet. (#288)
- Fix (notifications): Web Push notifications no longer show a redundant "Sowel" title. The installed app (and the browser) already labels the notification with the Sowel name, so the message itself is now the notification heading. (#288)
- Fix (ui): the Administration > Notifications page is now readable on mobile. The publisher actions move onto their own row, the channel (Telegram or Web Push) is labelled correctly instead of always showing "Telegram", and mapping rows wrap cleanly. (#288)

### v1.24.1 — 2026-06-29 { #v1-24-1 }

- Fix (core): Web Push now works on iOS and Safari. Apple's push gateway rejected every notification (HTTP 403) because the default VAPID subject used a `.local` domain, which Apple refuses (Chrome and Android were unaffected). The default is now a valid contact, and existing instances self-heal the stored value on update without regenerating keys, so previously registered devices keep working. (#287)

### v1.24.0 — 2026-06-29 { #v1-24-0 }

Web Push as a notification channel for the installed PWA, plus two mobile layout fixes:

- Feat (core): new **Web Push** notification channel alongside Telegram. The installed PWA (over HTTPS) can receive native push notifications. VAPID keys are generated and stored on first boot, subscriptions are per user, and expired endpoints are pruned automatically. Configure it from Settings > Notifications: enable push on a device, then map a "Web Push" publisher to any equipment, zone or recipe value. (#284)
- Fix (ui): on mobile, the current time and sunrise/sunset are now shown in the top bar (they were desktop-only). (#285)
- Fix (ui): on mobile, the Wh / € toggle on Energy > Consumption is now reachable; it no longer overflows off-screen next to the period selector. (#285)

---

## 1.23.x: Sun-aware recipe building blocks

### v1.23.0 — 2026-06-24 { #v1-23-0 }

Recipe form building blocks for sun-aware scheduling (spec 126):

- Feat (recipes): new `select` recipe slot type, rendered as a dropdown with per-language option labels. A recipe can now offer a small closed list of named choices.
- Feat (recipes): new `ctx.helpers.getSunlight()` exposing the current sunrise, sunset and daylight flag to recipes (from the existing sunlight manager, offsets applied), so a recipe can schedule on sun times. Pairs with the `sunlight.changed` event to re-sync across days.
- Feat (recipes): new `hiddenWhen` slot rule, so a recipe form shows only the relevant field (e.g. a fixed-time picker for "fixed time", a minute offset for "sunrise/sunset"); the irrelevant field is removed from the layout, keeping the form aligned.
- Feat (ui): `number` recipe slots render as numeric inputs (with min/max), so values like a positive or negative minute offset can be entered cleanly; recipe slot grids use equal-width columns.

These ship for the new **Schedule On/Off** recipe (fixed time / sunrise / sunset windows), available from the plugin store.

---

## 1.22.x: Smart plug controls and Zigbee on/off binding

### v1.22.0 — 2026-06-23 { #v1-22-0 }

Zigbee on/off equipment binding fixes and smart plug controls:

- Fix (equipments): Zigbee2MQTT plugs and relays (Lidl, Legrand, ...) are now proposed when binding a `switch` (smart plug) equipment. Their on/off command is a boolean `light_toggle` order, which the binding matcher previously only recognised as an enum ON/OFF, so only Tasmota devices appeared. (#276)
- Feat (ui): `switch` (smart plug) equipments now have on/off controls everywhere (compact card, equipment card, detail page) plus a dedicated dashboard widget with a wall-socket picto and ON/OFF toggle, instead of a read-only badge. (#277)
- Fix (equipments): Zigbee water valves (e.g. SONOFF SWV) are now proposed when binding a `water_valve` equipment, and bind their full surface (state, flow, battery, irrigation) instead of being dropped. (#278)

New recipe in the store: **Schedule On/Off** ("Programmation horaire"), up to 3 daily ON/OFF windows for any on/off equipment.

---

## 1.21.x — Solar panel equipment

### v1.21.0 — 2026-06-12 { #v1-21-0 }

Solar Panel equipment + APsystems integration (spec 125):

- Feat (equipments): new `solar_panel` ("Solar Panel" / "Panneau Photovoltaïque") equipment type. One equipment = one PV panel = one inverter channel; binding a multi-channel inverter offers one candidate per channel (Panel 1 / Panel 2), a channel already used by another panel is no longer offered, and selection is single-device. Read-only.
- Feat (core): new generic `temperature_device` DataCategory — the internal temperature of a device (e.g. an inverter), distinct from `temperature` so it never pollutes a zone's room-temperature average. Streaming (15 min freshness) and historized by default.
- Feat (ui): dedicated solar dashboard widget — PV panel logo + produced power · current · voltage, identical on desktop and mobile, "Veille" when not producing. New "Solar" group on the Maison view, and a read-only detail panel (power / energy / voltage / current / inverter temperature).
- New plugin: `apsystems` (read-only) — discovers APsystems micro-inverters (DS3 / YC600 / QS1) from the [ESP32-ECU](https://github.com/mchacher/ESP32-ECU) MQTT bridge, one device per inverter, using the firmware Name as the stable identity so a hardware swap keeps the Sowel config (the serial is exposed as a read-only data point). Install it from the plugin store.

---

## 1.20.x — Energy cost valuation + shadow mode

### v1.20.0 — 2026-06-03 { #v1-20-0 }

Energy cost valuation (spec 123):

- Feat (energy/api): `GET /api/v1/energy/history` now returns `cost_hp`, `cost_hc` and `cost_total` (€) on every point and in totals, computed at read time from the existing `TariffPrices.hp` / `TariffPrices.hc` (€/kWh) already stored in `energy.tariff` settings. Per-point cost reflects the raw bucket consumption (matches chart bar tooltips); totals cost reflects the grid-side hp/hc (autoconso-subtracted) and matches the summary card. When the tariff is missing or both prices are 0, every cost field is exactly 0 and the request succeeds.
- Feat (energy/api): `GET /api/v1/energy/by-usage` adds per-submeter `cost` plus `totals.costByEquipment`, `totals.otherCost`, `totals.totalCost`, using a period-blended €/kWh derived from the main meter's HP/HC totals for the same window. Submeters store only `energy` (no HP/HC channel) so the blended rate keeps the cost computation to a single Influx pass; the trade-off is a slight (~5 %) attribution skew for an equipment running exclusively in HC vs. invoice-grade attribution. When there is no main meter, the blended rate is 0 and submeter costs are 0.
- Feat (UI/energy): new Wh / € toggle in the Energy page header. Cost mode swaps the bar chart Y axis and tooltips, the summary card totals and the by-usage stacked bar to euros. Toggle preference persisted in `localStorage` (`sowel_energy_unit`). When the tariff is not configured the toggle is disabled with a tooltip pointing to Settings > Tariff. Autoconso has no billed cost and is therefore hidden from the chart in € mode.
- Feat (UI/settings): TariffSettings shows a one-line hint under the prices — "Ces prix valorisent toute votre consommation passée et future" — making the read-time pricing semantic discoverable (changing prices re-values past data).
- Change (energy/api): `/api/v1/energy/status.tariffConfigured` semantics tightened from "any `energy.tariff` setting blob exists" to "at least one of `prices.hp` / `prices.hc` is > 0". A schedule-only tariff with 0/0 prices no longer enables the cost UI.

Shadow mode (spec 124):

- Feat (core): new `SOWEL_SHADOW_MODE=1` env var. When set, Sowel boots its HTTP server and serves the UI normally, but every outbound subsystem is gated off both at boot and at runtime: no plugin starts (no MQTT connect, no cloud poll, no OAuth refresh), no recipe instance is restored or armed, no MQTT publisher connects, no notification publisher subscribes, no GitHub version polling. The runtime gates on `PluginLoader.loadPlugin` and `RecipeManager.startInstance` mean that an admin clicking _Enable_ on a plugin or recipe inside a shadow instance does NOT cause it to dial out — the SQLite row updates, but the runtime stays inert.
- Feat (api): `GET /api/v1/system/mode` returns `{ shadowMode: boolean }`, used by the UI banner. Auth required, accessible to any authenticated user.
- Feat (ui): full-width amber **SHADOW MODE** stripe above the sidebar and content on every page, non-dismissable, when `shadowMode === true`. Localized FR + EN.
- Feat (logs): when shadow mode is active, a `warn`-level structured log line `module: "shadow-mode"` is emitted at boot with the container hostname, so any accidental activation of shadow mode on production is immediately visible in `docker logs sowel` and can be alerted on.
- Docs: new internal playbook in `scripts/howto-shadow.md` (not published to docs.sowel.org) describing the full lifecycle of a shadow instance — pre-flight checklist, backup, run with `SOWEL_SHADOW_MODE=1`, restore, test, cleanup, and a recovery section for the "I forgot to set the env var" case.

---

## 1.19.x — Display wake action

### v1.19.1 — 2026-06-02 { #v1-19-1 }

- Fix (UI/equipments): the auto-binding flow now picks up the `wake` order on display equipments. Before this fix, the `RELEVANT_ORDERS["display"]` whitelist in `bindingUtils.ts` listed only `language` and `brightness`, so even after the firmware advertised the new `display_wake` capability (iter 036) and the displays plugin v0.2.1 exposed it on the device, the equipment creation flow silently filtered it out. Result: the presence-display recipe v0.2.0 refused to start with `Display "..." has no order of category "display_wake" — firmware too old`. Fix: add `wake` to the display whitelist. Companion to spec 122. Note: the UI's `CANDIDATE_BASED_TYPES` set still excludes `display` (asymmetry with the backend's `binding-candidates.ts` which treats display as an "all"-candidate type). Aligning those is a follow-up; the whitelist fix is the minimal patch for the user-visible issue.
- Feat (UI/displays): the equipment card in the zone view now surfaces a display's current brightness inline next to the type label — `Display · 30 %` when lit, `Display · Off` when brightness is 0 (the recipe-driven sleep state). Previously the user had to click into the equipment detail page to read the slider value to know whether the panel was asleep.

### v1.19.0 — 2026-06-02 { #v1-19-0 }

- Feat (core): new `display_wake` order category for the display equipment type. A no-value action that tells the display to restore its last user-chosen brightness from local NVS. Spec 122. Used by the presence-driven sleep recipe (`sowel-recipe-presence-display` v0.2.0+) so the recipe no longer needs to know the user's preferred brightness level. Companion changes: `sowel-plugin-displays` v0.2.0 routes the order to `<prefix>/<id>/cmd/wake`; sowel-energy-display iter 035 splits NVS into `current_pct` + `user_pct`, restores `user_pct` on tap-wake or `cmd/wake`, and auto-extinguishes 2 minutes after a tap-wake if the recipe has not confirmed the wake.

---

## 1.18.x — Display equipment type

### v1.18.4 — 2026-06-02 { #v1-18-4 }

- Fix (UI/display): brightness slider polish. The v1.18.3 echo-driven draft clear left a short window where the rendered value could flash back to the previous binding value between the user release and the server echo. Replaced by a flat 1.5 s post-commit hold — the slider pins on the user's target until the firmware round-trip has reliably landed, no flicker. Slider step bumped from 5 to 10 (`min=0 max=100 step=10` → 11 well-spaced stops including the "Off" position at 0), per user feedback that the 5 % step felt too fine and the touch hit on 0 was unreliable.

### v1.18.3 — 2026-06-02 { #v1-18-3 }

- Fix (UI/display): brightness slider now commits the order on `onPointerUp` (pointer release) instead of via the 300 ms trailing debounce of v1.18.2 — zero perceived latency between releasing the slider and the panel reacting. A 500 ms fallback debounce on `onChange` still covers keyboard / accessibility paths where pointerup never fires. The local draft value also stays pinned to the user's target until the WebSocket round-trip echoes the same value back, so the thumb no longer snaps back to the stale binding during the ~700 ms server cycle.
- Feat (UI/display): the slider's `min` lowered from 5 to 0 so the panel-off state ("Off" — full LEDC duty zero on the firmware side) is reachable from the equipment detail card. The numeric readout renders "Off" instead of "0 %" when the value reaches zero. Companion firmware change on sowel-energy-display iter 035 supports 0 as the explicit off value, falls back to the default 80 % at boot if NVS holds 0 (recovery against a stuck panel after a power cycle while a sleep recipe was active), and wakes the panel on any tap when off (failsafe in case the recipe stops dispatching).

### v1.18.2 — 2026-06-02 { #v1-18-2 }

- Fix (UI/display): the brightness slider on the display equipment detail page is now debounced (300 ms trailing). React's `onChange` on a `<input type="range">` fires on every pointer-move event during a drag (5..10 / s) — pre-1.18.2 each event posted to `/api/v1/equipments/:id/orders` and the displays plugin republished a `cmd/brightness` per event, hammering the firmware and amplifying the cmd flood. A slow scrub from 100 % to 5 % now produces exactly one MQTT cmd (the final value). Live thumb + numeric readout still track the drag locally for responsiveness. Companion firmware fix on sowel-energy-display iter 035 marshals the cmd through `lv_async_call` with coalescing to absorb any flood that still slips through.

### v1.18.1 — 2026-06-02 { #v1-18-1 }

- Fix (UI/equipments): the "Add equipment" device picker now filters down to display-capable devices when the equipment type is `display`. The v1.18.0 version forgot the `display` entry in `DeviceSelector`'s `EQUIPMENT_TYPE_CATEGORIES` and `bindingUtils`'s `RELEVANT_DATA / RELEVANT_ORDERS` maps, so the picker listed every device on the system and the create-with-devices flow silently bound nothing. Filters now match on the canonical display fields (`display_brightness` / `language` / `rssi`) and auto-create the 5 data bindings (firmware_version / uptime / rssi / language / display_brightness) + 2 order bindings (language / brightness) when the user picks a supervised device. Spec 120 follow-up.

### v1.18.0 — 2026-06-01 { #v1-18-0 }

- Feat (equipments): new `display` equipment type for Sowel-supervised displays. Companion plugin `sowel-plugin-displays` (separate repo) discovers displays via MQTT (retained `state` payload, LWT-driven availability) and exposes them as Sowel devices that bind to the new `display` equipment. The first vendor is the sowel-energy-display AMOLED firmware (iter 035, separate repo); future e-paper / OLED / ePOS displays follow the same wire contract with zero plugin change. New `DataCategory` values: `firmware_version`, `uptime`, `rssi`, `language`, `display_brightness`. New `OrderCategory` values: `set_language`, `set_display_brightness`. New widget family `displays` (zone-level aggregation `displaysOnline / displaysTotal`). New `DisplayPanel.tsx` on the equipment detail page renders the canonical fields with an inline language dropdown and brightness slider, hidden when the matching binding is absent. The dashboard widget picker hides displays — they are meta / control surfaces, not "things in the home" to be summarised. Spec 120 + 121.
- Feat (plugins/registry): added `displays` plugin (v0.1.0, owner mchacher, official) — install from Admin → Plugins → Browse to start supervising displays. The plugin exposes `mqtt_url` / `mqtt_username` / `mqtt_password` / `topic_prefix` (default `sowel-display`) in its settings page.

---

## 1.17.x — Energy history per-period aggregation

### v1.17.0 — 2026-05-31 { #v1-17-0 }

- Feat (backend/api): `GET /api/v1/energy/history` and `GET /api/v1/energy/by-usage` now return a fixed number of pre-aggregated buckets per period — 24 hourly for `day`, 7 daily Mon-Sun for `week`, 28-31 daily for `month`, 12 monthly Jan-Dec for `year`. Pre-spec-119 a `?period=week` query returned 168 hourly points and `?period=year` returned ~365 daily points, forcing every consumer (web UI `EnergyBarChart.tsx` and the new sowel-energy-display firmware iter 034) to re-aggregate client-side. The aggregation now happens once in InfluxDB via Flux `aggregateWindow(every: $resolution, location: $tz)`, with bucket boundaries aligned to the server's local TZ (`Europe/Paris` by default; logged at startup). HP / HC tariff split is preserved on every bucket. Empty buckets are returned zero-filled so consumers iterate `0..N-1` without gap-handling code. `EnergyHistoryResponse.resolution` gains a new `"1mo"` literal for the yearly bucket. Spec 119.

---

## 1.16.x — Analyse chart improvements

### v1.16.0 — 2026-05-30 { #v1-16-0 }

- Feat (UI/Analyse): per-category chart families locked to a single chart. `temperature` / `humidity` / `pressure` / `co2` / `voc` / `noise` / `luminosity` / `power` / `voltage` / `current` / `wind` / `battery` form the **Measurements** family (line chart). `rain` / `energy` form the **Cumulative** family (bar chart). `motion` / `contact_door` / `contact_window` / `water_leak` / `smoke` form the **States** family (step chart on a `[0, 1]` axis with semantic tick labels — "fermé" / "ouvert", "absent" / "présent", etc.). The series picker greys out cross-family bindings with a "Famille incompatible" tooltip; a "Vider le graphe" button resets the family lock. Spec 118 F2 / F5 / F7.
- Feat (UI/Analyse): min/max envelope band on slow-moving Measurements series (temperature, humidity, pressure, CO2, VOC, noise, luminosity, power) at 1h / 1d resolution. A semi-transparent shaded area is drawn around the mean line between the API's `min` and `max` fields (already returned by the downsampled buckets). A global header toggle "Enveloppe min/max" turns the band on/off in memory; default on. Tooltip rows show `21.5 °C (18 / 26)` when the band is rendered. Spec 118 F1.
- Fix (backend/history): cumulative-category history queries (`rain`, `energy`) now read the pre-aggregated `mean` field from downsampled buckets (`sowel-hourly`, `sowel-daily`) instead of filtering on the raw `value_number` field that only exists in the raw bucket. The previous query path silently returned zero points on every aggregated rain / energy chart and fell back to the raw bucket, which holds only a few days of live-writer data. Caught on sowelox right after a 12-month rain backfill: the "Pluie" chart on Mois view stayed empty despite `sum_rain_24` daily totals being correctly written by the Netatmo backfill script. Spec 118 F8, with new `buildFluxQuery` unit tests covering both the downsampled and raw-bucket branches.
- Fix (UI/nav): clicking "Analyse" in the sidebar while on a saved-chart sub-route (`/analyse/<chartId>`) now navigates back to the empty workspace at `/analyse` instead of only toggling the section expansion. The previous click handler called `preventDefault` for any path starting with `/analyse`, making the new-chart workspace unreachable once a saved chart had been opened. Spec 118 F9.
- Feat (UI/Analyse): the empty Analyse workspace opens the add-series picker by default and preselects the first zone, so the chart-creation flow (zone → equipment → metric) is visible immediately on `/analyse`. The empty-chart placeholder shrinks to a quiet dashed panel pointing at the picker above. Spec 118 F9.
- Change (history): wind direction and gust details (`wind_angle`, `gust_strength`, `gust_angle`) are no longer historized by default. They remain visible live in the `WeatherPanel` (compass arrow, gust hero) but disappear from the Analyse picker on new installs and after redeploy on existing ones. Legacy points already in InfluxDB are harmless and decay with retention. Spec 118 F6.

---

## 1.15.x — Live submeter breakdown

### v1.15.7 — 2026-05-30 { #v1-15-7 }

- Fix (UI/Analyse): in the Année / Mois views, the X axis repeated the same month label many times ("mars mars mars … avr. avr. avr."). Root cause: the X axis was wired as categorical strings so every daily data point became its own X position. Switch to a continuous time scale (epoch ms + `tickFormatter`) so Recharts spaces ticks evenly by time and the formatter renders "mars" only where a tick actually lands. `minTickGap` is now period-aware (60/70/80/90 px for day/week/month/year).

### v1.15.6 — 2026-05-30 { #v1-15-6 }

- Feat (UI/Analyse): the Analyse page time-range selector is replaced with the same calendar navigator the Energy page uses — period tabs (Jour / Sem / Mois / Année) + prev/next chevrons + an "Aujourd'hui" reset. Users can now scrub to any absolute calendar window (a specific Tuesday, last August, 2025 overall) instead of only "the last N hours/days ending now", which was a blocker for visualising backfilled historical data on a chart. The 4 tabs are equal-width for visual rhythm, and the navigator layout mirrors the Energy header (title left, navigator right).
- Feat (UI/Analyse): mobile burger + saved-charts drawer (`AnalyseMobileNav`) — mirrors the Energy mobile nav. On `/analyse/*` the topbar burger opens a drawer listing the user's saved charts plus a "Nouveau graphique" entry, so users can switch between charts without going through the desktop sidebar. The h1 page title is hidden on mobile (the topbar already shows it), reclaiming vertical space for the chart.
- Feat (UI/Analyse): friendly metric labels everywhere a binding chip or legend appears, even on saved charts. The chart pills, tooltip and legend now show "Température extérieure" / "Batterie Module Extérieur" / etc., rather than the raw alias (`temperature_2`, `battery_3`). Saved charts re-fetch their equipment's bindings at load to enrich the labels.
- Change (mobile UX): drop the redundant `⋮` MoreVertical button in the mobile topbar — it opened the same drawer (Settings / Plugins / Account / Logout) as the bottom-nav "Plus" button. One entry point, no duplicate.
- Fix (UI/Analyse): TZ-correct date arithmetic in the period navigator. The previous shift used `toISOString().slice(0, 10)` (= UTC date string), which silently lost a day when local time was ahead of UTC — the forward arrow appeared stuck and backward skipped days. Replaced with a local-date formatter.

### v1.15.5 — 2026-05-30 { #v1-15-5 }

- Fix (history): outdoor temperature and humidity bindings (`temperature_outdoor` / `humidity_outdoor` categories — typically the Netatmo outdoor module) are now historized by default. The `CATEGORY_DEFAULTS_ON` whitelist in `history-writer.ts` only knew the indoor variants, so on-by-default fell through to OFF and no point was ever written to InfluxDB. Existing equipments pick up the change at next history-writer cache refresh (any `equipment.updated` event, or boot). First `resolveHistorize` unit-test file added to lock the contract for the on-by-default set.
- Feat (UI/history): replace raw binding aliases (`temperature_2`, `humidity_2`, `battery_3`, …) with equipment-level human-readable labels everywhere a binding chip or legend appears — Analyse picker chips, series pills, chart Tooltip / Legend, and the History panel of the equipment detail page. Indoor / outdoor disambiguation comes from the data category itself (`Température intérieure` vs `Température extérieure`); only multi-instance categories with no semantic sibling (typically multiple batteries on a multi-module weather station) leak a device name as a disambiguator (`Batterie Module Extérieur` / `Anémomètre` / `Pluviomètre`). Hovering a chip still shows the raw alias as a tooltip for power users.

### v1.15.4 — 2026-05-29 { #v1-15-4 }

- Fix (UI/weather): the Netatmo outdoor module (NAModule1) is now bindable on a `weather` equipment. The category filter in the device selector only listed `temperature` / `humidity` (indoor variants), so the outdoor module — the only one carrying the _outdoor_ temperature, ironically — was hidden from the compatible-devices list and silently skipped by the auto-binding loop. Add `temperature_outdoor` and `humidity_outdoor` to the filter, and to `SENSOR_DATA_CATEGORIES` so the bottom-sheet detail view picks them up too. Locked with unit tests.
- Feat (UI/weather): rework the dashboard weather widget to surface **outdoor and indoor temperatures side by side** when both modules are bound. Humidity is dropped from the compact view (the second temperature is the more useful comparison). When only one of the two is bound, the single temperature carries its explicit `Extérieur` / `Intérieur` caption — never implicit, since reading just `20.5°` left the user wondering which it was. Lookup is by category, not by alias, so the Netatmo key collision (both modules send `key: "temperature"`) is handled correctly.
- Feat (UI/weather): the bottom sheet (tap the widget) is reorganised by physical module — one compact section per device (Outdoor Module, Indoor Station, Rain Gauge, Wind Gauge) with the device name and battery in the section header. Same mental model as the equipment detail page (`WeatherPanel`), rendered as stacked sections instead of a card grid. Per-row `(Intérieur)/(Extérieur)` suffixes are removed: the section header is the disambiguator.

### v1.15.3 — 2026-05-29 { #v1-15-3 }

- Change (deployment): in-app self-update is now **enabled by default**. The official `docker-compose.yml` mounts `/var/run/docker.sock` into the Sowel container, so the "Update now" button in the Admin UI works out of the box on a fresh install. The `docker-compose.override.example.yml` opt-in template is gone. **Security trade-off**: mounting the Docker socket gives the Sowel container effective control over the host's Docker daemon, so a successful RCE against Sowel would escalate to host root. For hardened or multi-tenant deployments, remove the `docker.sock` line from the compose file to opt back out — the rest of Sowel keeps working, only the in-app updater is disabled. This reverses the v1.7.0 (spec 105) decision after field feedback: nearly every install hit the "update unavailable" message without guessing they had to copy an override template. Existing installs are NOT touched; the new default only applies to compose files freshly fetched from the repo.

### v1.15.2 — 2026-05-28 { #v1-15-2 }

- Fix (core): the official `docker-compose.yml` now declares `extra_hosts: ["host.docker.internal:host-gateway"]` on the `sowel` service. MQTT-based plugins (Zigbee2MQTT, LoRa2MQTT, Tasmota, Shelly, Somfy RTS bridge...) can now reach a broker hosted on the same machine via `host.docker.internal:1883` — no need to hard-code the host's LAN IP (fragile under DHCP). Existing installs pick up the change after refreshing their compose file or pulling the new image with the manual block added (see `docs/user/host-setup.md`).
- Fix (UI/PWA): removed an unconditional service-worker unregister loop that ran on every page load and killed the PWA registration as soon as `vite-plugin-pwa` installed it. Chrome on Android refused to show the install prompt because no controlling SW existed at evaluation time. Install banners now appear again on HTTPS deployments; existing visitors should clear site data once so the previous wipe doesn't replay.
- Fix (UI/weather forecast): creating a `weather_forecast` equipment from the UI now auto-binds the 25 data points emitted by the Open-Meteo plugin. The frontend auto-binding map had no entry for `weather_forecast`, so every `j1_*`..`j5_*` key was silently filtered out and the resulting equipment displayed an empty forecast panel. The relevant Sowel categories (`weather_condition`, `temperature_outdoor`, `rain`, `wind`) are now declared and locked by a unit test.

### v1.15.1 — 2026-05-27 { #v1-15-1 }

- Feature (API): new optional `?type=<EquipmentType>` query parameter on `GET /api/v1/equipments`. Returns only equipments of the requested type (e.g. `?type=energy_meter`). Unknown values return an empty list rather than a 400 so callers can safely forward user input. Lets memory-constrained clients (like the sowel-energy-display ESP32 firmware) drop a 100 KB payload to a few KB by asking only for the entries they need.

### v1.15.0 — 2026-05-27 { #v1-15-0 }

- Feature (Energy UI): a "Consumption breakdown" donut now sits below the Maison/Réseau/Solaire diagram on the Live page (spec 117). One segment per `energy_meter` submeter and an "Other" residual for what no clamp measures, sized by instantaneous power (W). Updates reactively from the existing equipments WebSocket stream, no new endpoint or DB change. Colors match the historical By-usage chart so a given clamp keeps the same color in both views. Offline submeters drop out of the donut but stay listed greyed in the legend.

## 1.14.x — Equipment availability

### v1.14.1 — 2026-05-26 { #v1-14-1 }

- Fix (UI): the "Total" label under the Production solar chart now equals the sum of the stacked bars (autoconsumption + grid injection). Previously the label was sourced from the raw inverter `energy` series while the bars summed the per-minute `autoconso` and `injection` series, and the two could drift by ~1 kWh per day because of cross-meter timing skew. Visual only, no data lost.

### v1.14.0 — 2026-05-26 { #v1-14-0 }

- Equipments: every equipment now exposes a derived `status` field (`online` / `degraded` / `offline`) computed in memory from the backing devices' `status` and the freshness of streaming bindings (spec 116). The UI ships ambre "Degraded" and red "Disconnected" badges on every surface where users see equipment values: compact zone rows (badge replaces controls when fully offline), equipment detail header, energy cumuls panel (with last-update caption), zone aggregation pills (`(N unavailable)` hint when an offline equipment was excluded from a metric). The Live Energy page gains a top banner that flags stale or disconnected meters explicitly. Triggered by a real bug: a Shelly Pro 3EM coupé au tableau kept the live energy graph displaying its last value as if it was live, with zero indication of staleness.
- Plugin contract: a new mandatory section in `plugin-development.md` documents that every plugin MUST keep `device.status` truthful via `updateDeviceStatus()`. A prod audit found 24 devices stuck at "online" with `lastSeen` between 1 hour and 49 days; those are upstream plugin bugs to fix (Z2M `availability` topic, MCZ Socket.IO disconnect, etc.), not Sowel core gaps. Sowel intentionally does not add a generic `device.lastSeen > timeout` watchdog because battery-powered Zigbee endpoints can stay silent for days without being offline.
- API: new `GET /api/v1/system/sunlight` endpoint exposing sunrise / sunset / isDaylight (#218). Also: `GET /equipments` and `GET /equipments/:id` payloads gain `status` + optional `statusReason`; `GET /zones/:id/aggregated` payload gains `unavailableEquipmentsByCategory`; WebSocket gains a new `equipment.status.changed` event broadcast on every transition.

## 1.13.x — Awning equipment

### v1.13.2 — 2026-05-24 { #v1-13-2 }

- Fix (zones): excluded `pool_cover` equipments from the shutter zone aggregates (`shuttersOpen` / `shuttersTotal` / `averageShutterPosition`). Pool covers share the `shutter_position` data category with shutters and were being counted, which surfaced phantom "all shutters" pills and bulk commands on Piscine zones (and their parent zones — e.g. an Outdoor → Pool subtree inherited them recursively). The `allShuttersOpen/Stop/Close` zone orders already targeted `type=shutter` only so executing the phantom command was a no-op — only the UI lied. The fix also makes awning and pool_cover exclusions uniform (positive `type === "shutter"` check).

### v1.13.1 — 2026-05-24 { #v1-13-1 }

- Fix (zones): dropped the `awningsDeployed` / `awningsTotal` zone aggregates that shipped by mistake with v1.13.0. Awnings reuse the `shutter_position` data category but are intentionally not aggregated at the zone level — the dashboard awning widgets compute their counts locally. The "Stores bannes X/Y" pill is removed from the zone view, and a regression assertion now guarantees awnings don't pollute the shutter aggregates either. Bulk zone commands (`allAwningsExtend/Stop/Retract`) are untouched.

### v1.13.0 — 2026-05-23 { #v1-13-0 }

- Equipments: new `awning` equipment type (spec 115), sibling of `shutter`. Same control surface (position 0–100 + OPEN/STOP/CLOSE), with awning-specific vocabulary throughout the UI: "Déployer / Rétracter" buttons, "Déployé / Rétracté" state pills, and a dedicated "Stores bannes" group in the zone view. The mapping is RF-up = retract (position 0), RF-down = deploy (position 100).
- UI: V3 awning illustration shipped across the dashboard (single-equipment widget, family widget, zone-family widget, mobile widget card, detail sheet slider) and the home view (compact card, hero icon, aggregation pills, group header). Open state = window + cassette + 10 trapezoidal scalloped stripes in Sowel primary blue / primary-light. Closed state = window + cassette + small retracted fringe. Two icon components: `AwningIcon` (24 viewBox, state-aware) for icon contexts, `AwningWidgetIcon` (56 viewBox, 120 px, gradient polish) for dashboard widgets.
- Fix: the awning detail page used to render an empty card — controls were gated on `isShutter` only, so `Extend/Stop/Retract` never showed. Same gate was missing on the single-equipment dashboard widget (showed only the position number, no icon). Both fixed.
- Plugin: new `somfy-rts` integration in the registry ([repo](https://github.com/mchacher/sowel-plugin-somfy-rts), v1.0.3). Bridges the open-source [somfyrts2mqtt](https://github.com/mchacher/somfyrts2mqtt) ESP32 + CC1101 hardware (v0.2.0+) into Sowel: auto-discovers Somfy RTS shutters and awnings from retained Tasmota SENSOR topics, parses position/direction/target, and dispatches OPEN/STOP/CLOSE + percentage to `cmnd/<root>/<remote>/...`.

## 1.12.x — Weather station UX

### v1.12.1 — 2026-05-20 { #v1-12-1 }

- Build: raised the PWA workbox precache cap to 5 MiB. The main UI bundle crossed the 2 MiB default after the spec 114 rework, which broke the v1.12.0 Docker build. No runtime change. A follow-up will split the bundle via `manualChunks` so the cap can come back down.

### v1.12.0 — 2026-05-20 { #v1-12-0 }

- UI: weather station rework (spec 114). The "Station Météo" widget now renders a clean 1×1 tile on both PC and mobile — outdoor temperature in big mono font + humidity below, nothing else — and a tap (or click on desktop) opens a drawer with the full reading. The drawer also surfaces the Sowel-computed `rain_24h` / `rain_1h` totals, so users whose Netatmo plugin only auto-bound the bare `rain` (mm/h) device-side still see the actual 24 h rainfall. The compact zone row now shows 4 values (temp / humidity / `mm/24h` rain / wind) with the same computed-data fallback. The equipment detail `WeatherPanel` injects the computed values into the rain module card too, and the wind module gained a small directional arrow + compass abbreviation derived from `wind_angle`.
- UI: history bar chart readability. On 7 d / 30 d ranges, raw hourly samples are now bucketed into daily totals (so a single rainy afternoon shows as one Thursday bar rather than two detached spikes labelled "jeu. 14" twice). Per-range tick cap (7 d → 7 labels, 30 d → 10), two-line X labels on 7 d (weekday + day), compact `DD/MM` on 30 d, responsive font size on mobile widths. Tooltip switches to "Thursday 14 May" on daily buckets.
- UI: PWA. Added the standard `mobile-web-app-capable` meta alongside the Apple-specific one to silence the Chrome deprecation warning in DevTools.

## 1.11.x — Plugin soft isolation

### v1.11.1 — 2026-05-19 { #v1-11-1 }

- Reliability: Sowel now installs process-wide handlers for `uncaughtException` and `unhandledRejection` (spec 112). When a throw escapes every other guard (a `setInterval` callback in the core, an unawaited promise in an MQTT publish, a native module surprise), the new handlers log a `fatal` entry with the full stack to stdout and to `data/logs/sowel.N.log`, then exit cleanly so Docker's restart policy reboots the container. Before, an uncaught crash left no trace and Docker just looped silently. After, every post-incident investigation has at minimum one log line to start from. No behavior change in the nominal path; the handlers are pure safety net.
- Security: new audit log persists every security-sensitive action in the new `audit_log` SQLite table (spec 113). Captured events cover authentication (login success/failure, logout, API token create/delete), user management (create/update/delete/password change), settings updates, mode activation/deactivation, backup export/restore, and plugin install/uninstall/update/enable/disable. Each entry records the actor (user id + username + token kind), source IP, action, target, and a JSON `meta` blob with redacted values for sensitive keys (`password`, `token`, `secret`, `apiKey`). A new admin-only endpoint `GET /api/v1/audit` exposes the trail with filters by actor, action prefix, and date range. Retention is 365 days, purged at boot.

### v1.11.0 — 2026-05-19 { #v1-11-0 }

- Security hardening: every integration plugin now runs with scoped Proxies on its `PluginDeps` (spec 111). Four invariants are enforced at the JS layer: a plugin can only read or write settings under its own `integration.<own-id>.` prefix (plus a small allowlist of globals like `home.latitude`), can only emit events from a `system.*` whitelist (no domain-event impersonation), can only mutate devices belonging to its own integration, and lifecycle method errors (`refresh`, `getStatus`, etc.) are confined with typed fallbacks instead of crashing the core. Validated locally against the 13 plugins of the registry with zero false positives. No breaking change for plugin authors: the `PluginDeps` shape and method signatures are bit-for-bit identical, so existing plugins keep working without modification. The isolation is unconditional in this release; there is no opt-out. Rollback is via Docker image downgrade.
- Audit: spec 089 (plugin supply-chain SHA256) plus spec 111 together close the dominant plugin threat vectors. Residual gaps (direct `better-sqlite3` access from a plugin, arbitrary `fetch`, infinite loops, `process.exit`) require hard isolation via worker threads and are documented as out of scope until the registry grows past trusted owners.
- Docs: new "Plugin scoping" section in `plugin-development.md` (EN+FR) explaining the four invariants for plugin authors, the explicit allowlists in `scoped-deps.ts`, and what the Proxy does not protect against.

## 1.10.x — Changelog at your fingertips

### v1.10.3 — 2026-05-17 { #v1-10-3 }

- Refactor: every binding resolution across the UI and the recipe engine now goes through a shared category-first resolver. Manually re-bound equipments (where the alias defaults to the device key) keep working everywhere: zone view, equipment detail, mobile dashboard sheet, mobile direct toggle, close-all-valves, and recipe-driven dispatch (motion-light, switch-light, presence-heater, state-trigger-light). Closes the latent bug class behind the v1.10.2 pool-cover incident. Spec 110.

### v1.10.2 — 2026-05-17 { #v1-10-2 }

- Fix: the pool pump's ON/OFF toggle no longer wraps to a second line under the icon in the compact zone view.
- Fix: pool cover (and any shutter) OPEN/STOP/CLOSE buttons reappear in the zone compact view, the mobile dashboard sheet, and the equipment detail page when the binding was created with the device key as alias (e.g. after a manual re-bind through the UI). The controls now resolve the move/position bindings by category, mirroring the dashboard widget's existing logic.

### v1.10.1 — 2026-05-17 { #v1-10-1 }

- Fix: a partial discovery announcement from an integration plugin no longer silently destroys equipment bindings. Before, if a Tasmota / Zigbee2MQTT / etc. device temporarily failed to advertise one of its keys on reconnect, the `device_data` / `device_orders` row was deleted and the FK CASCADE wiped any equipment binding to it. The pool cover lost its open/close command this way after the v1.10.0 restart. Bound rows are now preserved across partial re-discoveries; only truly orphaned rows are still cleaned up (spec 109).

### v1.10.0 — 2026-05-17 { #v1-10-0 }

- Each row of the topbar updates sheet now exposes a discreet changelog icon next to the Update button. Click it to open the matching release notes (this page for Sowel core, the plugin's GitHub release page for plugins) in a new tab. No more clicking blindly through versions (spec 107).
- Release Notes moved into the User Guide table of contents.
- CI now refuses to publish a release unless this page has an entry for the new version in both EN and FR (spec 108). Side effect: every in-app "View changes" link is guaranteed to land on a populated section.

---

## 1.9.x — Actionable updates pill

### v1.9.0 — 2026-05-17 { #v1-9-0 }

- Topbar updates pill now opens an `UpdatesSheet` listing Sowel core + outdated plugins, with a one-click `Update` button per row (spec 106). Replaces the old blind redirect to `/plugins`, which left core updates invisible.

---

## 1.8.x — Charts & activity feed

### v1.8.1 — 2026-05-17 { #v1-8-1 }

- Time-series charts now use a linear time scale on the X axis. Motion / contact / sparse weather data is no longer visually compressed when events are bunched in time.

### v1.8.0 — 2026-05-16 { #v1-8-0 }

- New activity feed in zone view (spec 101). Shows the last 24 h of events with a responsive cap (10 on mobile, 100 on desktop), filtered by binding category and scoped to the current zone.

---

## 1.7.x — WAN hardening

### v1.7.0 — 2026-05-15 { #v1-7-0 }

- WAN hardening (spec 105): CSP and WebSocket Origin check tightened for safe public exposure behind a Cloudflare tunnel. Google Fonts allow-listed for the Nunito heading font. Docker socket accessible to the non-root `sowel` user.
- CI: native ARM64 GitHub runner with parallel builds — multi-arch release time dropped from ~15 min to ~3 min.

---

## 1.6.x — Design system + plugin supply chain

### v1.6.6 — 2026-05-15 { #v1-6-6 }

- Setup wizard auto-triggers the restart after submit; unified decimal separator for latitude/longitude inputs.
- CI: GHCR retention policy — old container versions auto-pruned on each release.

### v1.6.5 — 2026-05-15 { #v1-6-5 }

- First-login Home setup wizard. Restart helper now passes `--force-recreate` so it actually restarts.

### v1.6.4 — 2026-05-15 { #v1-6-4 }

- Plugin install only refuses _escaping_ symlinks now; internal symlinks are allowed (spec 089 C1).

### v1.6.3 — 2026-05-14 { #v1-6-3 }

- Self-update normalises the compose file to `:latest`, force-recreates the container, and verifies the new version (spec 104).
- CI: GitHub Release creation gated behind successful ARM64 build.

### v1.6.2 — 2026-05-14 { #v1-6-2 }

- Plugin supply chain hardening (spec 089 C1+C2): SHA256 hashes pinned in the registry, community-namespace install confirmation, restore path confinement, extension whitelist, symlink refusal, size cap.

### v1.6.1 — 2026-05-14 { #v1-6-1 }

- Docker build fix — `design-system/` is now copied into the UI build stage.

### v1.6.0 — 2026-05-14 { #v1-6-0 }

- Major UI overhaul to design-system parity (specs 094–100):
  - New design-system palette and tokens
  - Sidebar refactored into reusable components
  - Zone view 2-column layout on desktop with cluster aggregation strip and variant pills
  - Icon-only zone command toolbar
  - Dashboard widget chrome unified
  - Typography polish (letter-spacing, H1 standardisation, tabular nums by default)
  - Equipment row chrome refactor and light-on glow
  - Strict mock alignment on zone panels, mobile parity with mockup
- One-command installer (`install.sh`) added.

---

## 1.5.x — Energy & recipes expansion

### v1.5.10 — 2026-05-10 { #v1-5-10 }

- Internal docs revert.

### v1.5.9 — 2026-05-09 { #v1-5-9 }

- Recipe picker rewritten as a compact popover (side-positioned on desktop, bottom sheet on mobile). Pastel palette + rounded corners on the by-usage energy chart.

### v1.5.8 — 2026-05-08 { #v1-5-8 }

- New `state-trigger-light` recipe (spec 092). Recipe slots gain `crossZone` and `includeDescendants` constraints, plus a zone-first picker for single-equipment slots.

### v1.5.7 — 2026-05-08 { #v1-5-7 }

- Power-only submeters and a by-usage energy breakdown chart (spec 091). Submeter cumulative Wh exposed as computed equipment data.

### v1.5.6 — 2026-05-03 { #v1-5-6 }

- Per-mapping enable/disable toggle on MQTT publishers (spec 090).

### v1.5.5 — 2026-05-03 { #v1-5-5 }

- Plugin hot-load: transitive imports cache-busted.

### v1.5.4 — 2026-05-03 { #v1-5-4 }

- Plugin API: `getDeviceDataLastUpdated` getter exposed; `shelly_mqtt` registry bump.

### v1.5.3 — 2026-05-03 { #v1-5-3 }

- Energy production query falls back to the hourly bucket when raw is missing. Consumption tooltip splits HP/HC into grid-only + autoconsumption.

### v1.5.2 — 2026-05-03 { #v1-5-2 }

- Compact header pills replace the alarm banner and integration warning. Live-energy status splits by which source dominates the supply. Plugin unload always calls `stop()`.

### v1.5.1 — 2026-05-03 { #v1-5-1 }

- Self-consumption writer (spec 086 steps E+F), plus aggregator/history bug fixes. New `getDeviceDataValue` getter for plugin baseline hydration.

### v1.5.0 — 2026-05-02 { #v1-5-0 }

- Live power-flow page (`/energy/live`) with auto-detection of sources. Shelly MQTT plugin added to the registry. History migration tool for orphaned equipments.

---

## 1.4.x — Pool heat pump

### v1.4.2 — 2026-05-01 { #v1-4-2 }

- Mobile dashboard renders pool heat pump like a thermostat. Disabled integrations stay visible on the Integrations page. Enable/disable toggle surfaced directly on the row.

### v1.4.1 — 2026-05-01 { #v1-4-1 }

- Persistent Disable/Enable toggle on the integration drawer. Old `ghcr.io/mchacher/sowel` images auto-pruned after self-update.

### v1.4.0 — 2026-05-01 { #v1-4-0 }

- New `pool_heat_pump` equipment type plus the Modbus plugin scaffolding it relies on.

---

## 1.3.x — Pool equipments

### v1.3.2 — 2026-04-19 { #v1-3-2 }

- Alarm reminder logic moved into the Telegram notification publisher (spec 083). Theme-aware fills for the pool pump icon (dark mode). Open/Closed pill in compact shutter and pool cover cards.

### v1.3.1 — 2026-04-19 { #v1-3-1 }

- Recipe slot layout: equal-width columns for homogeneous pairs.

### v1.3.0 — 2026-04-19 { #v1-3-0 }

- New `pool_pump` and `pool_cover` equipment types (spec 081), with inline controls in the compact zone view and a dedicated channel picker on the device side. Multi-channel devices can now back multiple equipments. Plugin registry can be reloaded on demand from the UI.

---

## 1.2.x — Equipment dispatch v2 + domain categories

### v1.2.15 — 2026-04-19 { #v1-2-15 }

- Tasmota plugin registered v1.0.0 (spec 080). Plugin `install()` redirects to `update()` on reinstall.

### v1.2.14 — 2026-04-18 { #v1-2-14 }

- Devices store enum values; UI surfaces dynamic action values (spec 079). New `zone_order` button effect type with zone-first equipment selection (spec 078).

### v1.2.13 — 2026-04-18 { #v1-2-13 }

- Refactor: `dispatchConfig`, `apiVersion`, brute-force fallback removed (spec 074). v2 dispatch is now the only path.

### v1.2.12 — 2026-04-18 { #v1-2-12 }

- Order categories for zone-order resolution (spec 077). New outdoor temperature/humidity categories and updated `netatmo-weather` plugin (spec 076).

### v1.2.11 — 2026-04-18 { #v1-2-11 }

- New domain categories for `media_player`, `appliance`, and `thermostat` (spec 073).

### v1.2.10 — 2026-04-18 { #v1-2-10 }

- Thermostat zone order resolves through the setpoint category (spec 070).

### v1.2.9 — 2026-04-18 { #v1-2-9 }

- Zone orders resolve aliases by category instead of hardcoded names (spec 069).

### v1.2.8 — 2026-04-18 { #v1-2-8 }

- Order dispatch v2 — plugins receive `orderKey` directly instead of a `dispatchConfig` blob (spec 067).

### v1.2.7 — 2026-04-15 { #v1-2-7 }

- Shutter zone orders use the OPEN/CLOSE state instead of a position.

### v1.2.6 — 2026-04-12 { #v1-2-6 }

- New `onChangeOnly` option on MQTT publishers.

### v1.2.5 — 2026-04-12 { #v1-2-5 }

- Restore snapshot on every reconnect — reverts the v1.2.4 change after side effects.

### v1.2.4 — 2026-04-12 { #v1-2-4 }

- MQTT publishers no longer loop on snapshot when the broker reconnects; re-publish on mapping change.

### v1.2.3 — 2026-04-12 { #v1-2-3 }

- Removed the PID file lock — it caused a Docker crash loop on container restart.

### v1.2.2 — 2026-04-12 { #v1-2-2 }

- Internal cleanup.

### v1.2.1 — 2026-04-12 { #v1-2-1 }

- Self-update helper container preserves the host compose `working_dir`.

### v1.2.0 — 2026-04-12 { #v1-2-0 }

- Plugin registry decoupled from the Sowel release cadence + `sowelVersion` compatibility field (spec 066).

---

## 1.1.x — Water + freecooling

### v1.1.7 — 2026-04-12 { #v1-1-7 }

- Update badges and buttons now use red instead of amber.

### v1.1.6 — 2026-04-12 { #v1-1-6 }

- Internal cleanup.

### v1.1.5 — 2026-04-12 { #v1-1-5 }

- Self-update helper container keeps `AutoRemove` off temporarily for debugging.

### v1.1.4 — 2026-04-12 { #v1-1-4 }

- Internal cleanup.

### v1.1.3 — 2026-04-12 { #v1-1-3 }

- Self-update pulls by version tag instead of `:latest` (avoids racing with concurrent releases).

### v1.1.2 — 2026-04-12 { #v1-1-2 }

- New freecooling recipe — closes shutters before sunrise (spec 065).

### v1.1.1 — 2026-04-12 { #v1-1-1 }

- Recipe packages can hot-install and hot-update without engine restart.

### v1.1.0 — 2026-04-12 { #v1-1-0 }

- New `water_valve` equipment type (spec 062) and auto-watering recipe (spec 063).
- Computed weather data: rain-1h / rain-24h plus cumulative bar charts (spec 064).
- Timezone is now auto-derived from the home location (spec 061), with a safe fallback when the settings table is missing on a fresh install.
- Recipe UX polish, clock seconds, plugin auto-start after install/update.

---

## 1.0.x — First versioned releases

### v1.0.8 — 2026-04-11 { #v1-0-8 }

- Internal cleanup.

### v1.0.7 — 2026-04-11 { #v1-0-7 }

- Self-update helper container pattern + detection improvements (spec 060).

### v1.0.6 — 2026-04-11 { #v1-0-6 }

- Internal cleanup.

### v1.0.5 — 2026-04-06 { #v1-0-5 }

- Remote plugin registry, fetched at runtime with local fallback (spec 059).
- Docker base image switched to Debian Trixie for Python 3.13+ (Panasonic Comfort Cloud bridge compatibility).
- CI builds `amd64` only at this stage (~5 min vs ~15 min), with ARM64 added back later.
- Semver-aware comparison for plugin updates.

### v1.0.4 — 2026-04-06 { #v1-0-4 }

- Internal cleanup.

### v1.0.3 — 2026-04-06 { #v1-0-3 }

- Backup line-protocol export handles non-string InfluxDB values. Restore clears `recipe_log` to avoid orphan FK refs. Docker runtime keeps `python3` for the Panasonic Comfort Cloud plugin bridge.

### v1.0.2 — 2026-04-06 { #v1-0-2 }

- Backup now includes `refresh_tokens` so a restored instance keeps users logged in.

### v1.0.1 — 2026-04-06 { #v1-0-1 }

- Backup `PRAGMA foreign_keys` moved outside the SQLite transaction (it had no effect inside).

### v1.0.0 — 2026-04-06 { #v1-0-0 }

- First versioned release. Adds `package.json` versioning, the Dockerfile, the GitHub Actions release pipeline, and the reference `docker-compose.yml` (spec 055). Everything before this point lives in pre-release git history only.
