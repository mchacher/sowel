# Modes

Modes are **named operating profiles** for your home. A mode represents a state of living -- "Comfort", "Away", "Night", "Eco" -- and defines what happens in each room when the mode is activated.

## Understanding modes

Think of modes as presets for your entire home. Instead of manually turning off lights, closing shutters, and lowering the heating when you leave, you activate the "Away" mode and everything happens at once.

**Example modes**:

| Mode        | Description                               |
| ----------- | ----------------------------------------- |
| **Comfort** | Heating on, lights warm and bright        |
| **Night**   | Dim lights, close shutters, lower heating |
| **Away**    | Everything off, security active           |
| **Eco**     | Reduced heating, lights only when needed  |

Only one mode can be active at a time. Activating a new mode deactivates the previous one.

## Creating a mode

Go to **Administration > Modes** and click **Add Mode**.

1. Enter a **name** (e.g., "Night")
2. Add an optional **description**

The mode is created but has no effects yet. Next, you need to define **impacts** -- what happens in each zone when the mode activates.

## Defining impacts

An impact is what happens in a specific zone when the mode is activated. Go to the mode detail page, then configure impacts per zone.

### Impact types

Each impact can contain one or more **actions**:

**Order actions** -- send a command to an equipment:

- Turn off the living room lights
- Close the bedroom shutters
- Set the thermostat to 18 C

**Recipe toggle actions** -- enable or disable a recipe:

- Disable the motion-activated light in the bedroom (so it does not turn on at night)
- Enable an energy-saving recipe when in Eco mode

### Example: Night mode

| Zone           | Actions                               |
| -------------- | ------------------------------------- |
| Living Room    | All lights off, close shutters        |
| Kitchen        | All lights off                        |
| Master Bedroom | Set brightness to 20%, close shutters |
| Hallway        | Disable motion light recipe           |
| Whole Home     | Set thermostat to 18 C                |

## Activating modes

There are three ways to activate a mode:

### Manual activation

From the **Home** view or **Administration > Modes**, tap the mode's activate button. The mode takes effect immediately.

### Event triggers

A mode can be triggered by a device event -- typically a button press.

**Example**: You have a Zigbee button on your nightstand. Configure it as a trigger for "Night" mode: press the button and the entire house switches to night configuration.

To add an event trigger:

1. Open the mode detail page
2. Add a trigger
3. Select the equipment (e.g., your button)
4. Select the data alias (e.g., "action")
5. Set the trigger value (e.g., "toggle" or "single press")

!!! tip
A single button can trigger different modes for different actions. For example: single press for "Night", double press for "Away".

### Calendar scheduling

Modes can be activated automatically on a weekly schedule. See [Calendar scheduling](#calendar-scheduling) below.

## Calendar scheduling

The calendar manages **weekly profiles** for automatic mode activation. This is how you automate your daily routine.

### Profiles

A profile is a named weekly schedule. You might have:

- **Workweek** -- your regular Mon--Fri routine
- **Weekend** -- a different schedule for Sat--Sun
- **Vacation** -- relaxed schedule when you are home all day

Only one profile is active at a time. Switch between profiles with one tap.

### Time slots

Each profile contains time slots. A slot defines:

- **Day(s)** -- which days of the week (Mon, Tue, Wed, etc.)
- **Time** -- when the mode activates
- **Mode(s)** -- which mode(s) to activate

**Example: Workweek profile**

| Days     | Time  | Mode    |
| -------- | ----- | ------- |
| Mon--Fri | 07:00 | Comfort |
| Mon--Fri | 09:00 | Away    |
| Mon--Fri | 18:00 | Comfort |
| Mon--Fri | 22:30 | Night   |
| Sat--Sun | 09:00 | Comfort |
| Sat--Sun | 23:00 | Night   |

### Managing the calendar

Go to **Administration > Calendar**:

1. Create or select a profile
2. Add time slots (day + time + mode)
3. Set the profile as active

The active profile's slots run automatically. When a time slot is reached, the specified mode is activated.

!!! info
Manual mode activation always takes priority. If you manually activate a mode, it stays active until the next calendar slot fires or you manually change it.

## Tips

- **Start simple**: Begin with 2--3 modes (Comfort, Night, Away) and expand from there.
- **Use zones strategically**: Not every zone needs an impact for every mode. Only define impacts where the mode should actually change something.
- **Combine with recipes**: Modes can enable/disable recipes. This is powerful -- for example, disabling motion-activated lights in bedrooms during Night mode so movement does not turn on the lights.
- **Calendar for routine, buttons for exceptions**: Use the calendar for your daily routine and button triggers for on-demand changes.
